# vscode/memory workflows

Each JSON block is an input to `memory`. Every `path` is a fully qualified virtual path (FQVP) that encodes its own scope — there is no separate `scope` field.

- `/memories/session/<file>` — session scope (this conversation only)
- `/memories/sessions/<file>` — repo scope (shared by this repository)
- `/memories/<file>` — user scope (global)

## 1. Plan to implementation handoff

A planning agent stores the plan for the implementation agent in the same session:

```json
{
  "operation": "create",
  "path": "/memories/session/plan.md",
  "content": "# Implementation plan\n1. Add validation\n2. Add tests\n3. Run checks"
}
```

The implementation agent starts by reading it, then records progress:

```json
{ "operation": "view", "path": "/memories/session/plan.md" }
```

```json
{
  "operation": "create",
  "path": "/memories/session/progress.md",
  "content": "# Progress\n- Validation complete"
}
```

Both agents can record a durable decision:

```json
{
  "operation": "insert",
  "path": "/memories/sessions/decisions.md",
  "line": 999,
  "content": "## Validation\nUse schema validation at the tool boundary."
}
```

## 2. Testing decisions log

Create a repository note after selecting a testing pattern:

```json
{
  "operation": "create",
  "path": "/memories/sessions/testing-decisions.md",
  "content": "# Testing decisions\n- Use isolated temporary directories for filesystem tests.\n- Run coverage in CI."
}
```

A later session can retrieve the rationale before extending tests:

```json
{ "operation": "view", "path": "/memories/sessions/testing-decisions.md" }
```

## 3. Bug investigation handoff

The first developer captures reproduction details:

```json
{
  "operation": "create",
  "path": "/memories/session/bug-investigation.md",
  "content": "# Reproduction\n1. Open settings\n2. Save an empty value\n\n# Observed\nValidation error"
}
```

The next developer adds findings with an exact replacement:

```json
{
  "operation": "str_replace",
  "path": "/memories/session/bug-investigation.md",
  "oldString": "# Observed\nValidation error",
  "newString": "# Observed\nValidation error\n\n# Finding\nAn empty value reaches the parser."
}
```

After the fix, preserve the reusable lesson in repository memory.

```json
{
  "operation": "create",
  "path": "/memories/sessions/patterns/empty-input.md",
  "content": "# Empty input\nValidate required strings before parsing."
}
```

## 4. Project onboarding notes

Create a repository onboarding guide:

```json
{
  "operation": "create",
  "path": "/memories/sessions/onboarding.md",
  "content": "# Onboarding\n## Setup\npnpm install\n## Checks\npnpm test\n## Gotchas\nKeep generated files out of commits."
}
```

New sessions read it before making changes:

```json
{ "operation": "view", "path": "/memories/sessions/onboarding.md" }
```

## 5. User template library

Create a template once:

```json
{
  "operation": "create",
  "path": "/memories/templates/ts-function.md",
  "content": "export function name(input: string): string {\n  return input;\n}"
}
```

Any repository can retrieve it:

```json
{ "operation": "view", "path": "/memories/templates/ts-function.md" }
```

## 6. Renaming a draft decision

Promote a reviewed repository draft without overwriting a final note. Both paths must use the same scope prefix:

```json
{
  "operation": "rename",
  "path": "/memories/sessions/drafts/cache.md",
  "newPath": "/memories/sessions/decisions/cache.md"
}
```

## 7. Cleaning session scratch space

Remove temporary artifacts at the end of an investigation:

```json
{ "operation": "delete", "path": "/memories/session/scratch" }
```
