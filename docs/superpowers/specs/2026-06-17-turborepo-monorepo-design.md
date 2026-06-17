# Turborepo Monorepo for Obsidian Plugins — Design

Date: 2026-06-17

## Goal

Convert the single `obsidian-plugin` project into a Turborepo + pnpm monorepo so
multiple Obsidian plugins can be developed and managed in one repository, sharing
build configuration and library code.

## Decisions

- **Location:** Monorepo lives outside the vault at
  `/Users/chan/Desktop/chanoo-obsidian-plugins` (sibling of the vault `chanoo`).
- **Package manager:** pnpm workspaces.
- **Task runner:** Turborepo.
- **Deployment:** each plugin builds into its own `dist/`; a deploy script
  symlinks `dist/` into `<vault>/.obsidian/plugins/<manifest.id>` so Obsidian
  loads it.
- **Existing plugin:** moved to `plugins/daily-calendar`, manifest `id` renamed
  from `obsidian-plugin` to `daily-calendar` (name "Daily Calendar").

## Structure

```
chanoo-obsidian-plugins/
├── package.json            # root, private, turbo + pnpm scripts
├── pnpm-workspace.yaml     # packages/*, plugins/*
├── turbo.json              # build / dev / lint / clean tasks
├── scripts/deploy.mjs      # symlink each plugin dist/ into the vault
├── packages/
│   ├── config/             # @repo/config — shared esbuild base + tsconfig
│   └── shared/             # @repo/shared — utils shared across plugins
└── plugins/
    ├── daily-calendar/     # existing plugin (calendar + daily notes)
    └── hello-world/        # example plugin consuming @repo/shared
```

## Build & deploy flow

1. `@repo/config` exposes `createPluginBuild({ pluginDir, production })`
   (esbuild: bundle `src/main.ts` → `dist/main.js`, externalize obsidian +
   codemirror, copy `manifest.json`/`styles.css`/`versions.json` into `dist/`).
2. Each plugin's `esbuild.config.mjs` calls that builder; its `tsconfig.json`
   extends `@repo/config/tsconfig.json`.
3. `pnpm build` runs `turbo run build` (dependency-ordered: config/shared first).
4. `pnpm deploy` symlinks each `plugins/<name>/dist` into the vault.
5. `pnpm dev` watch-builds; deploy once and Obsidian picks up rebuilds.

## Shared package

`@repo/shared` exports source TypeScript (`greeting`, `formatDate`, `isSameDay`);
esbuild bundles it directly into each consuming plugin — no pre-build step.

## Recovery note

During the migration the original plugin folder was lost from disk. Source was
recovered from VS Code Local History: `main.ts` and `calendar-view.ts` recovered
exactly; `styles.css` and `manifest.json` recovered; `settings.ts` was
reconstructed from its usage in code (only `calendarFolder: string` is consumed).
The plugin's previous git history was not recoverable; the monorepo starts a
fresh git history.
