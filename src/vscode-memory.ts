import {
  access,
  lstat,
  mkdir,
  rename as move,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Static, Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { buildScopePath, validateScopeBoundary } from './memory-manager.js';
import type { MemoryInput, MemoryResult, MemoryScope } from './types.js';

const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_PATH_LENGTH = 1_024;
const SCOPES = ['session', 'repo', 'user'] as const;
const OPERATIONS = ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'] as const;

export const MemoryToolInputSchema = Type.Object({
  scope: Type.Enum(
    { session: 'session', repo: 'repo', user: 'user' },
    {
      description:
        'Memory scope: session (current conversation), repo (repository-wide), or user (global)',
    },
  ),
  operation: Type.Enum(
    {
      view: 'view',
      create: 'create',
      str_replace: 'str_replace',
      insert: 'insert',
      delete: 'delete',
      rename: 'rename',
    },
    { description: 'Operation to perform on memory' },
  ),
  path: Type.String({
    description: "Relative file path within scope (e.g., 'memory.md' or 'subdir/notes.md')",
    minLength: 1,
    maxLength: MAX_PATH_LENGTH,
  }),
  content: Type.Optional(
    Type.String({
      description: 'Content to write or insert (for create, str_replace, insert operations)',
      maxLength: MAX_CONTENT_LENGTH,
    }),
  ),
  oldString: Type.Optional(
    Type.String({
      description: 'Exact string to find and replace (for str_replace operation)',
      maxLength: MAX_CONTENT_LENGTH,
    }),
  ),
  newString: Type.Optional(
    Type.String({
      description: 'Replacement string (for str_replace operation)',
      maxLength: MAX_CONTENT_LENGTH,
    }),
  ),
  line: Type.Optional(
    Type.Integer({
      description: '1-indexed line number (for insert operation)',
      minimum: 1,
      maximum: MAX_CONTENT_LENGTH,
    }),
  ),
  newPath: Type.Optional(
    Type.String({
      description: 'New path for rename operation (relative within scope)',
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    }),
  ),
});

export type MemoryToolInput = Static<typeof MemoryToolInputSchema>;

const MemoryToolInputValidator = Compile(MemoryToolInputSchema);

export interface MemoryValidationContext {
  sessionId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(input: Record<string, unknown>, operation: string, field: string): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`Operation '${operation}' requires field '${field}'`);
  }
  if (value.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Field '${field}' exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
  return value;
}

function validatePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    path.includes('\0') ||
    /[\r\n]/.test(path)
  ) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
  if (path.split(/[\\/]/).some((segment) => segment === '..')) {
    throw new Error(`Path '${path}' escapes scope boundary (contains ../)`);
  }
  if (path.split(/[\\/]/).some((segment) => segment === '.')) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
}

export function validateToolInput(
  input: unknown,
  context?: MemoryValidationContext,
): MemoryToolInput {
  if (!isRecord(input)) {
    throw new Error('Memory tool input must be an object');
  }
  if (typeof input.scope !== 'string' || !SCOPES.includes(input.scope as (typeof SCOPES)[number])) {
    throw new Error('Scope must be one of: session, repo, user');
  }
  if (
    typeof input.operation !== 'string' ||
    !OPERATIONS.includes(input.operation as (typeof OPERATIONS)[number])
  ) {
    throw new Error('Operation must be one of: view, create, str_replace, insert, delete, rename');
  }

  const scope = input.scope as MemoryToolInput['scope'];
  const operation = input.operation as MemoryToolInput['operation'];
  const path = requireString(input, operation, 'path');
  validatePath(path);

  if (scope === 'session' && context && !context.sessionId) {
    throw new Error('Session-scoped memory requires a sessionId');
  }

  switch (operation) {
    case 'create':
      requireString(input, operation, 'content');
      break;
    case 'str_replace':
      requireString(input, operation, 'oldString');
      requireString(input, operation, 'newString');
      break;
    case 'insert': {
      const line = input.line;
      if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
        throw new Error('Line number must be >= 1');
      }
      requireString(input, operation, 'content');
      break;
    }
    case 'rename': {
      const newPath = requireString(input, operation, 'newPath');
      validatePath(newPath);
      break;
    }
  }

  if (!MemoryToolInputValidator.Check(input)) {
    throw new Error('Memory tool input does not match the required schema');
  }
  return input;
}

const FILE_NOT_FOUND = 'File not found';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(scope: MemoryScope, scopePath: string, filePath: string): string {
  validateScopeBoundary(scope, filePath, scopePath);
  return join(scopePath, filePath);
}

async function view(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
): Promise<MemoryResult> {
  const resolvedPath = resolvePath(scope, scopePath, filePath);
  if (!(await pathExists(resolvedPath))) {
    return { success: true, data: '' };
  }
  if ((await lstat(resolvedPath)).isDirectory()) {
    return { success: true, data: (await readdir(resolvedPath)).sort().join('\n') };
  }
  return { success: true, data: await readFile(resolvedPath, 'utf8') };
}

async function create(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
  content: string,
): Promise<MemoryResult> {
  const resolvedPath = resolvePath(scope, scopePath, filePath);
  if (await pathExists(resolvedPath)) {
    return { success: false, error: 'File already exists' };
  }
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, { encoding: 'utf8', flag: 'wx' });
  return { success: true };
}

async function strReplace(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
  oldString: string,
  newString: string,
): Promise<MemoryResult> {
  const resolvedPath = resolvePath(scope, scopePath, filePath);
  if (!(await pathExists(resolvedPath))) {
    return { success: false, error: FILE_NOT_FOUND };
  }
  const content = await readFile(resolvedPath, 'utf8');
  const firstMatch = content.indexOf(oldString);
  if (firstMatch === -1) {
    return { success: false, error: 'String not found' };
  }
  if (content.indexOf(oldString, firstMatch + oldString.length) !== -1) {
    return { success: false, error: 'Ambiguous: multiple matches found' };
  }
  await writeFile(resolvedPath, content.replace(oldString, newString), 'utf8');
  return { success: true };
}

async function insert(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
  line: number,
  content: string,
): Promise<MemoryResult> {
  if (!Number.isInteger(line) || line < 1) {
    return { success: false, error: 'Line must be a positive integer' };
  }
  const resolvedPath = resolvePath(scope, scopePath, filePath);
  const existingContent = (await pathExists(resolvedPath))
    ? await readFile(resolvedPath, 'utf8')
    : '';
  const lines = existingContent === '' ? [] : existingContent.split('\n');
  lines.splice(Math.min(line - 1, lines.length), 0, content);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, lines.join('\n'), 'utf8');
  return { success: true };
}

async function deletePath(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
): Promise<MemoryResult> {
  await rm(resolvePath(scope, scopePath, filePath), { recursive: true, force: true });
  return { success: true };
}

async function rename(
  scope: MemoryScope,
  scopePath: string,
  filePath: string,
  newPath: string,
): Promise<MemoryResult> {
  const sourcePath = resolvePath(scope, scopePath, filePath);
  const targetPath = resolvePath(scope, scopePath, newPath);
  if (!(await pathExists(sourcePath))) {
    return { success: false, error: 'Source not found' };
  }
  if (await pathExists(targetPath)) {
    return { success: false, error: 'Target already exists' };
  }
  await move(sourcePath, targetPath);
  return { success: true };
}

export async function executeMemoryOperation(
  operation: MemoryInput,
  sessionId?: string,
  cwd = process.cwd(),
): Promise<MemoryResult> {
  try {
    const { scope, path } = operation;
    const scopePath = buildScopePath(scope, { cwd, sessionId }).path;
    switch (operation.operation) {
      case 'view':
        return await view(scope, scopePath, path);
      case 'create':
        return await create(scope, scopePath, path, operation.content);
      case 'str_replace':
        return await strReplace(scope, scopePath, path, operation.oldString, operation.newString);
      case 'insert':
        return await insert(scope, scopePath, path, operation.line, operation.content);
      case 'delete':
        return await deletePath(scope, scopePath, path);
      case 'rename':
        return await rename(scope, scopePath, path, operation.newPath);
      default:
        throw new Error(
          `Unsupported memory operation: ${(operation as { operation: string }).operation}`,
        );
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class VscodeMemory {}
