# CLAUDE.md — daily-calendar

이 플러그인에서 작업할 때의 가이드. 루트 `CLAUDE.md`의 공통 규칙도 함께 따른다.
제품 명세는 `README.md`(기획서) 참고.

## 한 줄 요약

데일리 노트 마크다운이 **데이터 원본**이고, 캘린더 뷰와 iCloud(CalDAV)는 그것을 읽고/쓰는 두 표현이다.
양방향 동기화는 로컬·원격·스냅샷의 **3-way reconcile(LWW)** 로 결정한다.

## 디렉터리 지도

```
src/
├── main.ts              Plugin 진입점. 뷰/명령/설정 등록, 동기화 타이머, 폴더 마이그레이션
├── calendar-view.ts     월간 그리드 뷰 (표시 전용 파서 parseEvents 포함)
├── settings.ts          설정 탭 + MyPluginSettings / DEFAULT_SETTINGS
├── daily-note-path.ts   경로 계산(YYYY/YYYY-MM/) + 평평한 노트 탐지
├── vault-utils.ts       ensureParentFolders
├── types.ts             CalEvent / NoteEvent / CalendarRef / SyncRecord
├── ui/event-modal.ts    새 일정 입력 모달
├── ical/
│   ├── caldav-client.ts CalDAV HTTP (discover/fetch/put/delete)
│   ├── caldav-xml.ts    PROPFIND/REPORT XML 생성·파싱
│   └── ics.ts           VEVENT ↔ CalEvent (ical.js)
├── sync/
│   ├── sync-engine.ts   동기화 오케스트레이션 + CalEvent↔NoteEvent 변환
│   ├── reconcile.ts     3-way LWW 동기화 결정 (순수 함수)
│   ├── event-store.ts   uid·localId 인덱스
│   └── note-repository.ts "## 일정" 섹션 파싱/upsert/remove
└── __mocks__/obsidian.ts  테스트용 obsidian 모킹
```

## 명령어

루트에서 turbo로 돌리는 게 기본이지만, 이 플러그인만 빠르게 보려면:

```bash
pnpm --filter daily-calendar test        # vitest 1회 실행
pnpm --filter daily-calendar test --watch
pnpm --filter daily-calendar build       # tsc 타입체크 + esbuild 프로덕션 번들
pnpm --filter daily-calendar dev         # watch 빌드
```

테스트는 `vitest`, 환경은 `node`. `obsidian` import는 `src/__mocks__/obsidian.ts`로 alias된다(`vitest.config.ts`).

## 반드시 알아야 할 불변식 (어기면 데이터 손상)

1. **파서가 둘이다.** 일정 줄 문법을 바꾸면 **양쪽 모두** 고쳐야 한다:
   - `note-repository.parseNoteEvents` — 동기화용, `## 일정` 섹션만, 메타데이터 완전 파싱.
   - `calendar-view.parseEvents` — 표시용, 노트 전체 리스트, 할 일 인식, 메타 떼고 표시.
   `renderEventLines`(쓰기)와 두 파서(읽기)의 round-trip이 깨지면 동기화가 일정을 중복/유실한다.

2. **`uid`가 동일성의 기준이다.** `localId`(블록 ID)는 노트 안 위치 찾기용. 둘의 매핑은 `SyncRecord`.
   새 로컬 일정은 `genUid()`로 uid를, `genLocalId()`로 `ic-` 블록 ID를 발급한다.

3. **동기화 창(과거 3개월~미래 12개월) 밖은 reconcile에서 제외한다.**
   로컬 노트도 같은 창으로 필터해야 한다. 안 그러면 창 밖 일정이 "원격에 없음 → 삭제"로 오인되어 사라진다.
   창을 넓히거나 좁힐 때 `syncWindow`와 `collectLocal`의 필터를 함께 본다.

4. **store 분실 재채택.** `data.json`이 없거나 새 기기일 때, 블록 ID 있는 노트 일정을
   내용 키(`contentKey = calendarId|allDay|startISO|title`)로 원격과 매칭해 매핑을 되살린다.
   내용 키 구성요소를 바꾸면 재채택 정확도가 달라지니 신중히.

5. **메타데이터 꼬리표 순서.** `renderEventLines`가 만드는 순서: `시각 제목 [캘린더] ^localId (종일)`.
   표시 파서는 뒤에서부터 `(종일)` → `^ic-` → `[캘린더]` 순으로 떼어낸다. 순서를 바꾸면 정규식이 깨진다.

6. **reconcile은 순수 함수다.** I/O 없이 `SyncAction[]`만 반환한다. 부수효과는 `sync-engine`의 `doPush`/`doPull`/`doDelete*`에 둔다. 테스트하기 쉬운 이 경계를 유지한다.

## 자주 하는 작업

- **일정 줄 문법 변경** → `note-repository`(파싱+렌더), `calendar-view.parseEvents`, 관련 테스트 모두 수정.
- **동기화 규칙 변경** → `reconcile.ts`(순수 로직)와 `reconcile.test.ts`. 액션 실행은 `sync-engine`.
- **CalDAV 요청 변경** → `caldav-client.ts` + `caldav-xml.ts`. iCloud는 `calendar-query`로 본문을 인라인 수신(이유는 `fetchEvents` 주석 참고).
- **새 설정 추가** → `settings.ts`의 `MyPluginSettings` + `DEFAULT_SETTINGS` + 설정 탭 UI.
- **VEVENT 필드 추가** → `ics.ts`의 `parseVEvent`/`buildICS` 양쪽 + `CalEvent` 타입.

## 테스트 관례

- 순수 로직(`reconcile`, `note-repository`, `daily-note-path`, `ical/*`)은 단위 테스트로 커버한다.
- 새 분기·엣지 케이스를 추가하면 같은 파일의 `*.test.ts`에 케이스를 추가한다.
- Obsidian API에 의존하는 코드는 `__mocks__/obsidian.ts`에 필요한 최소 stub만 추가해 테스트한다.

## 주의 / 함정

- 비밀번호는 `data.json`에 평문 저장된다. 로깅·에러 메시지에 노출하지 않는다.
- 날짜는 **로컬 타임존** 기준으로 다룬다(`new Date(year, month, date)`). 종일 일정은 `ICAL.Time.fromDateString`(date-only)로 직렬화.
- `vault.create`는 상위 폴더를 자동 생성하지 않는다 → 파일 생성/이동 전 `ensureParentFolders` 호출.
- 폴더 마이그레이션(`migrateFolderStructure`)은 멱등이어야 한다. 경로 규칙을 바꾸면 마이그레이션도 함께 검토.
