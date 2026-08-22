/**
 * Persistence boundary for memory files.
 * - `session`: current conversation only.
 * - `repo`: shared by sessions in the current repository.
 * - `user`: shared by all repositories and sessions for this user.
 */
export type MemoryScope = 'session' | 'repo' | 'user';

export interface ScopePathOptions {
  cwd: string;
  sessionId?: string;
}

export interface MemoryPath {
  scope: MemoryScope;
  path: string;
  repoDir: string;
  sessionId?: string;
}

/** A supported scoped filesystem operation. */
export type MemoryOperation = 'view' | 'create' | 'str_replace' | 'insert' | 'delete' | 'rename';

interface BaseMemoryOperation {
  operation: MemoryOperation;
  scope: MemoryScope;
  path: string;
}

export interface ViewOperation extends BaseMemoryOperation {
  operation: 'view';
}

export interface CreateOperation extends BaseMemoryOperation {
  operation: 'create';
  content: string;
}

export interface StrReplaceOperation extends BaseMemoryOperation {
  operation: 'str_replace';
  oldString: string;
  newString: string;
}

export interface InsertOperation extends BaseMemoryOperation {
  operation: 'insert';
  line: number;
  content: string;
}

export interface DeleteOperation extends BaseMemoryOperation {
  operation: 'delete';
}

export interface RenameOperation extends BaseMemoryOperation {
  operation: 'rename';
  newPath: string;
}

/** Validated input for a `memory` tool call. */
export type MemoryInput =
  | ViewOperation
  | CreateOperation
  | StrReplaceOperation
  | InsertOperation
  | DeleteOperation
  | RenameOperation;

/** Structured result returned by a memory operation. */
export interface MemoryResult {
  success: boolean;
  data?: string;
  error?: string;
}
