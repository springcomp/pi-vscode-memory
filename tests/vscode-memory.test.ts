import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vscodeMemoryExtension from '../src/index.js';
import { deriveRepoDir } from '../src/memory-manager.js';
import {
  MemoryToolInputSchema,
  VscodeMemory,
  executeMemoryOperation,
  validateToolInput,
} from '../src/vscode-memory.js';

const cwd = 'C:\\memory-operation-tests';
const repoDirectory = join(homedir(), '.pi', 'agent', 'sessions', deriveRepoDir(cwd));
const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const scopePath = join(repoDirectory, `memories-${sessionId}`);

function execute(operation: Parameters<typeof executeMemoryOperation>[0]) {
  return executeMemoryOperation(operation, sessionId, cwd);
}

async function writeFixture(path: string, content: string): Promise<void> {
  const fixturePath = join(scopePath, path);
  await mkdir(join(fixturePath, '..'), { recursive: true });
  await writeFile(fixturePath, content, 'utf8');
}

beforeEach(async () => {
  await rm(scopePath, { recursive: true, force: true });
  await mkdir(scopePath, { recursive: true });
});

afterEach(async () => {
  await rm(scopePath, { recursive: true, force: true });
});

describe('VscodeMemory', () => {
  it('can be constructed', () => {
    expect(new VscodeMemory()).toBeInstanceOf(VscodeMemory);
  });
});

describe('MemoryToolInputSchema and validation', () => {
  it('defines all documented tool parameters', () => {
    expect(Object.keys(MemoryToolInputSchema.properties)).toEqual([
      'scope',
      'operation',
      'path',
      'content',
      'oldString',
      'newString',
      'line',
      'newPath',
    ]);
  });

  it.each([
    { scope: 'repo', operation: 'view', path: 'memory.md' },
    { scope: 'user', operation: 'create', path: 'memory.md', content: '' },
    {
      scope: 'repo',
      operation: 'str_replace',
      path: 'memory.md',
      oldString: 'old',
      newString: '',
    },
    { scope: 'repo', operation: 'insert', path: 'memory.md', line: 1, content: 'note' },
    { scope: 'repo', operation: 'delete', path: 'memory.md' },
    { scope: 'repo', operation: 'rename', path: 'memory.md', newPath: 'renamed.md' },
  ])('accepts valid $operation input', (input) => {
    expect(validateToolInput(input)).toEqual(input);
  });

  it.each([
    [
      { scope: 'invalid', operation: 'view', path: 'memory.md' },
      'Scope must be one of: session, repo, user',
    ],
    [
      { scope: 'repo', operation: 'invalid', path: 'memory.md' },
      'Operation must be one of: view, create, str_replace, insert, delete, rename',
    ],
    [
      { scope: 'repo', operation: 'create', path: 'memory.md' },
      "Operation 'create' requires field 'content'",
    ],
    [
      { scope: 'repo', operation: 'str_replace', path: 'memory.md', oldString: 'old' },
      "Operation 'str_replace' requires field 'newString'",
    ],
    [
      { scope: 'repo', operation: 'insert', path: 'memory.md', line: 0, content: 'note' },
      'Line number must be >= 1',
    ],
    [
      { scope: 'repo', operation: 'rename', path: 'memory.md' },
      "Operation 'rename' requires field 'newPath'",
    ],
    [
      { scope: 'repo', operation: 'view', path: 'bad\npath.md' },
      'Path must be relative and contain no null bytes or newlines',
    ],
    [
      { scope: 'repo', operation: 'view', path: '../outside.md' },
      "Path '../outside.md' escapes scope boundary (contains ../)",
    ],
  ])('rejects invalid input with an actionable message', (input, message) => {
    expect(() => validateToolInput(input)).toThrow(message);
  });

  it('requires a session ID when session context is provided', () => {
    const input = { scope: 'session', operation: 'view', path: 'memory.md' } as const;
    expect(() => validateToolInput(input, {})).toThrow(
      'Session-scoped memory requires a sessionId',
    );
    expect(validateToolInput(input, { sessionId: 'session-1' })).toEqual(input);
  });
});

describe('vscode-memory extension', () => {
  it('registers the memory tool', () => {
    const registerTool = vi.fn();
    vscodeMemoryExtension({ registerTool } as never);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0][0]).toMatchObject({
      name: 'memory',
      label: 'Persistent Memory',
      parameters: MemoryToolInputSchema,
    });
  });

  it('executes operations and returns structured success and error responses', async () => {
    const registerTool = vi.fn();
    vscodeMemoryExtension({ registerTool } as never);
    const tool = registerTool.mock.calls[0][0];
    const context = {
      cwd,
      sessionManager: { getSessionId: () => sessionId },
    };

    await expect(
      tool.execute(
        'create-memory',
        { scope: 'session', operation: 'create', path: 'tool.md', content: 'stored' },
        undefined,
        undefined,
        context,
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: "Operation 'create' completed successfully." }],
      details: {
        scope: 'session',
        operation: 'create',
        path: 'tool.md',
        success: true,
      },
    });
    await expect(
      tool.execute(
        'view-memory',
        { scope: 'session', operation: 'view', path: 'tool.md' },
        undefined,
        undefined,
        context,
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'stored' }],
      details: {
        scope: 'session',
        operation: 'view',
        path: 'tool.md',
        success: true,
      },
    });
    await expect(
      tool.execute(
        'existing-memory',
        { scope: 'session', operation: 'create', path: 'tool.md', content: 'other' },
        undefined,
        undefined,
        context,
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: File already exists' }],
      details: {
        scope: 'session',
        operation: 'create',
        path: 'tool.md',
        success: false,
        error: 'File already exists',
      },
      isError: true,
    });
  });

  it('returns fatal errors for invalid input and unavailable session IDs', async () => {
    const registerTool = vi.fn();
    vscodeMemoryExtension({ registerTool } as never);
    const tool = registerTool.mock.calls[0][0];

    await expect(
      tool.execute(
        'invalid-memory',
        { scope: 'session', operation: 'create', path: 'tool.md' },
        undefined,
        undefined,
        { cwd, sessionManager: { getSessionId: () => sessionId } },
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: "Fatal error: Operation 'create' requires field 'content'" }],
      details: {
        success: false,
        error: "Operation 'create' requires field 'content'",
      },
      isError: true,
    });
    await expect(
      tool.execute(
        'missing-session',
        { scope: 'session', operation: 'view', path: 'tool.md' },
        undefined,
        undefined,
        { cwd, sessionManager: { getSessionId: () => undefined } },
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'Fatal error: Session-scoped memory requires a sessionId' }],
      details: {
        success: false,
        error: 'Session-scoped memory requires a sessionId',
      },
      isError: true,
    });
  });
});

describe('view operation', () => {
  it('reads regular, empty, large, and unicode files', async () => {
    const largeContent = 'x'.repeat(100_000);
    await writeFixture('note.md', 'hello');
    await writeFixture('empty.md', '');
    await writeFixture('large.md', largeContent);
    await writeFixture('unicode.md', 'cafe \u2615 \u{1F680}');

    await expect(
      execute({ operation: 'view', scope: 'session', path: 'note.md' }),
    ).resolves.toEqual({
      success: true,
      data: 'hello',
    });
    await expect(
      execute({ operation: 'view', scope: 'session', path: 'empty.md' }),
    ).resolves.toEqual({
      success: true,
      data: '',
    });
    await expect(
      execute({ operation: 'view', scope: 'session', path: 'large.md' }),
    ).resolves.toEqual({
      success: true,
      data: largeContent,
    });
    await expect(
      execute({ operation: 'view', scope: 'session', path: 'unicode.md' }),
    ).resolves.toEqual({
      success: true,
      data: 'cafe \u2615 \u{1F680}',
    });
  });

  it('lists sorted directory entries and makes missing paths idempotent', async () => {
    await writeFixture('folder/second.md', 'second');
    await writeFixture('folder/first.md', 'first');
    await mkdir(join(scopePath, 'folder', 'child'));
    await mkdir(join(scopePath, 'empty'));

    await expect(execute({ operation: 'view', scope: 'session', path: 'folder' })).resolves.toEqual(
      {
        success: true,
        data: 'child\nfirst.md\nsecond.md',
      },
    );
    await expect(execute({ operation: 'view', scope: 'session', path: 'empty' })).resolves.toEqual({
      success: true,
      data: '',
    });
    await expect(
      execute({ operation: 'view', scope: 'session', path: 'missing' }),
    ).resolves.toEqual({
      success: true,
      data: '',
    });
  });
});

describe('create operation', () => {
  it('creates empty, unicode, large, dotted, and deeply nested files', async () => {
    const largeContent = 'x'.repeat(100_000);
    await expect(
      execute({ operation: 'create', scope: 'session', path: 'empty.md', content: '' }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({
        operation: 'create',
        scope: 'session',
        path: 'unicode.md',
        content: 'naive \u{1F680}',
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({ operation: 'create', scope: 'session', path: 'large.md', content: largeContent }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({
        operation: 'create',
        scope: 'session',
        path: 'a/b/c/d/e/my.notes-2024.md',
        content: 'nested',
      }),
    ).resolves.toEqual({ success: true });

    await expect(readFile(join(scopePath, 'empty.md'), 'utf8')).resolves.toBe('');
    await expect(readFile(join(scopePath, 'unicode.md'), 'utf8')).resolves.toBe('naive \u{1F680}');
    await expect(readFile(join(scopePath, 'large.md'), 'utf8')).resolves.toBe(largeContent);
    await expect(readFile(join(scopePath, 'a/b/c/d/e/my.notes-2024.md'), 'utf8')).resolves.toBe(
      'nested',
    );
  });

  it('does not overwrite an existing file', async () => {
    await writeFixture('note.md', 'original');
    await expect(
      execute({ operation: 'create', scope: 'session', path: 'note.md', content: 'replacement' }),
    ).resolves.toEqual({ success: false, error: 'File already exists' });
    await expect(readFile(join(scopePath, 'note.md'), 'utf8')).resolves.toBe('original');
  });
});

describe('str_replace operation', () => {
  it.each([
    ['start', 'old middle end', 'old', 'new', 'new middle end'],
    ['middle', 'start old end', 'old', 'new', 'start new end'],
    ['end', 'start middle old', 'old', 'new', 'start middle new'],
    ['deletion', 'start old end', 'old', '', 'start  end'],
    ['expansion', 'old', 'old', 'much longer replacement', 'much longer replacement'],
    ['multiline', 'one\nold\ntwo', 'old', 'new\nline', 'one\nnew\nline\ntwo'],
    ['regex characters', 'a.b[c]', 'a.b[c]', 'literal', 'literal'],
    ['idempotent value', 'same', 'same', 'same', 'same'],
  ])('replaces one exact %s match', async (_case, source, oldString, newString, expected) => {
    await writeFixture('note.md', source);

    await expect(
      execute({
        operation: 'str_replace',
        scope: 'session',
        path: 'note.md',
        oldString,
        newString,
      }),
    ).resolves.toEqual({ success: true });
    await expect(readFile(join(scopePath, 'note.md'), 'utf8')).resolves.toBe(expected);
  });

  it('reports missing, ambiguous, and case-mismatched replacements without changing the file', async () => {
    await writeFixture('note.md', 'Word same same');

    await expect(
      execute({
        operation: 'str_replace',
        scope: 'session',
        path: 'note.md',
        oldString: 'word',
        newString: 'new',
      }),
    ).resolves.toEqual({ success: false, error: 'String not found' });
    await expect(
      execute({
        operation: 'str_replace',
        scope: 'session',
        path: 'note.md',
        oldString: 'same',
        newString: 'new',
      }),
    ).resolves.toEqual({ success: false, error: 'Ambiguous: multiple matches found' });
    await expect(
      execute({
        operation: 'str_replace',
        scope: 'session',
        path: 'missing.md',
        oldString: 'old',
        newString: 'new',
      }),
    ).resolves.toEqual({ success: false, error: 'File not found' });
    await expect(readFile(join(scopePath, 'note.md'), 'utf8')).resolves.toBe('Word same same');
  });
});

describe('insert operation', () => {
  it('inserts before requested lines, appends beyond the file, and preserves newlines', async () => {
    await writeFixture('note.md', 'one\ntwo\nthree');

    await expect(
      execute({ operation: 'insert', scope: 'session', path: 'note.md', line: 1, content: 'zero' }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({
        operation: 'insert',
        scope: 'session',
        path: 'note.md',
        line: 3,
        content: 'middle',
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({
        operation: 'insert',
        scope: 'session',
        path: 'note.md',
        line: 1000,
        content: 'last',
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({ operation: 'insert', scope: 'session', path: 'note.md', line: 2, content: 'a\nb' }),
    ).resolves.toEqual({ success: true });

    await expect(readFile(join(scopePath, 'note.md'), 'utf8')).resolves.toBe(
      'zero\na\nb\none\nmiddle\ntwo\nthree\nlast',
    );
  });

  it('creates files for empty inserts and rejects non-positive line numbers', async () => {
    await expect(
      execute({ operation: 'insert', scope: 'session', path: 'new.md', line: 1, content: '' }),
    ).resolves.toEqual({ success: true });
    await expect(readFile(join(scopePath, 'new.md'), 'utf8')).resolves.toBe('');
    await expect(
      execute({ operation: 'insert', scope: 'session', path: 'new.md', line: 0, content: 'no' }),
    ).resolves.toEqual({ success: false, error: 'Line must be a positive integer' });
    await expect(
      execute({ operation: 'insert', scope: 'session', path: 'new.md', line: -1, content: 'no' }),
    ).resolves.toEqual({ success: false, error: 'Line must be a positive integer' });
  });
});

describe('delete operation', () => {
  it('deletes files and nested directories idempotently', async () => {
    await writeFixture('note.md', 'note');
    await writeFixture('folder/nested/note.md', 'nested');

    await expect(
      execute({ operation: 'delete', scope: 'session', path: 'note.md' }),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      execute({ operation: 'delete', scope: 'session', path: 'folder' }),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      execute({ operation: 'delete', scope: 'session', path: 'folder' }),
    ).resolves.toEqual({
      success: true,
    });
  });
});

describe('rename operation', () => {
  it('renames files and directories within the scope', async () => {
    await writeFixture('source.md', 'source');
    await writeFixture('folder/nested.md', 'nested');
    await mkdir(join(scopePath, 'notes'));

    await expect(
      execute({
        operation: 'rename',
        scope: 'session',
        path: 'source.md',
        newPath: 'notes/file@2024.md',
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      execute({ operation: 'rename', scope: 'session', path: 'folder', newPath: 'renamed-folder' }),
    ).resolves.toEqual({ success: true });
    await expect(readFile(join(scopePath, 'notes/file@2024.md'), 'utf8')).resolves.toBe('source');
    await expect(readFile(join(scopePath, 'renamed-folder/nested.md'), 'utf8')).resolves.toBe(
      'nested',
    );
  });

  it('does not overwrite targets and reports missing sources', async () => {
    await writeFixture('source.md', 'source');
    await writeFixture('target.md', 'target');

    await expect(
      execute({ operation: 'rename', scope: 'session', path: 'missing.md', newPath: 'new.md' }),
    ).resolves.toEqual({ success: false, error: 'Source not found' });
    await expect(
      execute({ operation: 'rename', scope: 'session', path: 'source.md', newPath: 'target.md' }),
    ).resolves.toEqual({ success: false, error: 'Target already exists' });
    await expect(readFile(join(scopePath, 'source.md'), 'utf8')).resolves.toBe('source');
  });
});

describe('operation path boundaries and dispatcher', () => {
  it.each([
    { operation: 'view', scope: 'session', path: '../outside.md' },
    { operation: 'create', scope: 'session', path: '../outside.md', content: 'content' },
    {
      operation: 'str_replace',
      scope: 'session',
      path: '../outside.md',
      oldString: 'old',
      newString: 'new',
    },
    { operation: 'insert', scope: 'session', path: '../outside.md', line: 1, content: 'content' },
    { operation: 'delete', scope: 'session', path: '../outside.md' },
    { operation: 'rename', scope: 'session', path: '../outside.md', newPath: 'new.md' },
    { operation: 'rename', scope: 'session', path: 'old.md', newPath: '../outside.md' },
  ] as Parameters<typeof executeMemoryOperation>[0][])(
    'prevents paths escaping scope for $operation',
    async (operation) => {
      await expect(execute(operation)).resolves.toMatchObject({
        success: false,
        error: expect.stringMatching(/traversal/),
      });
    },
  );

  it.each(['C:\\outside.md', '/outside.md', 'bad\0name.md'] as const)(
    'rejects absolute and malformed paths: %s',
    async (path) => {
      await expect(execute({ operation: 'view', scope: 'session', path })).resolves.toMatchObject({
        success: false,
      });
    },
  );

  it('rejects the scope root and a missing session context', async () => {
    await expect(execute({ operation: 'delete', scope: 'session', path: '' })).resolves.toEqual({
      success: false,
      error: 'Memory file path must not be empty',
    });
    await expect(
      executeMemoryOperation(
        { operation: 'view', scope: 'session', path: 'memory.md' },
        undefined,
        cwd,
      ),
    ).resolves.toEqual({
      success: false,
      error: 'sessionId is required for session-scoped memory',
    });
  });

  it('returns a structured error for an unsupported runtime operation', async () => {
    await expect(
      executeMemoryOperation(
        { operation: 'invalid', scope: 'session', path: 'memory.md' } as never,
        sessionId,
        cwd,
      ),
    ).resolves.toEqual({ success: false, error: 'Unsupported memory operation: invalid' });
  });
});

describe('virtual paths', () => {
  it.each([
    ['/memories/notes.md', 'user'],
    ['/memories/sessions/notes.md', 'repo'],
    ['/memories/session/notes.md', 'session'],
  ] as const)('resolves FQVP %s to scope %s without an explicit scope field', (path, scope) => {
    const result = validateToolInput({ operation: 'view', path }, { sessionId: 'session-1' });
    expect(result).toMatchObject({ scope, path: 'notes.md' });
  });

  it('defaults an unqualified virtual path (UQVP) to session scope', () => {
    const result = validateToolInput(
      { operation: 'view', path: 'notes.md' },
      { sessionId: 'session-1' },
    );
    expect(result).toMatchObject({ scope: 'session', path: 'notes.md' });
  });

  it('honors an explicit scope for a UQVP', () => {
    const result = validateToolInput({ operation: 'view', scope: 'repo', path: 'notes.md' });
    expect(result).toMatchObject({ scope: 'repo', path: 'notes.md' });
  });

  it('accepts an FQVP whose encoded scope matches an explicit scope field', () => {
    const result = validateToolInput({
      operation: 'view',
      scope: 'repo',
      path: '/memories/sessions/notes.md',
    });
    expect(result).toMatchObject({ scope: 'repo', path: 'notes.md' });
  });

  it('rejects an FQVP whose encoded scope conflicts with an explicit scope field', () => {
    expect(() =>
      validateToolInput({ operation: 'view', scope: 'user', path: '/memories/sessions/notes.md' }),
    ).toThrow(
      "Scope 'user' does not match the scope encoded by virtual path '/memories/sessions/notes.md' ('repo')",
    );
  });

  it.each([
    ['/memories', 'user'],
    ['/memories/', 'user'],
    ['/memories/session', 'session'],
    ['/memories/session/', 'session'],
    ['/memories/sessions', 'repo'],
    ['/memories/sessions/', 'repo'],
  ] as const)('resolves scope root %s to the default memory.md note', (path, scope) => {
    const result = validateToolInput({ operation: 'view', path }, { sessionId: 'session-1' });
    expect(result).toMatchObject({ scope, path: 'memory.md' });
  });

  it('rejects a user-scoped file literally named "session" (claimed by the session prefix)', () => {
    const result = validateToolInput(
      { operation: 'view', path: '/memories/session' },
      { sessionId: 'session-1' },
    );
    expect(result).toMatchObject({ scope: 'session', path: 'memory.md' });
  });

  it('allows a user-scoped file literally named "session.md"', () => {
    const result = validateToolInput({ operation: 'view', path: '/memories/session.md' });
    expect(result).toMatchObject({ scope: 'user', path: 'session.md' });
  });

  it.each([
    ['/memories/*', 'user'],
    ['/memories/session/*', 'session'],
    ['/memories/sessions/*', 'repo'],
  ] as const)('resolves literal %s to a directory listing request', (path, scope) => {
    const result = validateToolInput({ operation: 'view', path }, { sessionId: 'session-1' });
    expect(result).toMatchObject({ scope, path: '.' });
  });

  it('lists scope root entries end-to-end via a literal * request', async () => {
    await writeFixture('alpha.md', 'a');
    await writeFixture('beta.md', 'b');
    const validated = validateToolInput(
      { operation: 'view', path: '/memories/session/*' },
      { sessionId },
    );
    const result = await execute(validated);
    expect(result.success).toBe(true);
    expect(result.data?.split('\n').sort()).toEqual(['alpha.md', 'beta.md']);
  });

  describe('rename combinations', () => {
    it('renames UQVP to UQVP within the same (session) scope', () => {
      const result = validateToolInput(
        { operation: 'rename', path: 'old.md', newPath: 'new.md' },
        { sessionId: 'session-1' },
      );
      expect(result).toMatchObject({ scope: 'session', path: 'old.md', newPath: 'new.md' });
    });

    it('renames FQVP to UQVP within the scope encoded by path', () => {
      const result = validateToolInput({
        operation: 'rename',
        path: '/memories/sessions/old.md',
        newPath: 'new.md',
      });
      expect(result).toMatchObject({ scope: 'repo', path: 'old.md', newPath: 'new.md' });
    });

    it('renames FQVP to FQVP when both encode the same scope', () => {
      const result = validateToolInput({
        operation: 'rename',
        path: '/memories/sessions/old.md',
        newPath: '/memories/sessions/new.md',
      });
      expect(result).toMatchObject({ scope: 'repo', path: 'old.md', newPath: 'new.md' });
    });

    it('rejects FQVP to FQVP rename across mismatched scopes', () => {
      expect(() =>
        validateToolInput({
          operation: 'rename',
          path: '/memories/sessions/old.md',
          newPath: '/memories/new.md',
        }),
      ).toThrow(
        "Scope 'repo' does not match the scope encoded by virtual path '/memories/new.md' ('user')",
      );
    });
  });

  it('executes an end-to-end view through a virtual path', async () => {
    await writeFixture('vp-note.md', 'from virtual path');
    const validated = validateToolInput(
      { operation: 'view', path: '/memories/session/vp-note.md' },
      { sessionId },
    );
    await expect(execute(validated)).resolves.toEqual({
      success: true,
      data: 'from virtual path',
    });
  });
});
