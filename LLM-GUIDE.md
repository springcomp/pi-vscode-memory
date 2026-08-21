# Prompting an LLM to use vscode/memory

Use direct instructions that specify the scope, operation, path, and desired note content. The tool name is `vscode_memory`; its inputs are JSON objects.

## Plan agents

```text
Store your implementation plan in session memory so the next agent can use it.
Call vscode_memory with:
{ "scope": "session", "operation": "create", "path": "plan.md", "content": "..." }
```

Ask a new agent to recover that handoff:

```text
Read the plan left by the planning phase before changing code.
Call vscode_memory with:
{ "scope": "session", "operation": "view", "path": "plan.md" }
```

## Handoffs

```text
Update session/findings.md with the completed investigation. Use an exact, unique
oldString with str_replace; do not overwrite unrelated findings.
```

Example input:

```json
{
  "scope": "session",
  "operation": "str_replace",
  "path": "findings.md",
  "oldString": "## Status\nInvestigating",
  "newString": "## Status\nCause confirmed"
}
```

## Repository knowledge base

```text
Record the verified testing pattern in repo memory for future sessions. Create
patterns/isolated-fixtures.md with the command and the reason it is reliable.
```

```json
{
  "scope": "repo",
  "operation": "create",
  "path": "patterns/isolated-fixtures.md",
  "content": "# Isolated fixtures\nUse a fresh temporary directory per test to prevent state leakage."
}
```

## User preferences

```text
Read my global coding preferences before proposing an implementation. Look for
user/style-guide.md; if it is absent, proceed without inventing preferences.
```

```json
{ "scope": "user", "operation": "view", "path": "style-guide.md" }
```

## Reliable prompting rules

- Tell the model which scope matches the lifetime and audience of the information.
- Give a relative path such as `plan.md` or `patterns/errors.md`; never use absolute paths or `..`.
- Ask it to `view` before `create` when preserving existing knowledge matters.
- For `str_replace`, require the model to include unique surrounding context in `oldString`.
- Use `insert` with a positive one-indexed line; a line beyond the end appends.
- Ask the model to report tool errors rather than assuming a write succeeded.
