// Symlink each plugin's built dist/ into the Obsidian vault so Obsidian loads it.
// Vault path: $OBSIDIAN_VAULT, or the default below.
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLUGINS_DIR = join(ROOT, "plugins");

const VAULT = process.env.OBSIDIAN_VAULT || "/Users/chan/Desktop/chanoo";
const TARGET_BASE = join(VAULT, ".obsidian", "plugins");

function isSymlink(p) {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

if (!existsSync(VAULT)) {
	console.error(`✗ Vault not found: ${VAULT}`);
	console.error("  Set OBSIDIAN_VAULT to your vault path and retry.");
	process.exit(1);
}

mkdirSync(TARGET_BASE, { recursive: true });

let linked = 0;
for (const name of readdirSync(PLUGINS_DIR)) {
	const pluginDir = join(PLUGINS_DIR, name);
	const manifestPath = join(pluginDir, "manifest.json");
	const distDir = join(pluginDir, "dist");

	if (!existsSync(manifestPath)) continue;
	if (!existsSync(distDir)) {
		console.warn(`⚠ ${name}: no dist/ — run "pnpm build" first. Skipping.`);
		continue;
	}

	const { id } = JSON.parse(readFileSync(manifestPath, "utf8"));
	const target = join(TARGET_BASE, id);

	if (existsSync(target) || isSymlink(target)) {
		rmSync(target, { recursive: true, force: true });
	}
	symlinkSync(distDir, target);
	console.log(`✓ ${name} → ${target}`);
	linked++;
}

console.log(`\nLinked ${linked} plugin(s) into ${TARGET_BASE}`);
