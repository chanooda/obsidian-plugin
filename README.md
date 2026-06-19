# chanoo-obsidian-plugins

Turborepo + pnpm monorepo for managing multiple Obsidian plugins in one repository.

## Structure

```
.
├── packages/
│   ├── config/          # @repo/config — shared esbuild + tsconfig
│   └── shared/          # @repo/shared — code shared across plugins
├── plugins/
│   ├── daily-calendar/  # Calendar + daily-note plugin
│   └── hello-world/     # Example plugin using @repo/shared
└── scripts/
    └── deploy.mjs       # Symlink each plugin's dist/ into your vault
```

Each plugin builds into its own `dist/` (containing `main.js`, `manifest.json`,
`styles.css`). The monorepo lives **outside** the Obsidian vault; built plugins are
linked into the vault with symlinks so Obsidian loads them.

## Prerequisites

- Node 18+
- pnpm (`npm i -g pnpm`)

## Setup

```bash
pnpm install
```

## Common commands

```bash
pnpm build          # Build all plugins (turbo, dependency-ordered)
pnpm dev            # Watch-build all plugins
pnpm deploy:vault   # Symlink every plugin's dist/ into the test vault (one-time)
```

Day-to-day: run `pnpm deploy:vault` once to symlink the test vault, then
`pnpm dev` to watch-rebuild. The symlink points at each `dist/`, so dev rebuilds
show up in Obsidian (after reload). Re-run `deploy:vault` only when adding a new
plugin or if a symlink breaks.

## Vault location

`scripts/deploy.mjs` links each plugin into
`<vault>/.obsidian/plugins/<manifest.id>`. **Local deploy is for testing only.**

- `OBSIDIAN_VAULT` is **required** (no default). If unset, deploy aborts — this
  prevents accidentally linking into the real vault.
- The production vault (`/Users/chan/Desktop/chanoo`) is **blocked**: even if you
  point `OBSIDIAN_VAULT` at it, deploy refuses. The real vault is updated only by
  CI on merge to `main` (`.github/workflows/deploy-vault.yml`).

Set the test vault in `.env` (gitignored) once:

```bash
# .env
OBSIDIAN_VAULT=/Users/chan/Desktop/plugin-test
```

`pnpm deploy:vault` loads `.env` automatically. To target a different test vault
for a single run, override it:

```bash
OBSIDIAN_VAULT="/path/to/another/test-vault" pnpm deploy:vault
```

## Adding a new plugin

1. Copy `plugins/hello-world` to `plugins/<your-plugin>`.
2. Update its `package.json` `name` and `manifest.json` `id`/`name`.
3. `pnpm install`, then `pnpm build` and `pnpm deploy:vault`.
