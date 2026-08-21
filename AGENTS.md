This is a workspace containing the `vscode/memory` tool and its filesystem operations.
This is heavily inspired and most closely replicates VSCode’s own [`vscode/memory`](.agentic/DESIGN.md) design.

Tool is called `vscode/memory` to acknowledge the lineage.

# Tech stack

- node
- pnpm package manager
- typescript
- biomejs linting and formatting
- vitest + coverage
- typechecking

- coverage ⩾ 90%

# PI specifics

Pi-specific :

- sessions are store in repo specific folder `~/.pi/agent/sessions/`
- session-scoped memory lives in `~/.pi/agent/sessions/{REPO-DIR}/memories-{SESSION-ID}/`
- repo-scoped memory lives in `~/.pi/agent/sessions/{REPO-DIR}/memories/`
- user-scoped memory lives in `~/.pi/agent/memories/`

Where `{REPO-DIR}` is the folder pi creates per-repo. E.g.

- `--C--Projects-springcomp-pi--`
- `--C--Projects-springcomp-pi-pi-subagents--`

(seems to be derived from repo folder name, replacing `:`, `\` and `/` path separators and maybe others - lookup into your documentation / source code to replicate this behaviour)

The tool can store any kind of notes in its "store".
Unless explicitely named, a default `memory.md` note is used.
