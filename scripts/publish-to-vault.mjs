import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLUGINS_DIR = join(ROOT, "plugins");

// Obsidian이 로드하는 빌드 산출물만 화이트리스트로 배포한다.
// data.json(런타임 데이터, iCloud 자격증명 평문 가능)은 절대 포함하지 않는다.
export const PUBLISH_WHITELIST = [
	"main.js",
	"manifest.json",
	"styles.css",
	"versions.json",
];

// dist 파일 목록에서 배포 대상만 화이트리스트 순서로 고른다(순수 함수).
export function selectPublishFiles(distEntries) {
	return PUBLISH_WHITELIST.filter((file) => distEntries.includes(file));
}

function isSymlink(p) {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

function main() {
	const vaultArg = process.argv[2];
	if (!vaultArg) {
		console.error("사용법: node scripts/publish-to-vault.mjs <vault-체크아웃-경로>");
		process.exit(1);
	}

	const vault = resolve(vaultArg);
	const targetBase = join(vault, ".obsidian", "plugins");
	if (!existsSync(targetBase)) {
		console.error(`✗ vault 플러그인 폴더를 찾을 수 없음: ${targetBase}`);
		process.exit(1);
	}

	let published = 0;
	for (const name of readdirSync(PLUGINS_DIR)) {
		const pluginDir = join(PLUGINS_DIR, name);
		const manifestPath = join(pluginDir, "manifest.json");
		const distDir = join(pluginDir, "dist");

		if (!existsSync(manifestPath)) continue;
		if (!existsSync(distDir)) {
			console.warn(`⚠ ${name}: dist/ 없음 — "pnpm build"를 먼저 실행. 건너뜀.`);
			continue;
		}

		const { id } = JSON.parse(readFileSync(manifestPath, "utf8"));
		const files = selectPublishFiles(readdirSync(distDir));
		const target = join(targetBase, id);

		// 기존 항목(깨진 심링크 포함)을 지우고 실제 디렉터리로 다시 만든다.
		if (existsSync(target) || isSymlink(target)) {
			rmSync(target, { recursive: true, force: true });
		}
		mkdirSync(target, { recursive: true });

		for (const file of files) {
			copyFileSync(join(distDir, file), join(target, file));
		}
		console.log(`✓ ${name} → ${target} (${files.join(", ")})`);
		published++;
	}

	console.log(`\n${published}개 플러그인을 ${targetBase}에 배포함`);
}

// 직접 실행될 때만 I/O 수행(테스트 import 시에는 실행하지 않음).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
