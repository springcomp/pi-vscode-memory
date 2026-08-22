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
import { buildScopePath, validateScopeBoundary } from './memory-manager.ts';
import type { MemoryInput, MemoryResult, MemoryScope } from './types.ts';

const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_PATH_LENGTH = 1_024;
const SCOPES = ['session', 'repo', 'user'] as const;
const OPERATIONS = ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'] as const;

export const MemoryToolInputSchema = Type.Object({
  scope: Type.Optional(
    Type.Enum(
      { session: 'session', repo: 'repo', user: 'user' },
      {
        description:
          'Memory scope: session (current conversation), repo (repository-wide), or user (global). ' +
          'Optional when `path` is a fully qualified virtual path (FQVP), which already encodes ' +
          'the scope; it must match that scope or the call errs. When `path` is an unqualified ' +
          'virtual path (UQVP), scope defaults to session if omitted.',
      },
    ),
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
    description:
      'Path to the memory file. Either a fully qualified virtual path (FQVP) that encodes its ' +
      "own scope — '/memories/<file>' (user scope), '/memories/sessions/<file>' (repo scope), " +
      "'/memories/session/<file>' (session scope, singular) — or an unqualified virtual path " +
      "(UQVP) such as 'memory.md' or 'subdir/notes.md', which uses the `scope` field and " +
      'defaults to session scope when `scope` is omitted. A bare scope root ' +
      "(e.g. '/memories', '/memories/session', '/memories/sessions') addresses that scope's " +
      "default 'memory.md' note. A literal trailing '*' (e.g. '/memories/*', " +
      "'/memories/session/*', '/memories/sessions/*') requests a directory listing of that " +
      'scope root instead.',
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
      description:
        'New path for rename operation: an FQVP or UQVP within the same scope as `path`. ' +
        'An FQVP here must resolve to the same scope as `path` or the call errs.',
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

function validateBasicPathConstraints(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    path.includes('\0') ||
    /[\r\n]/.test(path)
  ) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
}

function validatePath(path: string): void {
  validateBasicPathConstraints(path);
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
  if (path.split(/[\\/]/).some((segment) => segment === '..')) {
    throw new Error(`Path '${path}' escapes scope boundary (contains ../)`);
  }
  if (path !== '.' && path.split(/[\\/]/).some((segment) => segment === '.')) {
    throw new Error('Path must be relative and contain no null bytes or newlines');
  }
}

/** Default note used when a virtual path names a scope root with no file segment. */
const DEFAULT_MEMORY_FILE = 'memory.md';

/**
 * Fully qualified virtual path (FQVP) prefixes. Each maps a leading, scope-encoding
 * segment to its underlying {@link MemoryScope}. Checked in order: the more specific
 * `/memories/sessions` (plural, repo) and `/memories/session` (singular, session)
 * prefixes must be tried before the generic `/memories` (user) prefix, which would
 * otherwise match them too. Because each pattern requires an exact segment boundary
 * (end of string or `/`) right after its keyword, a bare `/memories/session` or
 * `/memories/sessions` is always claimed by its dedicated rule; there is no way to
 * address a *user*-scoped file literally named `session` or `sessions` through
 * `/memories/<file>` — it always resolves to the session or repo scope root instead.
 */
const FQVP_RULES: ReadonlyArray<{ pattern: RegExp; scope: MemoryScope }> = [
  { pattern: /^\/memories\/sessions(?:\/(.*))?$/, scope: 'repo' },
  { pattern: /^\/memories\/session(?:\/(.*))?$/, scope: 'session' },
  { pattern: /^\/memories(?:\/(.*))?$/, scope: 'user' },
];

interface VirtualPath {
  scope: MemoryScope;
  realPath: string;
}

/**
 * Parses a fully qualified virtual path (FQVP) such as `/memories/<file>`,
 * `/memories/sessions/<file>`, or `/memories/session/<file>`. Returns `null` when
 * `rawPath` is an unqualified virtual path (UQVP), i.e. a plain relative path.
 *
 * A scope root with no file segment (`/memories`, `/memories/`, `/memories/session`,
 * `/memories/session/`, `/memories/sessions`, `/memories/sessions/`) resolves to that
 * scope's default `memory.md` note.
 *
 * A literal trailing `*` (e.g. `/memories/*`, `/memories/session/*`,
 * `/memories/sessions/*`) requests an explicit directory listing of the scope root
 * instead of the default note.
 */
function parseVirtualPath(rawPath: string): VirtualPath | null {
  const normalized = rawPath.replace(/\\/g, '/');
  for (const { pattern, scope } of FQVP_RULES) {
    const match = pattern.exec(normalized);
    if (match) {
      const rest = match[1];
      if (rest === '*') {
        return { scope, realPath: '.' };
      }
      return { scope, realPath: rest && rest.length > 0 ? rest : DEFAULT_MEMORY_FILE };
    }
  }
  return null;
}

/**
 * Resolves a path field (`path` or `newPath`) to a concrete scope and a plain
 * relative path within that scope.
 *
 * - A fully qualified virtual path (FQVP) encodes its own scope. If `providedScope`
 *   is also given, it must match, otherwise the call errs.
 * - An unqualified virtual path (UQVP) uses `providedScope`, defaulting to `session`
 *   when omitted.
 */
function resolvePathField(rawPath: string, providedScope: MemoryScope | undefined): VirtualPath {
  validateBasicPathConstraints(rawPath);
  const virtual = parseVirtualPath(rawPath);
  if (virtual) {
    if (providedScope && providedScope !== virtual.scope) {
      throw new Error(
        `Scope '${providedScope}' does not match the scope encoded by virtual path '${rawPath}' ('${virtual.scope}')`,
      );
    }
    validatePath(virtual.realPath);
    return virtual;
  }
  validatePath(rawPath);
  return { scope: providedScope ?? 'session', realPath: rawPath };
}

export function validateToolInput(
  input: unknown,
  context?: MemoryValidationContext,
): MemoryToolInput {
  if (!isRecord(input)) {
    throw new Error('Memory tool input must be an object');
  }
  if (
    input.scope !== undefined &&
    (typeof input.scope !== 'string' || !SCOPES.includes(input.scope as (typeof SCOPES)[number]))
  ) {
    throw new Error('Scope must be one of: session, repo, user');
  }
  if (
    typeof input.operation !== 'string' ||
    !OPERATIONS.includes(input.operation as (typeof OPERATIONS)[number])
  ) {
    throw new Error('Operation must be one of: view, create, str_replace, insert, delete, rename');
  }

  const providedScope = input.scope as MemoryScope | undefined;
  const operation = input.operation as MemoryToolInput['operation'];
  const rawPath = requireString(input, operation, 'path');
  const resolved = resolvePathField(rawPath, providedScope);
  const scope = resolved.scope;

  if (scope === 'session' && context && !context.sessionId) {
    throw new Error('Session-scoped memory requires a sessionId');
  }

  const normalized: Record<string, unknown> = { ...input, scope, path: resolved.realPath };

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
      const rawNewPath = requireString(input, operation, 'newPath');
      const resolvedNewPath = resolvePathField(rawNewPath, scope);
      Object.assign(normalized, { newPath: resolvedNewPath.realPath });
      break;
    }
  }

  if (!MemoryToolInputValidator.Check(normalized)) {
    throw new Error('Memory tool input does not match the required schema');
  }
  return normalized as MemoryToolInput;
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
