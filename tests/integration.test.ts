import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testEnvironment = vi.hoisted(() => ({ home: '' }));

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal()),
  homedir: () => testEnvironment.home,
}));

import { buildScopePath, deriveRepoDir } from '../src/memory-manager.js';
import type { MemoryInput, MemoryScope } from '../src/types.js';
import { executeMemoryOperation } from '../src/vscode-memory.js';

const repoOne = 'C:\\projects\\memory-one';
const repoTwo = 'C:\\projects\\memory-two';
const sessionOne = 'session-one';
const sessionTwo = 'session-two';
let temporaryRoot = '';

function execute(operation: MemoryInput, sessionId = sessionOne, cwd = repoOne) {
  return executeMemoryOperation(operation, sessionId, cwd);
}

function scopePath(scope: MemoryScope, sessionId = sessionOne, cwd = repoOne): string {
  return buildScopePath(scope, { cwd, sessionId }).path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'vscode-memory-integration-'));
  testEnvironment.home = join(temporaryRoot, 'home');
});

beforeEach(async () => {
  await rm(join(testEnvironment.home, '.pi'), { recursive: true, force: true });
});

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('memory integration across scopes', () => {
  describe('scope isolation', () => {
    it('keeps session, repository, and user memory separate with the documented layout', async () => {
      await execute({
        operation: 'create',
        scope: 'session',
        path: 'session.md',
        content: 'private',
      });
      await execute({
        operation: 'create',
        scope: 'repo',
        path: 'repo.md',
        content: 'shared repo',
      });
      await execute({
        operation: 'create',
        scope: 'user',
        path: 'user.md',
        content: 'shared user',
      });

      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'session.md' }),
      ).resolves.toEqual({ success: true, data: '' });
      await expect(execute({ operation: 'view', scope: 'user', path: 'repo.md' })).resolves.toEqual(
        { success: true, data: '' },
      );
      await expect(
        execute({ operation: 'view', scope: 'session', path: 'user.md' }, sessionTwo),
      ).resolves.toEqual({ success: true, data: '' });

      expect(scopePath('session')).toBe(
        join(
          testEnvironment.home,
          '.pi',
          'agent',
          'sessions',
          deriveRepoDir(repoOne),
          `memories-${sessionOne}`,
        ),
      );
      expect(scopePath('repo')).toBe(
        join(testEnvironment.home, '.pi', 'agent', 'sessions', deriveRepoDir(repoOne), 'memories'),
      );
      expect(scopePath('user')).toBe(join(testEnvironment.home, '.pi', 'agent', 'memories'));
    });

    it('isolates sessions and repositories while sharing user memory everywhere', async () => {
      await execute({ operation: 'create', scope: 'session', path: 'note.md', content: 'one' });
      await execute(
        { operation: 'create', scope: 'session', path: 'note.md', content: 'two' },
        sessionTwo,
      );
      await execute({ operation: 'create', scope: 'repo', path: 'note.md', content: 'repo one' });
      await execute(
        { operation: 'create', scope: 'repo', path: 'note.md', content: 'repo two' },
        sessionOne,
        repoTwo,
      );
      await execute({
        operation: 'create',
        scope: 'user',
        path: 'preferences.md',
        content: 'global',
      });

      await expect(
        execute({ operation: 'view', scope: 'session', path: 'note.md' }),
      ).resolves.toMatchObject({
        data: 'one',
      });
      await expect(
        execute({ operation: 'view', scope: 'session', path: 'note.md' }, sessionTwo),
      ).resolves.toMatchObject({ data: 'two' });
      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'note.md' }),
      ).resolves.toMatchObject({
        data: 'repo one',
      });
      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'note.md' }, sessionOne, repoTwo),
      ).resolves.toMatchObject({ data: 'repo two' });
      await expect(
        execute({ operation: 'view', scope: 'user', path: 'preferences.md' }, sessionTwo, repoTwo),
      ).resolves.toMatchObject({ data: 'global' });
    });
  });

  describe('full workflows', () => {
    it('creates, updates, lists, deletes, and recreates session memory', async () => {
      await expect(
        execute({
          operation: 'create',
          scope: 'session',
          path: 'memory.md',
          content: '# Plan\nresearch',
        }),
      ).resolves.toEqual({ success: true });
      await expect(
        execute({
          operation: 'str_replace',
          scope: 'session',
          path: 'memory.md',
          oldString: 'research',
          newString: 'implemented',
        }),
      ).resolves.toEqual({ success: true });
      await expect(
        execute({
          operation: 'insert',
          scope: 'session',
          path: 'memory.md',
          line: 2,
          content: '## Tasks',
        }),
      ).resolves.toEqual({ success: true });
      await execute({
        operation: 'create',
        scope: 'session',
        path: 'notes/findings/deep.md',
        content: 'found',
      });

      await expect(
        execute({ operation: 'view', scope: 'session', path: 'memory.md' }),
      ).resolves.toEqual({
        success: true,
        data: '# Plan\n## Tasks\nimplemented',
      });
      await expect(
        execute({ operation: 'view', scope: 'session', path: 'notes' }),
      ).resolves.toEqual({
        success: true,
        data: 'findings',
      });
      await expect(
        execute({ operation: 'delete', scope: 'session', path: 'memory.md' }),
      ).resolves.toEqual({
        success: true,
      });
      await expect(
        execute({ operation: 'create', scope: 'session', path: 'memory.md', content: 'recreated' }),
      ).resolves.toEqual({ success: true });
    });

    it('shares repository changes across sessions and user changes across repositories', async () => {
      await execute({ operation: 'create', scope: 'repo', path: 'knowledge.md', content: 'draft' });
      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'knowledge.md' }, sessionTwo),
      ).resolves.toMatchObject({ data: 'draft' });
      await execute(
        {
          operation: 'str_replace',
          scope: 'repo',
          path: 'knowledge.md',
          oldString: 'draft',
          newString: 'approved',
        },
        sessionTwo,
      );
      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'knowledge.md' }),
      ).resolves.toMatchObject({
        data: 'approved',
      });

      await execute({
        operation: 'create',
        scope: 'user',
        path: 'templates/snippet.md',
        content: 'one',
      });
      await execute(
        {
          operation: 'insert',
          scope: 'user',
          path: 'templates/snippet.md',
          line: 2,
          content: 'two',
        },
        sessionTwo,
        repoTwo,
      );
      await expect(
        execute({ operation: 'view', scope: 'user', path: 'templates/snippet.md' }),
      ).resolves.toEqual({
        success: true,
        data: 'one\ntwo',
      });
    });
  });

  describe('multi-operation and error recovery', () => {
    it('keeps state intact after failed replacements, creates, and renames', async () => {
      await execute({ operation: 'create', scope: 'repo', path: 'source.md', content: 'original' });
      await execute({ operation: 'create', scope: 'repo', path: 'target.md', content: 'target' });

      await expect(
        execute({
          operation: 'str_replace',
          scope: 'repo',
          path: 'source.md',
          oldString: 'missing',
          newString: 'changed',
        }),
      ).resolves.toMatchObject({ success: false });
      await expect(
        execute({ operation: 'create', scope: 'repo', path: 'source.md', content: 'overwrite' }),
      ).resolves.toMatchObject({ success: false });
      await expect(
        execute({ operation: 'rename', scope: 'repo', path: 'source.md', newPath: 'target.md' }),
      ).resolves.toMatchObject({ success: false });
      await expect(readFile(join(scopePath('repo'), 'source.md'), 'utf8')).resolves.toBe(
        'original',
      );

      await expect(
        execute({ operation: 'rename', scope: 'repo', path: 'source.md', newPath: 'final.md' }),
      ).resolves.toEqual({ success: true });
      expect(await exists(join(scopePath('repo'), 'source.md'))).toBe(false);
      expect(await exists(join(scopePath('repo'), 'final.md'))).toBe(true);
    });

    it('handles realistic multi-file workflows and rename chains without interference', async () => {
      await execute({
        operation: 'create',
        scope: 'session',
        path: 'plan.md',
        content: 'research',
      });
      await execute({
        operation: 'create',
        scope: 'repo',
        path: 'decisions.md',
        content: 'use typescript',
      });
      await execute({
        operation: 'create',
        scope: 'user',
        path: 'preferences.md',
        content: 'concise',
      });
      await execute({ operation: 'create', scope: 'session', path: 'a.md', content: 'rename me' });
      await execute({ operation: 'rename', scope: 'session', path: 'a.md', newPath: 'b.md' });
      await execute({ operation: 'rename', scope: 'session', path: 'b.md', newPath: 'c.md' });

      await expect(
        execute({ operation: 'view', scope: 'session', path: 'c.md' }),
      ).resolves.toMatchObject({
        data: 'rename me',
      });
      await expect(
        execute({ operation: 'view', scope: 'repo', path: 'decisions.md' }),
      ).resolves.toMatchObject({
        data: 'use typescript',
      });
      await expect(
        execute({ operation: 'view', scope: 'user', path: 'preferences.md' }),
      ).resolves.toMatchObject({
        data: 'concise',
      });
    });
  });

  describe('boundaries and realistic stress', () => {
    it.each([
      '../escape.md',
      './note.md',
      'C:\\escape.md',
      '/escape.md',
      'bad\0name.md',
      'bad\nname.md',
    ])('rejects unsafe paths in every scope: %j', async (path) => {
      for (const scope of ['session', 'repo', 'user'] as const) {
        await expect(execute({ operation: 'view', scope, path })).resolves.toMatchObject({
          success: false,
        });
      }
    });

    it('persists large unicode content, deeply nested files, and many siblings', async () => {
      const largeContent = `plan \u{1F680} ${'x'.repeat(1_000_000 - 8)}`;
      const deepPath = `${Array.from({ length: 10 }, (_, index) => `level-${index}`).join('/')}/note.md`;
      await expect(
        execute({ operation: 'create', scope: 'session', path: 'large.md', content: largeContent }),
      ).resolves.toEqual({ success: true });
      await execute({ operation: 'create', scope: 'session', path: deepPath, content: 'deep' });
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          execute({
            operation: 'create',
            scope: 'session',
            path: `many/note-${index}.md`,
            content: String(index),
          }),
        ),
      );

      await expect(
        execute({ operation: 'view', scope: 'session', path: 'large.md' }),
      ).resolves.toEqual({
        success: true,
        data: largeContent,
      });
      await expect(
        execute({ operation: 'view', scope: 'session', path: deepPath }),
      ).resolves.toMatchObject({
        data: 'deep',
      });
      const listing = await execute({ operation: 'view', scope: 'session', path: 'many' });
      expect(listing.data?.split('\n')).toHaveLength(100);
    });
  });
});
