# CLAUDE.md

Obsidian 플러그인 모노레포(Turborepo + pnpm). 모든 플러그인에 공통으로 적용되는 규칙.
플러그인별 세부 가이드는 각 `plugins/<name>/CLAUDE.md`를, 사용 개요는 루트 `README.md`를 참고한다.

## 저장소 구조

```
packages/
├── config/    @repo/config — 공유 esbuild(esbuild.base.mjs) + tsconfig
└── shared/    @repo/shared — 플러그인 간 공유 코드
plugins/
├── daily-calendar/   캘린더 + 데일리 노트 (iCloud 동기화)
└── hello-world/      @repo/shared 사용 예제
scripts/
└── deploy.mjs        각 플러그인 dist/를 vault에 심링크
```

- 모노레포는 vault **밖**에 있다. 빌드된 `dist/`를 `<vault>/.obsidian/plugins/<manifest.id>`로 심링크해 Obsidian이 로드한다.
- 각 플러그인은 자기 `dist/`로 빌드된다(`main.js` + `manifest.json` + 선택적 `styles.css`/`versions.json`).
- pnpm 워크스페이스: `packages/*`, `plugins/*`.

## 명령어 (루트에서)

```bash
pnpm install                  # 의존성 설치
pnpm build                    # 전체 빌드 (turbo, 의존성 순서)
pnpm dev                      # 전체 watch 빌드
pnpm deploy:vault             # 모든 플러그인 dist/를 테스트 vault에 심링크
pnpm build:deploy             # 빌드 후 배포
OBSIDIAN_VAULT=/path pnpm deploy:vault   # 다른 테스트 vault로 1회 지정
```

플러그인 하나만 작업할 때는 `pnpm --filter <plugin-name> <script>`를 쓴다.

### 테스트 vault 규칙 (로컬 배포는 테스트 전용)

- **로컬 `deploy.mjs`는 테스트 vault 전용이다.** 실제 플러그인은 main 머지 시 CI(`.github/workflows/deploy-vault.yml` → `publish-to-vault.mjs`)만 배포한다.
- `OBSIDIAN_VAULT`는 **필수**(default 없음). 미설정 시 배포가 중단된다 — 실수로 실제 vault에 심링크되는 걸 막기 위함.
- 실제 배포 vault(`/Users/chan/Desktop/chanoo`)는 **차단**된다. `OBSIDIAN_VAULT`로 명시해도 거부한다(`deploy.mjs`의 `PRODUCTION_VAULT`).
- 테스트 vault 경로는 `.env`(gitignore됨)에 `OBSIDIAN_VAULT=...`로 둔다. `deploy:vault`/`build:deploy`가 `--env-file-if-exists=.env`로 자동 로드한다.

## 모노레포 규칙

- **공유 코드는 `@repo/shared`로.** 두 개 이상의 플러그인이 쓰는 로직은 `packages/shared/src`에 두고 import한다.
- **빌드/타입 설정은 `@repo/config`로 통일.** 플러그인은 `esbuild.config.mjs`에서 `createPluginBuild`를, `tsconfig.json`에서 `@repo/config/tsconfig.json`을 extends 한다. 개별 플러그인에서 빌드 설정을 복제·분기하지 않는다.
- **새 플러그인 추가**: `plugins/hello-world`를 복사 → `package.json`의 `name`과 `manifest.json`의 `id`/`name` 수정 → `pnpm install` → `pnpm build:deploy`.
- 워크스페이스 의존성은 `workspace:*`로 참조한다.

## 빌드 규약 (어기지 말 것)

- **Obsidian 제공 모듈은 번들하지 않는다.** `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, Node builtins는 external(이미 `esbuild.base.mjs`에 설정됨). 새 external이 필요하면 거기서 관리한다.
- 번들 포맷은 `cjs`, 타깃 `es2018`. 프로덕션은 minify + sourcemap 없음, dev는 inline sourcemap.
- 정적 에셋(`manifest.json`, `styles.css`, `versions.json`)은 빌드 그래프에 없으므로 `copyAssets`/`watchAssets`가 `dist/`로 복사한다. **새 정적 에셋 종류를 추가하면 `esbuild.base.mjs`의 `STATIC_ASSETS`에 등록**한다.
- 빌드 산출물(`dist/`)은 커밋하지 않는다(루트 README 기준 vault로 심링크되는 대상).

## 코드 스타일

- **언어**: TypeScript. 들여쓰기는 **탭**. 세미콜론 사용. 큰따옴표 문자열.
- **주석/사용자 문구는 한국어.** 코드 주석은 *왜*를 적는다(무엇은 코드가 말한다). 사용자에게 보이는 `Notice`·설정 라벨도 한국어.
- 기존 파일의 스타일·네이밍·주석 밀도를 따른다. 새 패턴을 임의로 도입하지 않는다.
- **순수 로직과 I/O를 분리**한다(예: daily-calendar의 `reconcile`은 순수 함수, 부수효과는 엔진에). 테스트 가능한 경계를 유지한다.

## 테스트

- 러너는 **vitest**(`pnpm --filter <plugin> test`). 환경은 `node`.
- Obsidian API는 직접 테스트할 수 없으므로 플러그인별 `src/__mocks__/obsidian.ts`로 모킹한다(`vitest.config.ts`의 alias).
- 순수 로직(파서·동기화·경로 계산 등)은 단위 테스트로 커버하고, 분기/엣지 케이스를 추가하면 같은 폴더의 `*.test.ts`에 케이스를 더한다.
- 완료를 주장하기 전에 해당 플러그인의 `test`와 `build`(타입체크 포함)를 실제로 돌려 확인한다.

## 보안

- 자격증명(비밀번호·토큰 등)은 Obsidian `data.json`에 평문 저장될 수 있다. 로그·에러 메시지·커밋에 노출하지 않는다.
- vault 공유 시 민감정보가 노출될 수 있음을 설정 UI에서 사용자에게 경고한다(daily-calendar 선례).

## 커밋

- Conventional Commits + 한국어 본문: `feat(daily-calendar): ...`, `fix(config): ...`.
- 스코프는 플러그인/패키지 이름(`daily-calendar`, `config`, `shared`).
- 사용자가 요청할 때만 커밋·푸시한다. 기본 브랜치면 먼저 브랜치를 만든다.
