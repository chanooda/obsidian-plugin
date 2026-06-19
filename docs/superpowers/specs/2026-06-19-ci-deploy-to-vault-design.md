# CI 배포: main 머지 시 chanooda/obsidian vault로 플러그인 배포

## 배경

- 이 모노레포는 Obsidian vault **밖**에 있고, 빌드된 `dist/`를 vault의
  `.obsidian/plugins/<manifest.id>`로 심링크해 로컬에서 사용한다(`scripts/deploy.mjs`).
- vault인 `chanooda/obsidian`(**private**) 저장소는 `obsidian-git`으로 동기화된다.
  그 안의 `.obsidian/plugins/daily-calendar`, `hello-world`는 현재 로컬 절대경로를
  가리키는 **심링크**로 커밋되어 있다 → 다른 기기/동기화 환경에서는 깨진 링크다.
- 목표: 모노레포 `main`이 갱신되면 플러그인을 빌드해 **실제 빌드 산출물**을
  `chanooda/obsidian`의 `.obsidian/plugins/<id>/`에 push한다. 모든 기기에서 동작하게.

## 결정 사항

- **배포 대상**: `plugins/*` 아래 빌드되는 모든 플러그인(daily-calendar, hello-world).
  새 플러그인 추가 시 자동 포함.
- **인증**: chanooda/obsidian에 `contents:write` 권한만 가진 fine-grained PAT.
  이 repo의 Actions secret `VAULT_REPO_TOKEN`으로 저장.
- **트리거**: `main`에 push될 때, 경로 필터(`plugins/**`, `packages/**`,
  `pnpm-lock.yaml`, 워크플로우/배포 스크립트 자신)에 해당하는 변경이 있을 때만.
- **테스트**: 파일 선별 로직을 순수 함수로 분리하고 vitest로 단위 테스트.

## 아키텍처

두 개의 산출물:

### 1. 배포 스크립트 — `scripts/publish-to-vault.mjs`

`deploy.mjs`(심링크)와 구조를 맞추되, **실제 파일 복사** 방식.

순수 로직과 I/O 분리(CLAUDE.md 원칙):

- **순수 함수** `selectPublishFiles(distEntries)` — dist 안의 파일 목록을 받아,
  배포할 **화이트리스트** 파일만 골라 반환한다.
  - 화이트리스트: `main.js`, `manifest.json`, `styles.css`, `versions.json`
  - `data.json`을 포함한 그 외 모든 파일은 제외(iCloud 자격증명 유출 방지).
  - dist에 없는 선택적 파일은 조용히 건너뜀.
- **I/O 부분(스크립트 본문)**:
  1. 인자로 vault 체크아웃 경로를 받음(`process.argv[2]`), 없으면 에러 종료.
  2. `plugins/*`를 순회하며 `manifest.json`과 `dist/`가 있는 디렉터리만 처리.
  3. `manifest.json`에서 `id`를 읽음.
  4. 대상 `.obsidian/plugins/<id>` 항목을 제거(심링크/디렉터리 모두) → 깨진 심링크 정리.
  5. 실제 디렉터리로 새로 만들고 `selectPublishFiles`가 고른 파일만 복사.
  6. `obsidian-git`, `.DS_Store` 등 vault의 다른 항목은 절대 건드리지 않음.
  7. 처리한 플러그인 수를 로그로 출력.

테스트: `scripts/publish-to-vault.test.ts` — `selectPublishFiles`가
화이트리스트만 통과시키고 `data.json` 등을 제외하는지 검증.

> 참고: 루트에는 현재 테스트 러너가 없다. vitest를 루트 devDependency로 추가하고
> 루트 `test` 스크립트(`vitest run scripts`)를 둔다. (구현 계획에서 확정)

### 2. GitHub Actions 워크플로우 — `.github/workflows/deploy-vault.yml`

```
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
  contents: read   # 이 repo에는 쓰기 불필요(대상 repo는 PAT로 push)

concurrency:
  group: deploy-vault
  cancel-in-progress: true
```

Job 단계:
1. `actions/checkout` — 모노레포.
2. `pnpm/action-setup` + `actions/setup-node`(pnpm 캐시).
3. `pnpm install --frozen-lockfile`.
4. `pnpm build` (turbo가 모든 `plugins/*/dist` 생성).
5. `actions/checkout`로 `chanooda/obsidian`을 별도 경로(예: `vault/`)에 체크아웃.
   `repository: chanooda/obsidian`, `token: ${{ secrets.VAULT_REPO_TOKEN }}`,
   `path: vault`.
6. `node scripts/publish-to-vault.mjs vault`.
7. vault 디렉터리에서 변경이 있을 때만 commit & push:
   - git user는 봇 아이덴티티로 설정.
   - `git add .obsidian/plugins` 후 `git diff --cached --quiet`로 변경 여부 확인.
   - 커밋 메시지에 소스 커밋 SHA(`${{ github.sha }}`) 참조.

## 보안

- **화이트리스트** 방식이라 dist에 새 런타임 파일이 생겨도 배포되지 않는다.
- `data.json`(iCloud 비밀번호 평문 가능)은 명시적으로 배포 제외 + 단위 테스트로 고정.
- PAT는 `chanooda/obsidian` contents에만 한정.
- 대상 repo는 private.

## 수동 1회 설정 (사용자)

1. GitHub Settings → Developer settings → Fine-grained personal access tokens 발급.
   - Repository access: Only `chanooda/obsidian`.
   - Permissions: Repository permissions → Contents → **Read and write**.
2. 이 repo Settings → Secrets and variables → Actions → New repository secret.
   - Name: `VAULT_REPO_TOKEN`, Value: 발급한 PAT.

## 비목표 (YAGNI)

- `scripts/deploy.mjs`(로컬 심링크)는 그대로 둔다. 로컬 개발용.
- 버전 태깅/릴리스, Obsidian 커뮤니티 플러그인 제출은 범위 밖.
- PR 단계 빌드 검증(CI 테스트 게이트)은 이번 범위 밖(별도 워크플로우로 후속 가능).
