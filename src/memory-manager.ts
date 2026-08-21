import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { MemoryPath, MemoryScope, ScopePathOptions } from './types.js';

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const PATH_SEPARATOR = /[\\/:]/g;

function isAbsolutePath(filePath: string): boolean {
  return isAbsolute(filePath) || WINDOWS_ABSOLUTE_PATH.test(filePath) || filePath.startsWith('/');
}

export function deriveRepoDir(cwd: string): string {
  if (!cwd) {
    throw new Error('cwd must not be empty');
  }

  if (cwd.includes('~')) {
    throw new Error('cwd must not contain "~"; expand it before deriving the repository directory');
  }

  if (!isAbsolutePath(cwd)) {
    throw new Error('cwd must be an absolute path');
  }

  const encoded = cwd.replace(PATH_SEPARATOR, '-');
  return `--${encoded}--`;
}

export function buildScopePath(scope: MemoryScope, options: ScopePathOptions): MemoryPath {
  if (!['session', 'repo', 'user'].includes(scope)) {
    throw new Error(`Invalid memory scope: ${scope}`);
  }

  const repoDir = deriveRepoDir(options.cwd);
  const agentDirectory = join(homedir(), '.pi', 'agent');

  if (scope === 'user') {
    return { scope, path: join(agentDirectory, 'memories'), repoDir };
  }

  const repositoryDirectory = join(agentDirectory, 'sessions', repoDir);
  if (scope === 'repo') {
    return { scope, path: join(repositoryDirectory, 'memories'), repoDir };
  }

  if (!options.sessionId) {
    throw new Error('sessionId is required for session-scoped memory');
  }

  return {
    scope,
    path: join(repositoryDirectory, `memories-${options.sessionId}`),
    repoDir,
    sessionId: options.sessionId,
  };
}

export function validateScopeBoundary(
  _scope: MemoryScope,
  filePath: string,
  scopePath: string,
): true {
  if (!filePath) {
    throw new Error('Memory file path must not be empty');
  }

  if (filePath.includes('\0') || /[\r\n]/.test(filePath)) {
    throw new Error('Memory file path must not contain null bytes or newlines');
  }

  if (isAbsolutePath(filePath)) {
    throw new Error('Memory file path must be relative');
  }

  if (filePath !== '.' && filePath.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
    throw new Error('Memory file path must not contain traversal segments');
  }

  const resolvedScopePath = resolve(scopePath);
  const resolvedFilePath = resolve(resolvedScopePath, filePath);
  const pathFromScope = relative(resolvedScopePath, resolvedFilePath);

  if (pathFromScope.startsWith('..') || isAbsolutePath(pathFromScope)) {
    throw new Error('Memory file path must remain within its scope');
  }

  return true;
}

export type { MemoryPath, ScopePathOptions };
