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
pnpm deploy:vault   # Symlink every plugin's dist/ into the vault
pnpm build:deploy   # Build then deploy
```

## Vault location

`scripts/deploy.mjs` links each plugin into
`<vault>/.obsidian/plugins/<manifest.id>`. The vault path defaults to
`/Users/chan/Desktop/chanoo` and can be overridden:

```bash
OBSIDIAN_VAULT="/path/to/your/vault" pnpm deploy:vault
```

## Adding a new plugin

1. Copy `plugins/hello-world` to `plugins/<your-plugin>`.
2. Update its `package.json` `name` and `manifest.json` `id`/`name`.
3. `pnpm install`, then `pnpm build:deploy`.
