# vscode/memory workflows

Each JSON block is an input to `vscode_memory`. Paths are relative to the selected scope.

## 1. Plan to implementation handoff

A planning agent stores the plan for the implementation agent in the same session:

```json
{
  "scope": "session",
  "operation": "create",
  "path": "plan.md",
  "content": "# Implementation plan\n1. Add validation\n2. Add tests\n3. Run checks"
}
```

The implementation agent starts by reading it, then records progress:

```json
{ "scope": "session", "operation": "view", "path": "plan.md" }
```

```json
{
  "scope": "session",
  "operation": "create",
  "path": "progress.md",
  "content": "# Progress\n- Validation complete"
}
```

Both agents can record a durable decision:

```json
{
  "scope": "repo",
  "operation": "insert",
  "path": "decisions.md",
  "line": 999,
  "content": "## Validation\nUse schema validation at the tool boundary."
}
```

## 2. Testing decisions log

Create a repository note after selecting a testing pattern:

```json
{
  "scope": "repo",
  "operation": "create",
  "path": "testing-decisions.md",
  "content": "# Testing decisions\n- Use isolated temporary directories for filesystem tests.\n- Run coverage in CI."
}
```

A later session can retrieve the rationale before extending tests:

```json
{ "scope": "repo", "operation": "view", "path": "testing-decisions.md" }
```

## 3. Bug investigation handoff

The first developer captures reproduction details:

```json
{
  "scope": "session",
  "operation": "create",
  "path": "bug-investigation.md",
  "content": "# Reproduction\n1. Open settings\n2. Save an empty value\n\n# Observed\nValidation error"
}
```

The next developer adds findings with an exact replacement:

```json
{
  "scope": "session",
  "operation": "str_replace",
  "path": "bug-investigation.md",
  "oldString": "# Observed\nValidation error",
  "newString": "# Observed\nValidation error\n\n# Finding\nAn empty value reaches the parser."
}
```

After the fix, preserve the reusable lesson in repository memory.

```json
{
  "scope": "repo",
  "operation": "create",
  "path": "patterns/empty-input.md",
  "content": "# Empty input\nValidate required strings before parsing."
}
```

## 4. Project onboarding notes

Create a repository onboarding guide:

```json
{
  "scope": "repo",
  "operation": "create",
  "path": "onboarding.md",
  "content": "# Onboarding\n## Setup\npnpm install\n## Checks\npnpm test\n## Gotchas\nKeep generated files out of commits."
}
```

New sessions read it before making changes:

```json
{ "scope": "repo", "operation": "view", "path": "onboarding.md" }
```

## 5. User template library

Create a template once:

```json
{
  "scope": "user",
  "operation": "create",
  "path": "templates/ts-function.md",
  "content": "export function name(input: string): string {\n  return input;\n}"
}
```

Any repository can retrieve it:

```json
{ "scope": "user", "operation": "view", "path": "templates/ts-function.md" }
```

## 6. Renaming a draft decision

Promote a reviewed repository draft without overwriting a final note:

```json
{
  "scope": "repo",
  "operation": "rename",
  "path": "drafts/cache.md",
  "newPath": "decisions/cache.md"
}
```

## 7. Cleaning session scratch space

Remove temporary artifacts at the end of an investigation:

```json
{ "scope": "session", "operation": "delete", "path": "scratch" }
```
