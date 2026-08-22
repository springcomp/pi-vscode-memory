# vscode/memory

Persistent, scoped notes for [pi](https://github.com/badlogic/pi-mono). The extension registers the `memory` tool so agents can keep plans, findings, decisions, and preferences outside the repository working tree.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Tool schema](#tool-schema)
- [Virtual paths](#virtual-paths)
- [Operations](#operations)
- [Usage examples](#usage-examples)
- [Best practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)

## Overview

`memory` provides three persistence boundaries, selected entirely through the `path` you pass:

| Path prefix | Best for | Shared with |
| --- | --- | --- |
| `/memories/session/...` | Current plan, findings, and handoff state | This session only |
| `/memories/sessions/...` | Verified commands, conventions, and decisions | All sessions in this repository |
| `/memories/...` | Personal preferences and reusable templates | All repositories and sessions |

For example, create a plan for the current conversation:

```json
{
  "operation": "create",
  "path": "/memories/session/plan.md",
  "content": "# Plan\n1. Inspect\n2. Implement\n3. Verify"
}
```

See [examples.md](examples.md) for complete workflows and [LLM-GUIDE.md](LLM-GUIDE.md) for prompt wording.

## Installation

Copy this directory to pi's extensions directory:

```powershell
Copy-Item -Recurse . "$HOME\.pi\agent\extensions\vscode-memory"
```

Run pi from that extension directory, or configure pi to load `src/index.ts`. Verify the extension loaded with pi's `/tools` command: it must list `memory`.

This project is not currently published as an npm or pip package. If it is published later, use the package's documented install command rather than copying the directory.

## Tool schema

Tool name: `memory`.

| Parameter | Type | Required for | Description |
| --- | --- | --- | --- |
| `operation` | `"view" \| "create" \| "str_replace" \| "insert" \| "delete" \| "rename"` | all | Action to perform |
| `path` | string | all | A fully qualified virtual path, e.g. `/memories/session/plan.md` |
| `content` | string | `create`, `insert` | Text to write or insert |
| `oldString` | string | `str_replace` | Exact, unique text to replace |
| `newString` | string | `str_replace` | Replacement text |
| `line` | positive integer | `insert` | One-indexed insertion line |
| `newPath` | string | `rename` | Fully qualified virtual destination |

Paths cannot contain `.` or `..` segments, null bytes, or line breaks. Content fields accept up to 1,000,000 characters; paths accept up to 1,024 characters.

## Virtual paths

Every call is made against a fully qualified virtual path (FQVP): a single string that names both the memory scope and the file within it. There is no separate scope parameter to set.

| Virtual path form | Resolves to |
| --- | --- |
| `/memories/<file>` | User scope: `~/.pi/agent/memories/<file>` |
| `/memories/sessions/<file>` | Repository scope: `~/.pi/agent/sessions/{REPO-DIR}/memories/<file>` |
| `/memories/session/<file>` | Session scope (singular): `~/.pi/agent/sessions/{REPO-DIR}/memories-{SESSION-ID}/<file>` |

`{REPO-DIR}` is pi's normalized directory identifier, for example `--C--Projects--app--`. The same `/memories/sessions/<file>` path therefore points at different storage in different repositories, and `/memories/session/<file>` points at different storage in different sessions, even though the path text looks identical.

### Scope roots and defaults

| Path | Meaning |
| --- | --- |
| `/memories`, `/memories/` | User scope's default `memory.md` |
| `/memories/session`, `/memories/session/` | Session scope's default `memory.md` |
| `/memories/sessions`, `/memories/sessions/` | Repo scope's default `memory.md` |
| `/memories/*` | List the user scope root's entries |
| `/memories/session/*` | List the session scope root's entries |
| `/memories/sessions/*` | List the repo scope root's entries |
| `<file>` (no prefix) | Session scope's `<file>` (UQVP, defaults to session) |

Because `/memories/session` and `/memories/sessions` are claimed by the session and repo prefixes, a *user*-scoped file literally named `session` or `sessions` cannot be addressed this way — `/memories/session` always means the session scope root. A file named `session.md` (with an extension) is unaffected and resolves under user scope as expected, e.g. `/memories/session.md`.

A literal trailing `*` segment requests an explicit directory listing of the scope root, equivalent to `view`-ing that scope's directory. It is distinct from the bare scope root, which addresses the default `memory.md` note.

- **Session scope** (`/memories/session/...`): current task state, temporary findings, and agent handoffs. Lives until the session is deleted. Visible only to that session.
- **Repository scope** (`/memories/sessions/...`): build commands, tested patterns, onboarding notes, and decision logs. Lives until the repository's pi session data is deleted. Visible to every session in that repository.
- **User scope** (`/memories/...`): coding preferences, templates, and reusable insights. Lives indefinitely. Visible across all repositories and sessions for the current user.

For `rename`, both `path` and `newPath` must resolve to the same scope; renaming across scopes is rejected.

## Operations

### `view`

Reads a file or lists a directory's immediate entries. Reading a missing path succeeds with a definite empty result (`Empty: '<path>' does not exist yet...`) — this is not an error and not transient. Do not retry the same `view` call expecting a different outcome; either `create` the file or move on.

```json
{ "operation": "view", "path": "/memories/session/memory.md" }
```

List entries in a scope root explicitly with a literal `*`:

```json
{ "operation": "view", "path": "/memories/session/*" }
```

### `create`

Creates a new UTF-8 file and any missing parent directories. It fails if the destination already exists.

```json
{
  "operation": "create",
  "path": "/memories/session/memory.md",
  "content": "# Session Plan\n- Inspect\n- Implement"
}
```

### `str_replace`

Replaces one exact string. It fails when the file is absent, the string is absent, or the string occurs more than once.

```json
{
  "operation": "str_replace",
  "path": "/memories/session/memory.md",
  "oldString": "- Inspect",
  "newString": "- Inspect (done)"
}
```

### `insert`

Inserts content before a one-indexed line. A line past the end appends; a missing file is created.

```json
{
  "operation": "insert",
  "path": "/memories/sessions/decisions.md",
  "line": 5,
  "content": "## Decision\n- Prefer structured errors."
}
```

### `delete`

Recursively removes a file or directory. It is idempotent: a missing path is not an error.

```json
{ "operation": "delete", "path": "/memories/session/scratch.md" }
```

### `rename`

Moves or renames an existing item within its current scope. It fails when the source is missing, the destination exists, or `path` and `newPath` resolve to different scopes.

```json
{
  "operation": "rename",
  "path": "/memories/sessions/draft.md",
  "newPath": "/memories/sessions/decisions.md"
}
```

## Usage examples

An agent can hand off a plan by creating `/memories/session/plan.md`; the next agent reads the same session-scoped path:

```json
{ "operation": "view", "path": "/memories/session/plan.md" }
```

For repository knowledge that must survive sessions, write `/memories/sessions/patterns/error-handling.md` and have later sessions view it:

```json
{
  "operation": "create",
  "path": "/memories/sessions/patterns/error-handling.md",
  "content": "# Error handling\n- Validate input\n- Return structured errors"
}
```

For preferences available in every repository, save a user-level style guide:

```json
{
  "operation": "create",
  "path": "/memories/style-guide.md",
  "content": "# Style\n- Strict TypeScript\n- ESM modules"
}
```

## Best practices

- Use `memory.md`, `plan.md`, `findings.md`, and `decisions.md` for predictable discovery.
- Organize durable notes under `patterns/`, `notes/`, or `templates/` within the chosen scope.
- Put temporary investigation state under `/memories/session/...`, verified project knowledge under `/memories/sessions/...`, and personal defaults under `/memories/...`.
- Include enough surrounding text in `oldString` to make `str_replace` unique.
- Read existing memory before creating a durable note, because `create` never overwrites.

## Troubleshooting

| Symptom | Meaning and resolution |
| --- | --- |
| Empty `view` result | Definite: path does not exist. One `view` call is conclusive — do not retry. Use `create` if a file is needed. |
| `Ambiguous: multiple matches found` | Make `oldString` more specific, then retry `str_replace`. |
| Scope-boundary error | Use a virtual path without `.`/`..`, hidden segments, null bytes, or newlines. |
| `File already exists` | Read and update the existing file, or choose another path. |
| Tool absent from `/tools` | Confirm pi loads `src/index.ts` from this extension directory. |

## API reference

TypeScript definitions live in [src/types.ts](src/types.ts): `MemoryScope`, `MemoryOperation`, per-operation input interfaces, `MemoryInput`, and `MemoryResult`. Runtime schema and validation are exported from [src/vscode-memory.ts](src/vscode-memory.ts).
