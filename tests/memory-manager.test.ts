import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildScopePath, deriveRepoDir, validateScopeBoundary } from '../src/memory-manager.js';

vi.mock('node:os', () => ({
  homedir: () => join('C:', 'Users', 'test-user'),
}));

describe('deriveRepoDir', () => {
  it.each([
    ['C:\\Projects\\springcomp\\pi\\pi-plan', '--C--Projects-springcomp-pi-pi-plan--'],
    ['/home/user/springcomp/pi/pi-plan', '---home-user-springcomp-pi-pi-plan--'],
    ['C:\\Dev', '--C--Dev--'],
    ['C:\\my.project\\src', '--C--my.project-src--'],
    ['\\\\server\\share', '----server-share--'],
  ])('derives the Pi repository directory for %s', (cwd, expected) => {
    expect(deriveRepoDir(cwd)).toBe(expected);
  });

  it.each([
    ['', /cwd must not be empty/],
    ['relative/path', /cwd must be an absolute path/],
    ['~\\project', /cwd must not contain "~"/],
  ])('rejects invalid working directory %s', (cwd, message) => {
    expect(() => deriveRepoDir(cwd)).toThrow(message);
  });
});

describe('buildScopePath', () => {
  const cwd = 'C:\\Projects\\memory-tool';
  const otherCwd = 'C:\\Projects\\other-tool';
  const repoDir = '--C--Projects-memory-tool--';
  const agentDirectory = join(homedir(), '.pi', 'agent');

  it('builds a stable, absolute session-scoped memory path', () => {
    expect(buildScopePath('session', { cwd, sessionId: 'abc123' })).toEqual({
      scope: 'session',
      path: join(agentDirectory, 'sessions', repoDir, 'memories-abc123'),
      repoDir,
      sessionId: 'abc123',
    });
    expect(isAbsolute(buildScopePath('session', { cwd, sessionId: 'abc123' }).path)).toBe(true);
    expect(buildScopePath('session', { cwd, sessionId: 'abc123' })).toEqual(
      buildScopePath('session', { cwd, sessionId: 'abc123' }),
    );
  });

  it('builds an absolute repository-scoped memory path and ignores session IDs', () => {
    const withoutSession = buildScopePath('repo', { cwd });

    expect(withoutSession).toEqual({
      scope: 'repo',
      path: join(agentDirectory, 'sessions', repoDir, 'memories'),
      repoDir,
    });
    expect(buildScopePath('repo', { cwd, sessionId: 'ignored' })).toEqual(withoutSession);
    expect(isAbsolute(withoutSession.path)).toBe(true);
  });

  it('builds an absolute user-scoped memory path independent of the repository', () => {
    const userPath = buildScopePath('user', { cwd });

    expect(userPath).toEqual({
      scope: 'user',
      path: join(agentDirectory, 'memories'),
      repoDir,
    });
    expect(buildScopePath('user', { cwd: otherCwd }).path).toBe(userPath.path);
    expect(isAbsolute(userPath.path)).toBe(true);
  });

  it('keeps session paths distinct across sessions and repositories', () => {
    expect(buildScopePath('session', { cwd, sessionId: 'first' }).path).not.toBe(
      buildScopePath('session', { cwd, sessionId: 'second' }).path,
    );
    expect(buildScopePath('session', { cwd, sessionId: 'first' }).path).not.toBe(
      buildScopePath('session', { cwd: otherCwd, sessionId: 'first' }).path,
    );
  });

  it('requires a session ID for session-scoped memory', () => {
    expect(() => buildScopePath('session', { cwd })).toThrow(/sessionId/);
  });

  it('rejects an invalid memory scope at runtime', () => {
    expect(() => buildScopePath('invalid' as never, { cwd })).toThrow(/Invalid memory scope/);
  });
});

describe('validateScopeBoundary', () => {
  const scopePath = join(homedir(), '.pi', 'agent', 'memories');

  it.each([
    'memory.md',
    'notes/session.md',
    'folder/deep/nested/file.md',
    'my_notes-2024.md',
    'task-001-notes.md',
    'unicode-\u2024-name.md',
  ])('accepts scoped relative file path %s', (filePath) => {
    expect(validateScopeBoundary('user', filePath, scopePath)).toBe(true);
  });

  it('rejects an empty file path', () => {
    expect(() => validateScopeBoundary('user', '', scopePath)).toThrow(/must not be empty/);
  });

  it.each([
    '../outside.md',
    '../../outside.md',
    'notes/../outside.md',
    './memory.md',
    '.hidden',
    '..',
    'C:\\outside.md',
    '/outside.md',
    'bad\0name.md',
    'bad\nname.md',
    'bad\rname.md',
  ])('rejects unsafe file path %s', (filePath) => {
    expect(() => validateScopeBoundary('user', filePath, scopePath)).toThrow();
  });

  it('rejects traversal regardless of nesting and normalizes only safe names', () => {
    expect(() =>
      validateScopeBoundary('repo', '../../etc/passwd', join('C:', 'temp', 'scope')),
    ).toThrow(/traversal segments/);
    expect(() => validateScopeBoundary('repo', './file.md', scopePath)).toThrow(
      /traversal segments/,
    );
    expect(validateScopeBoundary('repo', 'file.md', scopePath)).toBe(true);
  });
});
