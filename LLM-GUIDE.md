# Prompting an LLM to use vscode/memory

Use direct instructions that specify the operation, virtual path, and desired note content. The tool name is `memory`; its inputs are JSON objects. There is no separate scope field: the scope is encoded in the `path` itself as a fully qualified virtual path (FQVP).

| Virtual path prefix | Scope |
| --- | --- |
| `/memories/session/...` | session (singular — this conversation only) |
| `/memories/sessions/...` | repo (plural — shared by this repository) |
| `/memories/...` | user (global) |

A bare scope root (`/memories`, `/memories/session`, `/memories/sessions`) addresses that scope's default `memory.md`. A literal trailing `*` (`/memories/*`, `/memories/session/*`, `/memories/sessions/*`) instead lists the entries in that scope root.

## Plan agents

```text
Store your implementation plan in session memory so the next agent can use it.
Call memory with:
{ "operation": "create", "path": "/memories/session/plan.md", "content": "..." }
```

Ask a new agent to recover that handoff:

```text
Read the plan left by the planning phase before changing code.
Call memory with:
{ "operation": "view", "path": "/memories/session/plan.md" }
```

## Handoffs

```text
Update session findings.md with the completed investigation. Use an exact, unique
oldString with str_replace; do not overwrite unrelated findings.
```

Example input:

```json
{
  "operation": "str_replace",
  "path": "/memories/session/findings.md",
  "oldString": "## Status\nInvestigating",
  "newString": "## Status\nCause confirmed"
}
```

## Repository knowledge base

```text
Record the verified testing pattern in repository memory for future sessions. Create
patterns/isolated-fixtures.md with the command and the reason it is reliable.
```

```json
{
  "operation": "create",
  "path": "/memories/sessions/patterns/isolated-fixtures.md",
  "content": "# Isolated fixtures\nUse a fresh temporary directory per test to prevent state leakage."
}
```

## User preferences

```text
Read my global coding preferences before proposing an implementation. Look for
style-guide.md in user memory; if it is absent, proceed without inventing preferences.
```

```json
{ "operation": "view", "path": "/memories/style-guide.md" }
```

## Reliable prompting rules

- Tell the model which virtual path prefix matches the lifetime and audience of the information.
- Give a fully qualified virtual path such as `/memories/session/plan.md` or `/memories/sessions/patterns/errors.md`; never use absolute filesystem paths or `..`.
- Ask it to `view` before `create` when preserving existing knowledge matters.
- Tell it an empty `view` result is definite (file absent), not a transient failure — one call settles it, never retry the same `view`.
- For `str_replace`, require the model to include unique surrounding context in `oldString`.
- Use `insert` with a positive one-indexed line; a line beyond the end appends.
- For `rename`, both `path` and `newPath` must use the same virtual path prefix (same scope).
- Ask the model to report tool errors rather than assuming a write succeeded.
