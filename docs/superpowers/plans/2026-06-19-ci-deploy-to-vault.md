# Vault 배포 CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모노레포 `main`이 갱신되면 빌드 산출물을 `chanooda/obsidian` vault의 `.obsidian/plugins/<id>/`로 push하는 GitHub Actions CI를 추가한다.

**Architecture:** 빌드 산출물을 화이트리스트로 골라 복사하는 순수-함수 기반 Node 스크립트(`scripts/publish-to-vault.mjs`)와, main push 시 빌드→vault 체크아웃→복사→커밋/push 하는 워크플로우(`.github/workflows/deploy-vault.yml`) 두 가지로 구성한다.

**Tech Stack:** Node ESM(.mjs), vitest, GitHub Actions, pnpm.

## Global Constraints

- 언어: TypeScript/JS, 들여쓰기는 **탭**, 세미콜론, 큰따옴표.
- 주석/사용자 문구는 한국어.
- **배포 화이트리스트(절대값)**: `main.js`, `manifest.json`, `styles.css`, `versions.json`. 그 외(특히 `data.json`)는 절대 배포 금지.
- 인증 secret 이름: `VAULT_REPO_TOKEN`. 대상 repo: `chanooda/obsidian`. 대상 경로: `.obsidian/plugins/<manifest.id>/`.
- vitest 버전은 기존 플러그인과 동일하게 `^2.1.0`.
- `scripts/deploy.mjs`(로컬 심링크)는 수정하지 않는다.

---

### Task 1: publish 스크립트 + 단위 테스트

빌드 산출물 중 화이트리스트 파일만 vault 체크아웃으로 복사하는 스크립트를 만들고, 파일 선별 로직을 순수 함수로 분리해 테스트한다.

**Files:**
- Modify: `package.json` (루트: `test` 스크립트 + `vitest` devDependency 추가)
- Create: `scripts/publish-to-vault.mjs`
- Test: `scripts/publish-to-vault.test.ts`

**Interfaces:**
- Produces:
  - `PUBLISH_WHITELIST: string[]` = `["main.js", "manifest.json", "styles.css", "versions.json"]`
  - `selectPublishFiles(distEntries: string[]): string[]` — dist 디렉터리의 파일명 배열을 받아 화이트리스트에 있고 실제 존재하는 파일만 화이트리스트 순서로 반환.
- Consumes: 없음.

- [ ] **Step 1: 루트에 vitest devDependency와 test 스크립트 추가**

`package.json`의 `scripts`에 `"test"`를, `devDependencies`에 `vitest`를 추가한다. 결과는 다음과 같다(기존 키는 유지):

```json
{
	"name": "chanoo-obsidian-plugins",
	"private": true,
	"version": "0.0.0",
	"description": "Monorepo of Obsidian plugins, managed with Turborepo + pnpm.",
	"packageManager": "pnpm@10.32.1",
	"scripts": {
		"build": "turbo run build",
		"dev": "turbo run dev",
		"lint": "turbo run lint",
		"clean": "turbo run clean",
		"test": "vitest run scripts",
		"deploy:vault": "node scripts/deploy.mjs",
		"build:deploy": "turbo run build && node scripts/deploy.mjs"
	},
	"devDependencies": {
		"@types/node": "^20.11.0",
		"turbo": "^2.3.0",
		"typescript": "^5.4.0",
		"vitest": "^2.1.0"
	}
}
```

- [ ] **Step 2: 의존성 설치**

Run: `pnpm install`
Expected: 성공 종료. 루트 `node_modules`에 vitest 설치.

- [ ] **Step 3: 실패하는 테스트 작성**

`scripts/publish-to-vault.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PUBLISH_WHITELIST, selectPublishFiles } from "./publish-to-vault.mjs";

describe("selectPublishFiles", () => {
	it("화이트리스트 파일만 통과시킨다", () => {
		const entries = ["main.js", "manifest.json", "styles.css", "versions.json"];
		expect(selectPublishFiles(entries)).toEqual(PUBLISH_WHITELIST);
	});

	it("data.json은 절대 배포하지 않는다", () => {
		const entries = ["main.js", "manifest.json", "data.json"];
		expect(selectPublishFiles(entries)).not.toContain("data.json");
	});

	it("알 수 없는 파일은 제외한다", () => {
		const entries = ["main.js", "secret.env", ".hotreload"];
		expect(selectPublishFiles(entries)).toEqual(["main.js"]);
	});

	it("dist에 없는 선택적 파일은 건너뛴다", () => {
		const entries = ["main.js", "manifest.json"]; // styles.css 없음
		expect(selectPublishFiles(entries)).toEqual(["main.js", "manifest.json"]);
	});
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./publish-to-vault.mjs"` (모듈 없음).

- [ ] **Step 5: 스크립트 구현**

`scripts/publish-to-vault.mjs`:

```js
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — 4개 테스트 통과.

- [ ] **Step 7: 커밋**

```bash
git add package.json pnpm-lock.yaml scripts/publish-to-vault.mjs scripts/publish-to-vault.test.ts
git commit -m "feat(ci): vault 배포용 publish 스크립트 + 단위 테스트

빌드 산출물 화이트리스트(main.js/manifest.json/styles.css/versions.json)만
vault 체크아웃으로 복사. data.json은 제외해 자격증명 유출 방지.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: GitHub Actions 워크플로우

main push 시 빌드하고, vault repo를 PAT로 체크아웃해 publish 스크립트를 돌린 뒤 변경이 있으면 커밋/push 한다.

**Files:**
- Create: `.github/workflows/deploy-vault.yml`

**Interfaces:**
- Consumes: `scripts/publish-to-vault.mjs` (Task 1), repo secret `VAULT_REPO_TOKEN`.
- Produces: 없음(CI 산출물).

- [ ] **Step 1: 워크플로우 파일 작성**

`.github/workflows/deploy-vault.yml`:

```yaml
# main 갱신 시 빌드 산출물을 chanooda/obsidian vault로 배포한다.
#
# 사전 설정(1회):
#   1. fine-grained PAT 발급 — Repository access: chanooda/obsidian만,
#      Permissions: Contents = Read and write.
#   2. 이 repo Settings → Secrets and variables → Actions에
#      VAULT_REPO_TOKEN 이라는 이름으로 PAT 저장.
name: Deploy plugins to vault

on:
  push:
    branches: [main]
    paths:
      - "plugins/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - "scripts/publish-to-vault.mjs"
      - ".github/workflows/deploy-vault.yml"

permissions:
  contents: read

concurrency:
  group: deploy-vault
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout monorepo
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build plugins
        run: pnpm build

      - name: Checkout vault repo
        uses: actions/checkout@v4
        with:
          repository: chanooda/obsidian
          token: ${{ secrets.VAULT_REPO_TOKEN }}
          path: vault

      - name: Publish built plugins into vault
        run: node scripts/publish-to-vault.mjs vault

      - name: Commit & push to vault
        working-directory: vault
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .obsidian/plugins
          if git diff --cached --quiet; then
            echo "배포할 플러그인 변경 없음."
            exit 0
          fi
          git commit -m "chore: sync plugins from monorepo ${{ github.sha }}"
          git push
```

- [ ] **Step 2: YAML 문법 검증**

Run: `npx --yes js-yaml .github/workflows/deploy-vault.yml >/dev/null && echo OK`
Expected: `OK` (YAML 파싱 에러 없음).

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/deploy-vault.yml
git commit -m "feat(ci): main 머지 시 vault로 플러그인 배포 워크플로우

build → chanooda/obsidian 체크아웃 → publish 스크립트 → 변경 시 커밋/push.
VAULT_REPO_TOKEN secret 필요.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 배포 후 사용자 확인 사항 (코드 아님, 머지 후 1회)

1. fine-grained PAT 발급 후 `VAULT_REPO_TOKEN` secret 등록(워크플로우 상단 주석 참고).
2. 이 브랜치를 main에 머지 → Actions 탭에서 "Deploy plugins to vault" 실행 확인.
3. `chanooda/obsidian`의 `.obsidian/plugins/daily-calendar`가 심링크가 아닌 실제 파일들로 바뀌었는지, `data.json`이 없는지 확인.
