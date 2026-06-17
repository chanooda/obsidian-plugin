# Daily Calendar

Obsidian용 캘린더 + 데일리 노트 플러그인. 월간 캘린더 뷰로 일정·할 일을 한눈에 보고,
데일리 노트와 iCloud(CalDAV) 캘린더를 **양방향**으로 동기화한다.

> 데일리 노트의 마크다운이 곧 데이터의 원본(single source of truth)이다.
> 캘린더 뷰와 iCloud는 그 마크다운을 읽고/쓰는 두 개의 표현일 뿐이다.

---

## 1. 배경 & 목표

### 문제

- Obsidian에서 일정을 관리하려면 마크다운으로 적는 게 자연스럽지만, 월 단위로 한눈에 보기 어렵다.
- iPhone/Mac 기본 캘린더(iCloud)에 있는 일정과 Obsidian 노트가 따로 놀아, 두 곳을 오가며 중복 입력하게 된다.

### 목표

1. 데일리 노트의 일정/할 일을 **월간 캘린더 그리드**로 시각화한다.
2. 데일리 노트 ↔ iCloud 캘린더를 **양방향 동기화**한다 (한쪽에서 만들면 다른 쪽에 반영).
3. 동기화 메타데이터는 노트 가독성을 해치지 않게 **눈에 잘 안 띄는 형태**로 숨긴다.
4. 외부 플러그인/서버 없이 Obsidian의 `requestUrl`만으로 CalDAV에 직접 붙는다.

### 비목표 (현재 범위 밖)

- 반복 일정(RRULE), 알림(VALARM), 참석자(ATTENDEE), 타임존(VTIMEZONE) 정교한 처리
- Google/Outlook 등 iCloud 외 캘린더 제공자
- 주간/일간 뷰 (현재는 월간 그리드만)
- 일정 수정/삭제 전용 UI (수정·삭제는 노트를 직접 편집해서 수행)

---

## 2. 핵심 개념

### 데일리 노트 문법

데일리 노트는 `{folder}/YYYY/YYYY-MM/YYYY-MM-DD.md` 경로에 저장된다.
일정은 마크다운 리스트 항목으로 적는다.

| 형태 | 의미 |
| --- | --- |
| `- 제목` | 종일 일정 |
| `- HH:MM 제목` | 시간 일정 |
| `- HH:MM-HH:MM 제목` | 시간 범위 일정 (`~`도 허용) |
| `- [ ] 제목` / `- [x] 제목` | 할 일 (캘린더 뷰에서 체크 토글 가능) |

들여쓴 하위 불릿(`\t- ...`)은 그 일정의 **설명**으로 묶인다.

```markdown
## 일정

- 09:00-10:00 스탠드업 [업무] ^ic-a1b2c3d4e5f6
	- Zoom 링크 첨부
- 점심 약속 [개인] ^ic-1122334455aa
- [ ] 14:00 회의자료 정리
```

### 동기화 메타데이터 (사람 눈에 덜 띄게 숨김)

iCloud와 동기화되는 일정 줄에는 메타데이터가 꼬리표로 붙는다. 캘린더 뷰는 표시할 때 이걸 모두 떼고 보여준다.

- `[캘린더이름]` — 이 일정이 속한 iCloud 캘린더
- `^ic-xxxxxxxx` — Obsidian 블록 ID 겸 로컬 식별자(`localId`). 일정의 안정적인 동일성 기준
- `(종일)` — 종일 일정 표기

`## 일정` 섹션이 동기화 엔진이 읽고 쓰는 영역이다. 단, **캘린더 뷰**(시각화)는 노트 전체의 리스트 항목을 읽는다.
(동기화 파서와 뷰 파서가 분리되어 있다 — [4. 아키텍처](#4-아키텍처) 참고)

### 식별자 체계

| 식별자 | 소유 | 용도 |
| --- | --- | --- |
| `uid` | iCloud VEVENT UID | 동기화의 동일성 기준. 신규 로컬 일정도 생성 시 발급 |
| `localId` (`ic-xxx`) | 노트 블록 ID | 노트 안에서 일정 줄을 찾는 기준 |
| `href` | CalDAV `.ics` 리소스 경로 | PUT/DELETE 대상 |
| `etag` | iCloud | 원격 변경 감지 |

이 매핑은 `SyncRecord`로 묶여 `data.json`에 영속화된다.

---

## 3. 기능 명세

### 3.1 월간 캘린더 뷰

- 리본 아이콘(`calendar-days`) 또는 명령으로 탭을 연다.
- 이전/다음 달 이동, "오늘"로 점프.
- 각 날짜 셀:
  - 데일리 노트가 있으면 그 날의 일정/할 일을 시간순으로 표시(시간 없는 항목은 작성 순서 유지).
  - 셀 클릭 → 데일리 노트 생성/열기 (날짜당 탭 1개 유지).
  - 우상단 `+` → 새 일정 모달.
  - 할 일 체크박스 클릭 → 노트의 `[ ]`/`[x]` 토글.
- 주말 강조(일=빨강, 토=파랑), 오늘/인접 달 셀 스타일.
- vault 변경 이벤트를 구독해 자동 재렌더(300ms 디바운스).

### 3.2 새 일정 모달

제목/설명/종일 토글/시작·종료 시각(HH:MM)/대상 캘린더를 입력 → 즉시 iCloud에 push하고 노트에 기록.

### 3.3 iCloud 양방향 동기화

- **설정**: Apple ID + 앱 전용 비밀번호(appleid.apple.com 발급), 캘린더 폴더, 자동 동기화 간격(분), 기본 캘린더.
- **캘린더 불러오기**: CalDAV로 캘린더 목록을 발견(principal → calendar-home → 목록).
- **수동 동기화**: 명령("iCloud 동기화 실행") 또는 설정의 "동기화 실행" 버튼.
- **자동 동기화**: `syncIntervalMinutes > 0`이면 주기 실행.
- **동기화 창**: 과거 3개월 ~ 미래 12개월. 창 밖의 노트/원격 일정은 reconcile에서 제외해 "삭제됨" 오인을 막는다.

#### 동기화 규칙 (3-way reconcile, LWW)

로컬(노트) · 원격(iCloud) · 스냅샷(마지막 동기화 상태)을 비교해 액션을 결정한다.

| 상황 | 액션 |
| --- | --- |
| 로컬에만 있고 스냅샷 없음 | `push` (iCloud로 생성) |
| 원격에만 있고 스냅샷 없음 | `pull` (노트로 기록) |
| 스냅샷 있고 로컬만 사라짐 | `delete-remote` |
| 스냅샷 있고 원격만 사라짐 | `delete-local` |
| 한쪽만 변경 | 변경된 쪽 → 반대쪽 반영 |
| 양쪽 변경(충돌) | **LWW**: 원격 `LAST-MODIFIED` vs 노트 mtime, 최신 우선(동률 시 원격) |

#### 견고성 설계

- **캘린더별 격리**: 한 캘린더 조회 실패가 전체 동기화를 막지 않는다.
- **store 분실 복구**: `data.json`이 사라지거나 새 기기로 옮겨도, 블록 ID가 있는 노트 일정을 **내용 키**(`calendarId|allDay|startISO|title`)로 원격과 매칭해 매핑을 재채택 → 중복 생성 방지.
- **calendar-query 사용**: iCloud `sync-collection`은 `calendar-data`를 인라인으로 안 줄 때가 있어, `calendar-query` REPORT로 항상 본문을 받는다.

### 3.4 폴더 구조 마이그레이션

레이아웃 준비 시, 폴더 바로 아래 평평하게 놓인 `YYYY-MM-DD.md`를 `YYYY/YYYY-MM/`로 이동(멱등). 이동 결과를 `SyncRecord.notePath`에도 반영한다.

---

## 4. 아키텍처

```
main.ts (Plugin)
├── CalendarView          월간 그리드 렌더 + 상호작용 (독립 파서로 노트 표시)
├── EventModal            새 일정 입력 UI
├── CalendarSettingTab    설정 화면
└── SyncEngine            동기화 오케스트레이션
    ├── CalDavClient       CalDAV HTTP (discover/fetch/put/delete)
    │   └── caldav-xml     PROPFIND/REPORT XML 생성·파싱
    ├── ics.ts             VEVENT ↔ CalEvent (ical.js)
    ├── note-repository    "## 일정" 섹션 파싱/upsert/remove
    ├── event-store        uid·localId 인덱스 (SyncRecord)
    ├── reconcile          3-way LWW 동기화 결정
    └── daily-note-path    경로 계산 + 평평한 노트 탐지
```

### 데이터 흐름 (동기화 1회)

1. **원격 수집** — 캘린더별 `fetchEvents` → `parseVEvent` → `CalEvent[]` (+ href/etag 메타)
2. **로컬 수집** — 시간 창 내 데일리 노트의 `## 일정` 파싱 → `CalEvent[]`. 미매핑 줄은 신규/재채택 판정
3. **reconcile** — 로컬·원격·스냅샷 3-way 비교 → `SyncAction[]`
4. **실행** — push/pull/delete-remote/delete-local 적용, 노트와 store·iCloud 갱신
5. **영속화** — `EventStore.toJSON()`을 `settings.syncRecords`로 저장

### 모듈 경계 — 두 개의 파서

- **`note-repository.parseNoteEvents`**: 동기화 전용. `## 일정` 섹션만, 메타데이터(localId/캘린더/종일) 완전 파싱.
- **`calendar-view.parseEvents`**: 표시 전용. 노트 전체의 리스트 항목, 할 일 인식, 메타데이터는 떼고 표시.

두 파서는 의도적으로 분리되어 있다. 일정 줄 문법(시각 표기, 메타 꼬리표)을 바꿀 때는 **둘 다** 일관되게 손봐야 한다.

---

## 5. 데이터 모델

`src/types.ts` 참조. 핵심 타입:

- `CalEvent` — 정규화된 일정. `uid`가 동일성 기준.
- `NoteEvent` — 노트 한 줄(+설명)에서 파싱한 표현. 줄 범위(`startLine`/`endLine`) 포함.
- `CalendarRef` — 연결된 iCloud 캘린더 한 개(`id`=CalDAV 경로, `name`, `color`, `syncToken`).
- `SyncRecord` — 일정별 동기화 메타(`uid`/`localId`/`calendarId`/`etag`/`href`/`notePath`/`snapshot`).
- `CalEventSnapshot` — 직렬화용 스냅샷(Date → ISO 문자열).

---

## 6. 설정 (`MyPluginSettings`)

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `calendarFolder` | `""` | 데일리 노트 루트 폴더(비우면 vault 루트) |
| `icloudUsername` | `""` | Apple ID |
| `icloudAppPassword` | `""` | 앱 전용 비밀번호 |
| `syncIntervalMinutes` | `15` | 자동 동기화 간격(0이면 끔) |
| `defaultCalendarId` | `""` | 새 일정 push 기본 캘린더 |
| `calendars` | `[]` | 발견된 캘린더 캐시 |
| `syncRecords` | `[]` | 동기화 메타(event-store 직렬화) |

> ⚠️ **보안**: Apple ID와 앱 전용 비밀번호는 `data.json`에 **평문** 저장된다. vault를 외부에 공유한다면 주의.

---

## 7. 사용법

1. 빌드 후 vault에 설치 (루트 README의 `pnpm build:deploy` 참고).
2. 설정에서 캘린더 폴더, Apple ID, 앱 전용 비밀번호 입력.
3. "캘린더 불러오기"로 iCloud 캘린더 목록 가져오기 → 기본 캘린더 선택.
4. 리본의 캘린더 아이콘으로 월간 뷰 열기.
5. 셀 `+`로 일정 추가하거나, 데일리 노트에 직접 일정 줄 작성.
6. "iCloud 동기화 실행" 또는 자동 동기화로 양방향 반영.

---

## 8. 알려진 한계 & 향후 과제

- 반복 일정/알림/타임존 미지원 (단일 VEVENT만).
- 충돌 해소가 노트 단위 mtime 기반 LWW라, 같은 노트 내 다른 일정의 동시 변경은 거칠게 처리될 수 있다.
- 일정 수정/삭제 전용 UI 없음(노트 직접 편집).
- 비밀번호 평문 저장.
- 주간/일간 뷰 부재.
