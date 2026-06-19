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

// 실제 배포 vault. 로컬에서 여기로 심링크하면 CI로 배포된 진짜 플러그인과
// 충돌하므로 차단한다. 실제 배포는 main 머지 시 CI(publish-to-vault.mjs)만 담당.
const PRODUCTION_VAULT = "/Users/chan/Desktop/chanoo";

// OBSIDIAN_VAULT는 필수(default 없음). 미설정 시 실수로 실제 vault에 배포되는 걸 막는다.
const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) {
	console.error("✗ OBSIDIAN_VAULT가 설정되지 않았습니다.");
	console.error("  테스트 vault 경로를 .env(OBSIDIAN_VAULT=...)에 두거나 환경변수로 지정 후 재시도하세요.");
	process.exit(1);
}

if (resolve(VAULT) === resolve(PRODUCTION_VAULT)) {
	console.error(`✗ 실제 배포 vault로는 로컬 배포할 수 없습니다: ${VAULT}`);
	console.error("  실제 플러그인은 main 머지 시 CI가 배포합니다. 로컬에선 테스트 vault만 사용하세요.");
	process.exit(1);
}

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
