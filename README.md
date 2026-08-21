# vscode/memory

Persistent, scoped notes for [pi](https://github.com/badlogic/pi-mono). The extension registers the `vscode_memory` tool so agents can keep plans, findings, decisions, and preferences outside the repository working tree.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Tool schema](#tool-schema)
- [Scopes](#scopes)
- [Operations](#operations)
- [Usage examples](#usage-examples)
- [Best practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)

## Overview

`vscode_memory` provides three persistence boundaries:

| Scope | Best for | Shared with |
| --- | --- | --- |
| `session` | Current plan, findings, and handoff state | This session only |
| `repo` | Verified commands, conventions, and decisions | All sessions in this repository |
| `user` | Personal preferences and reusable templates | All repositories and sessions |

For example, create a plan for the current conversation:

```json
{
  "scope": "session",
  "operation": "create",
  "path": "plan.md",
  "content": "# Plan\n1. Inspect\n2. Implement\n3. Verify"
}
```

See [examples.md](examples.md) for complete workflows and [LLM-GUIDE.md](LLM-GUIDE.md) for prompt wording.

## Installation

Copy this directory to pi's extensions directory:

```powershell
Copy-Item -Recurse . "$HOME\.pi\agent\extensions\vscode-memory"
```

Run pi from that extension directory, or configure pi to load `src/index.ts`. Verify the extension loaded with pi's `/tools` command: it must list `vscode_memory`.

This project is not currently published as an npm or pip package. If it is published later, use the package's documented install command rather than copying the directory.

## Tool schema

Tool name: `vscode_memory`.

| Parameter | Type | Required for | Description |
| --- | --- | --- | --- |
| `scope` | `"session" \| "repo" \| "user"` | all | Persistence boundary |
| `operation` | `"view" \| "create" \| "str_replace" \| "insert" \| "delete" \| "rename"` | all | Action to perform |
| `path` | string | all | Non-empty relative path within the scope |
| `content` | string | `create`, `insert` | Text to write or insert |
| `oldString` | string | `str_replace` | Exact, unique text to replace |
| `newString` | string | `str_replace` | Replacement text |
| `line` | positive integer | `insert` | One-indexed insertion line |
| `newPath` | string | `rename` | Relative destination within the same scope |

Paths cannot be absolute, contain `.` or `..` segments, null bytes, or line breaks. Content fields accept up to 1,000,000 characters; paths accept up to 1,024 characters.

## Scopes

### Session scope

- **Location:** `~/.pi/agent/sessions/{REPO-DIR}/memories-{SESSION-ID}/`
- **Use:** current task state, temporary findings, and agent handoffs.
- **Lifetime:** until the corresponding session is deleted.
- **Access:** only the current session; another session in the same repository has a different directory.

### Repo scope

- **Location:** `~/.pi/agent/sessions/{REPO-DIR}/memories/`
- **Use:** build commands, tested patterns, onboarding notes, and decision logs.
- **Lifetime:** until the repository's pi session data is deleted.
- **Access:** every session whose working directory resolves to this repository directory.

### User scope

- **Location:** `~/.pi/agent/memories/`
- **Use:** coding preferences, templates, and reusable insights.
- **Lifetime:** indefinite, subject to deleting pi's user data.
- **Access:** all repositories and sessions for the current user.

`{REPO-DIR}` is pi's normalized directory identifier, for example `--C--Projects--app--`.

## Operations

### `view`

Reads a file or lists a directory's immediate entries. Reading a missing path succeeds with an empty result.

```json
{ "scope": "session", "operation": "view", "path": "memory.md" }
```

### `create`

Creates a new UTF-8 file and any missing parent directories. It fails if the destination already exists.

```json
{
  "scope": "session",
  "operation": "create",
  "path": "memory.md",
  "content": "# Session Plan\n- Inspect\n- Implement"
}
```

### `str_replace`

Replaces one exact string. It fails when the file is absent, the string is absent, or the string occurs more than once.

```json
{
  "scope": "session",
  "operation": "str_replace",
  "path": "memory.md",
  "oldString": "- Inspect",
  "newString": "- Inspect (done)"
}
```

### `insert`

Inserts content before a one-indexed line. A line past the end appends; a missing file is created.

```json
{
  "scope": "repo",
  "operation": "insert",
  "path": "decisions.md",
  "line": 5,
  "content": "## Decision\n- Prefer structured errors."
}
```

### `delete`

Recursively removes a file or directory. It is idempotent: a missing path is not an error.

```json
{ "scope": "session", "operation": "delete", "path": "scratch.md" }
```

### `rename`

Moves or renames an existing item within its current scope. It fails when the source is missing or the destination exists.

```json
{
  "scope": "repo",
  "operation": "rename",
  "path": "draft.md",
  "newPath": "decisions.md"
}
```

## Usage examples

An agent can hand off a plan by creating `session/plan.md`; the next agent reads the same `session` path:

```json
{ "scope": "session", "operation": "view", "path": "plan.md" }
```

For repository knowledge that must survive sessions, write `repo/patterns/error-handling.md` and have later sessions view it:

```json
{
  "scope": "repo",
  "operation": "create",
  "path": "patterns/error-handling.md",
  "content": "# Error handling\n- Validate input\n- Return structured errors"
}
```

For preferences available in every repository, save a user-level style guide:

```json
{
  "scope": "user",
  "operation": "create",
  "path": "style-guide.md",
  "content": "# Style\n- Strict TypeScript\n- ESM modules"
}
```

## Best practices

- Use `memory.md`, `plan.md`, `findings.md`, and `decisions.md` for predictable discovery.
- Organize durable notes under `patterns/`, `notes/`, or `templates/`.
- Put temporary investigation state in `session`, verified project knowledge in `repo`, and personal defaults in `user`.
- Include enough surrounding text in `oldString` to make `str_replace` unique.
- Read existing memory before creating a durable note, because `create` never overwrites.

## Troubleshooting

| Symptom | Meaning and resolution |
| --- | --- |
| Empty `view` result | The path does not exist yet; use `create` if a file is needed. |
| `Ambiguous: multiple matches found` | Make `oldString` more specific, then retry `str_replace`. |
| Scope-boundary error | Use a relative path without absolute paths, `.`/`..`, hidden segments, null bytes, or newlines. |
| `File already exists` | Read and update the existing file, or choose another path. |
| Tool absent from `/tools` | Confirm pi loads `src/index.ts` from this extension directory. |

## API reference

TypeScript definitions live in [src/types.ts](src/types.ts): `MemoryScope`, `MemoryOperation`, per-operation input interfaces, `MemoryInput`, and `MemoryResult`. Runtime schema and validation are exported from [src/vscode-memory.ts](src/vscode-memory.ts).
