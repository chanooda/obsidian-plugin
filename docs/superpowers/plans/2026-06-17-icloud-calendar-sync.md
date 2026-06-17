# daily-calendar ↔ iCloud 양방향 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obsidian `daily-calendar` 플러그인의 데일리 노트와 iCloud 캘린더를 양방향(LWW) 동기화한다.

**Architecture:** 마크다운 데일리 노트가 Obsidian 측 표현이고 iCloud와 완전 양방향이다. 순수 함수 계층(note-repository / ics / sync-engine reconcile / event-store)을 단위 테스트로 검증하고, I/O 계층(caldav-client / 모달 / 설정 / main 와이어링)이 이를 조립한다. CalDAV는 Obsidian `requestUrl`로 직접 호출하고, iCalendar(VEVENT) 직렬화/파싱은 `ical.js`로 처리한다.

**Tech Stack:** TypeScript, Obsidian API(`requestUrl`, `Modal`, `Setting`), `ical.js`, esbuild(번들), vitest(단위 테스트).

---

## 사전 지식 (실행자 필독)

- 작업 디렉터리 루트: `/Users/chan/Desktop/chanoo-obsidian-plugins`. 모든 경로는 이 루트 기준이다.
- 플러그인 경로: `plugins/daily-calendar`. 소스는 `plugins/daily-calendar/src`.
- 빌드: 루트에서 `pnpm --filter daily-calendar build` (tsc 타입체크 + esbuild). 의존성 설치는 루트에서 `pnpm install`.
- 이 모노레포는 테스트 러너가 없다. **Task 0에서 vitest를 daily-calendar에 도입**한다.
- esbuild는 `obsidian`/electron/codemirror만 external로 둔다. `ical.js`는 번들에 포함된다(별도 설정 불필요).
- CalDAV는 브라우저 `fetch`의 CORS에 막히므로 **반드시 Obsidian `requestUrl`**을 쓴다. 단위 테스트에서는 `requestUrl`을 주입(의존성 주입)해 모킹한다.
- 커밋은 작은 단위로 자주 한다. 커밋 메시지 끝에 다음 줄을 포함한다:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 모든 작업은 `feature/icloud-calendar-sync` 브랜치에서 진행한다(이미 체크아웃됨).

## 파일 구조 (생성/수정 대상)

```
plugins/daily-calendar/
  package.json                 // 수정: ical.js 의존성, vitest 스크립트
  vitest.config.ts             // 생성
  src/
    types.ts                   // 생성: CalendarRef, CalEvent, NoteEvent 등 공용 타입
    ical/
      ics.ts                   // 생성: ical.js 래퍼 (VEVENT <-> CalEvent)
      ics.test.ts              // 생성
      caldav-client.ts         // 생성: requestUrl 기반 CalDAV
      caldav-xml.ts            // 생성: CalDAV 요청 XML 빌더 + 응답 파서(순수)
      caldav-xml.test.ts       // 생성
    sync/
      note-repository.ts       // 생성: 마크다운 <-> NoteEvent[] (파싱/직렬화)
      note-repository.test.ts  // 생성
      event-store.ts           // 생성: uid<->localId, etag, snapshot, sync-token (data.json)
      event-store.test.ts      // 생성
      reconcile.ts             // 생성: 3-way LWW 머지 결정(순수 함수)
      reconcile.test.ts        // 생성
      sync-engine.ts           // 생성: reconcile + I/O 오케스트레이션
    ui/
      event-modal.ts           // 생성: 일정 추가/수정 모달
    settings.ts                // 수정: 자격증명/캘린더/간격 설정 UI
    calendar-view.ts           // 수정: 일정 클릭 시 모달, 캘린더 색 표시
    main.ts                    // 수정: 주기 타이머, 명령, sync-engine 와이어링
```

---

## Task 0: 테스트/빌드 도구 셋업

**Files:**
- Modify: `plugins/daily-calendar/package.json`
- Create: `plugins/daily-calendar/vitest.config.ts`
- Create: `plugins/daily-calendar/src/sanity.test.ts` (임시 검증용, Task 0 끝에 삭제)

- [ ] **Step 1: 의존성과 스크립트 추가**

`plugins/daily-calendar/package.json`의 `scripts`에 `test`를, `devDependencies`에 vitest를, `dependencies`에 ical.js를 추가한다. 최종 형태:

```json
{
	"name": "daily-calendar",
	"version": "1.0.0",
	"private": true,
	"description": "Calendar and daily-note plugin for Obsidian.",
	"author": "smiledragon-fe",
	"license": "MIT",
	"scripts": {
		"build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
		"dev": "node esbuild.config.mjs",
		"test": "vitest run",
		"clean": "rm -rf dist"
	},
	"dependencies": {
		"ical.js": "^2.1.0"
	},
	"devDependencies": {
		"@repo/config": "workspace:*",
		"@repo/shared": "workspace:*",
		"obsidian": "latest",
		"tslib": "^2.6.2",
		"typescript": "^5.4.0",
		"vitest": "^2.1.0"
	}
}
```

- [ ] **Step 2: vitest 설정 생성**

`plugins/daily-calendar/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
```

- [ ] **Step 3: 의존성 설치**

Run (루트에서): `pnpm install`
Expected: 설치 성공, `ical.js`와 `vitest`가 `plugins/daily-calendar`에 추가됨.

- [ ] **Step 4: sanity 테스트 작성**

`plugins/daily-calendar/src/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
	it("runs vitest", () => {
		expect(1 + 1).toBe(2);
	});
});
```

- [ ] **Step 5: 테스트 실행 확인**

Run: `pnpm --filter daily-calendar test`
Expected: 1 passed.

- [ ] **Step 6: sanity 테스트 삭제 후 커밋**

```bash
rm plugins/daily-calendar/src/sanity.test.ts
git add plugins/daily-calendar/package.json plugins/daily-calendar/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(daily-calendar): vitest + ical.js 도입"
```

---

## Task 1: 공용 타입 정의

**Files:**
- Create: `plugins/daily-calendar/src/types.ts`

타입 정의는 이후 모든 태스크의 계약이다. 테스트는 없지만 정확히 따라야 한다.

- [ ] **Step 1: types.ts 작성**

```ts
/** 연결된 iCloud 캘린더 한 개. */
export interface CalendarRef {
	/** CalDAV 컬렉션 URL의 경로 부분(고유 식별자). 예: "/123/calendars/work/" */
	id: string;
	/** 사람이 보는 이름. 예: "개인", "업무" */
	name: string;
	/** CalDAV calendar-color (#RRGGBB). 없으면 undefined. */
	color?: string;
	/** 이 컬렉션의 현재 sync-token(증분 pull용). 없으면 undefined. */
	syncToken?: string;
}

/** 동기화의 단위가 되는 정규화된 일정. uid가 동일성의 기준이다. */
export interface CalEvent {
	/** iCloud VEVENT UID. 신규 로컬 생성 시에도 생성해 부여한다. */
	uid: string;
	title: string;
	/** 설명. 없으면 "". */
	description: string;
	/** 시작 시각. 종일이면 해당 날짜 00:00(로컬). */
	start: Date;
	/** 종료 시각. 명시 종료가 없으면 null. */
	end: Date | null;
	allDay: boolean;
	/** 이 일정이 속한 CalendarRef.id. */
	calendarId: string;
	/** iCloud LAST-MODIFIED. LWW 비교에 쓴다. 모르면 null. */
	lastModified: Date | null;
}

/** 데일리 노트 한 줄(+하위 설명 불릿)에서 파싱한 일정 표현. */
export interface NoteEvent {
	/** 블록 ID에서 캐럿을 뺀 값. 예: "ic-a1b2c3". 신규(블록ID 없음)면 null. */
	localId: string | null;
	title: string;
	description: string;
	/** 시작 분(자정 기준). 종일이면 null. */
	startMinutes: number | null;
	/** 종료 분(자정 기준). 없으면 null. */
	endMinutes: number | null;
	allDay: boolean;
	/** [대괄호] 안 캘린더 이름. 없으면 "". */
	calendarName: string;
	/** 노트 본문에서 이 일정이 차지하는 줄 범위 [시작, 끝) (0-based). */
	startLine: number;
	endLine: number;
}

/** event-store에 보관하는 일정별 동기화 메타. */
export interface SyncRecord {
	uid: string;
	localId: string;
	calendarId: string;
	/** iCloud ETag(변경 감지). */
	etag: string;
	/** 이 일정이 기록된 데일리 노트 경로. */
	notePath: string;
	/** 마지막 동기화 시점의 일정 스냅샷(3-way 비교 기준). */
	snapshot: CalEventSnapshot;
}

/** 직렬화 가능한 스냅샷(Date는 ISO 문자열로 저장). */
export interface CalEventSnapshot {
	title: string;
	description: string;
	startISO: string;
	endISO: string | null;
	allDay: boolean;
	calendarId: string;
}
```

- [ ] **Step 2: 타입체크 확인**

Run: `pnpm --filter daily-calendar exec tsc -noEmit -skipLibCheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add plugins/daily-calendar/src/types.ts
git commit -m "feat(daily-calendar): 동기화 공용 타입 정의"
```

---

## Task 2: note-repository — 마크다운 파싱

데일리 노트의 `## 일정` 섹션을 `NoteEvent[]`로 파싱한다. 순수 함수, TDD.

형식 규칙:
- 일정 줄: `- [HH:MM[-HH:MM] ]제목 [캘린더] ^ic-xxx[ (종일)]`
- 시간 없음 + `(종일)` 표기 → 종일. 시간 없음 + `(종일)` 없음도 종일로 간주.
- 캘린더 `[이름]`과 블록ID `^ic-xxx`, `(종일)`은 모두 선택적.
- 바로 다음의 들여쓰기(탭 또는 2칸 이상) 하위 불릿들이 설명. 여러 줄이면 `\n`으로 합친다.

**Files:**
- Create: `plugins/daily-calendar/src/sync/note-repository.ts`
- Test: `plugins/daily-calendar/src/sync/note-repository.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`plugins/daily-calendar/src/sync/note-repository.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseNoteEvents } from "./note-repository";

const NOTE = [
	"# 2026-06-17",
	"",
	"## 일정",
	"",
	"- 09:00-10:00 치과 예약 [개인] ^ic-a1b2c3",
	"\t- 정기 검진",
	"\t- 보험증 지참",
	"- 14:00 팀 회의 [업무] ^ic-d4e5f6",
	"- 가족 저녁 [가족] ^ic-g7h8i9 (종일)",
	"- 새로 추가한 일정 [개인]",
	"",
].join("\n");

describe("parseNoteEvents", () => {
	it("시간 범위/설명/블록ID/캘린더를 파싱한다", () => {
		const events = parseNoteEvents(NOTE);
		expect(events[0]).toMatchObject({
			localId: "ic-a1b2c3",
			title: "치과 예약",
			calendarName: "개인",
			startMinutes: 540,
			endMinutes: 600,
			allDay: false,
			description: "정기 검진\n보험증 지참",
		});
	});

	it("시작 시간만 있으면 endMinutes는 null", () => {
		const events = parseNoteEvents(NOTE);
		expect(events[1]).toMatchObject({
			localId: "ic-d4e5f6",
			title: "팀 회의",
			startMinutes: 840,
			endMinutes: null,
			allDay: false,
		});
	});

	it("(종일) 표기는 allDay=true, 시간은 null", () => {
		const events = parseNoteEvents(NOTE);
		expect(events[2]).toMatchObject({
			localId: "ic-g7h8i9",
			title: "가족 저녁",
			allDay: true,
			startMinutes: null,
		});
	});

	it("블록ID 없는 줄은 localId=null(신규)", () => {
		const events = parseNoteEvents(NOTE);
		expect(events[3]).toMatchObject({
			localId: null,
			title: "새로 추가한 일정",
			calendarName: "개인",
		});
	});

	it("## 일정 섹션 밖의 리스트는 무시한다", () => {
		const note = ["## 메모", "- 그냥 메모 항목", ""].join("\n");
		expect(parseNoteEvents(note)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/note-repository.test.ts`
Expected: FAIL — `parseNoteEvents` 미정의.

- [ ] **Step 3: 구현**

`plugins/daily-calendar/src/sync/note-repository.ts`:

```ts
import type { NoteEvent } from "../types";

/** 일정 섹션 헤더(레벨 무관). */
const SECTION_RE = /^#{1,6}\s+일정\s*$/;
/** 다른 섹션 헤더(일정 섹션 종료 판정). */
const ANY_HEADING_RE = /^#{1,6}\s+/;
/** 최상위 일정 불릿. */
const TOP_BULLET_RE = /^- (.*)$/;
/** 들여쓰기된 하위 불릿(설명). */
const SUB_BULLET_RE = /^(?:\t| {2,})- (.*)$/;
/** 블록ID: 줄 끝의 ^ic-xxx */
const BLOCK_ID_RE = /\s\^(ic-[A-Za-z0-9]+)\s*$/;
/** 캘린더 표기: [이름] */
const CAL_RE = /\s\[([^\]]+)\]/;
/** 종일 표기 */
const ALLDAY_RE = /\s\(종일\)\s*$/;
/** 맨 앞 시각: HH:MM 또는 HH:MM-HH:MM / HH:MM~HH:MM */
const TIME_RE = /^(\d{1,2}):(\d{2})(?:\s*[-~]\s*(\d{1,2}):(\d{2}))?\s+/;

function toMinutes(h: number, m: number): number | null {
	if (h > 23 || m > 59) return null;
	return h * 60 + m;
}

/** 데일리 노트 본문에서 "## 일정" 섹션의 일정들을 파싱한다. */
export function parseNoteEvents(content: string): NoteEvent[] {
	const lines = content.split("\n");
	const events: NoteEvent[] = [];

	// 일정 섹션의 줄 범위를 찾는다.
	let sectionStart = -1;
	let sectionEnd = lines.length;
	for (let i = 0; i < lines.length; i++) {
		if (SECTION_RE.test(lines[i])) {
			sectionStart = i + 1;
			for (let j = sectionStart; j < lines.length; j++) {
				if (ANY_HEADING_RE.test(lines[j])) {
					sectionEnd = j;
					break;
				}
			}
			break;
		}
	}
	if (sectionStart === -1) return events;

	let i = sectionStart;
	while (i < sectionEnd) {
		const bullet = lines[i].match(TOP_BULLET_RE);
		if (!bullet) {
			i++;
			continue;
		}
		const startLine = i;
		let rest = bullet[1];

		const allDay = ALLDAY_RE.test(rest);
		rest = rest.replace(ALLDAY_RE, "");

		let localId: string | null = null;
		const idMatch = rest.match(BLOCK_ID_RE);
		if (idMatch) {
			localId = idMatch[1];
			rest = rest.replace(BLOCK_ID_RE, "");
		}

		let calendarName = "";
		const calMatch = rest.match(CAL_RE);
		if (calMatch) {
			calendarName = calMatch[1].trim();
			rest = rest.replace(CAL_RE, "");
		}

		let startMinutes: number | null = null;
		let endMinutes: number | null = null;
		const timeMatch = rest.match(TIME_RE);
		if (timeMatch && !allDay) {
			startMinutes = toMinutes(Number(timeMatch[1]), Number(timeMatch[2]));
			if (timeMatch[3]) {
				endMinutes = toMinutes(Number(timeMatch[3]), Number(timeMatch[4]));
			}
			rest = rest.replace(TIME_RE, "");
		}

		const title = rest.trim();

		// 하위 불릿(설명) 수집.
		const descLines: string[] = [];
		let j = i + 1;
		while (j < sectionEnd) {
			const sub = lines[j].match(SUB_BULLET_RE);
			if (!sub) break;
			descLines.push(sub[1].trim());
			j++;
		}

		events.push({
			localId,
			title,
			description: descLines.join("\n"),
			startMinutes: allDay ? null : startMinutes,
			endMinutes: allDay ? null : endMinutes,
			allDay: allDay || startMinutes === null,
			calendarName,
			startLine,
			endLine: j,
		});
		i = j;
	}

	return events;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/note-repository.test.ts`
Expected: 5 passed.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/sync/note-repository.ts plugins/daily-calendar/src/sync/note-repository.test.ts
git commit -m "feat(daily-calendar): 데일리 노트 일정 파싱"
```

---

## Task 3: note-repository — 직렬화(줄 생성)와 upsert/remove

`NoteEvent` → 마크다운 줄들로 변환하고, 본문에서 블록 단위로 추가/갱신/삭제한다. 순수 함수, TDD.

**Files:**
- Modify: `plugins/daily-calendar/src/sync/note-repository.ts`
- Test: `plugins/daily-calendar/src/sync/note-repository.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`note-repository.test.ts` 끝에 추가:

```ts
import {
	renderEventLines,
	upsertEvent,
	removeEvent,
} from "./note-repository";

describe("renderEventLines", () => {
	it("시간 일정을 줄로 만든다", () => {
		const lines = renderEventLines({
			localId: "ic-x1",
			title: "회의",
			description: "안건 정리",
			startMinutes: 540,
			endMinutes: 600,
			allDay: false,
			calendarName: "업무",
			startLine: 0,
			endLine: 0,
		});
		expect(lines).toEqual([
			"- 09:00-10:00 회의 [업무] ^ic-x1",
			"\t- 안건 정리",
		]);
	});

	it("종일 일정을 줄로 만든다", () => {
		const lines = renderEventLines({
			localId: "ic-x2",
			title: "휴가",
			description: "",
			startMinutes: null,
			endMinutes: null,
			allDay: true,
			calendarName: "개인",
			startLine: 0,
			endLine: 0,
		});
		expect(lines).toEqual(["- 휴가 [개인] ^ic-x2 (종일)"]);
	});
});

describe("upsertEvent/removeEvent", () => {
	const BASE = ["# 2026-06-17", "", "## 일정", "", "- 14:00 기존 [업무] ^ic-old", ""].join("\n");

	it("localId가 있으면 해당 블록을 교체한다", () => {
		const next = upsertEvent(BASE, {
			localId: "ic-old",
			title: "변경됨",
			description: "",
			startMinutes: 900,
			endMinutes: null,
			allDay: false,
			calendarName: "업무",
			startLine: 0,
			endLine: 0,
		});
		expect(next).toContain("- 15:00 변경됨 [업무] ^ic-old");
		expect(next).not.toContain("기존");
	});

	it("localId가 없던 일정은 일정 섹션 끝에 추가한다", () => {
		const next = upsertEvent(BASE, {
			localId: "ic-new",
			title: "신규",
			description: "",
			startMinutes: 600,
			endMinutes: null,
			allDay: false,
			calendarName: "개인",
			startLine: 0,
			endLine: 0,
		});
		expect(next).toContain("- 14:00 기존 [업무] ^ic-old");
		expect(next).toContain("- 10:00 신규 [개인] ^ic-new");
	});

	it("일정 섹션이 없으면 만들어서 추가한다", () => {
		const next = upsertEvent("# 2026-06-17\n", {
			localId: "ic-z",
			title: "첫 일정",
			description: "",
			startMinutes: 480,
			endMinutes: null,
			allDay: false,
			calendarName: "개인",
			startLine: 0,
			endLine: 0,
		});
		expect(next).toContain("## 일정");
		expect(next).toContain("- 08:00 첫 일정 [개인] ^ic-z");
	});

	it("removeEvent는 블록을 제거한다", () => {
		const next = removeEvent(BASE, "ic-old");
		expect(next).not.toContain("ic-old");
		expect(next).not.toContain("기존");
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/note-repository.test.ts`
Expected: FAIL — `renderEventLines`/`upsertEvent`/`removeEvent` 미정의.

- [ ] **Step 3: 구현 추가**

`note-repository.ts` 끝에 추가:

```ts
function fromMinutes(min: number): string {
	const h = String(Math.floor(min / 60)).padStart(2, "0");
	const m = String(min % 60).padStart(2, "0");
	return `${h}:${m}`;
}

/** NoteEvent → 마크다운 줄 배열(첫 줄 + 설명 하위 불릿). */
export function renderEventLines(event: NoteEvent): string[] {
	let head = "- ";
	if (!event.allDay && event.startMinutes !== null) {
		head += fromMinutes(event.startMinutes);
		if (event.endMinutes !== null) head += `-${fromMinutes(event.endMinutes)}`;
		head += " ";
	}
	head += event.title;
	if (event.calendarName) head += ` [${event.calendarName}]`;
	if (event.localId) head += ` ^${event.localId}`;
	if (event.allDay) head += " (종일)";

	const lines = [head];
	if (event.description) {
		for (const d of event.description.split("\n")) {
			lines.push(`\t- ${d}`);
		}
	}
	return lines;
}

/** "## 일정" 섹션의 [start, end) 줄 범위를 반환한다. 없으면 null. */
function findSection(lines: string[]): { start: number; end: number } | null {
	for (let i = 0; i < lines.length; i++) {
		if (SECTION_RE.test(lines[i])) {
			let end = lines.length;
			for (let j = i + 1; j < lines.length; j++) {
				if (ANY_HEADING_RE.test(lines[j])) {
					end = j;
					break;
				}
			}
			return { start: i + 1, end };
		}
	}
	return null;
}

/** localId 일치 블록이 있으면 교체, 없으면 일정 섹션 끝에 추가한다. */
export function upsertEvent(content: string, event: NoteEvent): string {
	const lines = content.split("\n");
	const newLines = renderEventLines(event);

	if (event.localId) {
		const existing = parseNoteEvents(content).find(
			(e) => e.localId === event.localId,
		);
		if (existing) {
			lines.splice(existing.startLine, existing.endLine - existing.startLine, ...newLines);
			return lines.join("\n");
		}
	}

	let section = findSection(lines);
	if (!section) {
		// 섹션이 없으면 본문 끝에 생성.
		if (lines.length && lines[lines.length - 1] !== "") lines.push("");
		lines.push("## 일정", "");
		section = { start: lines.length, end: lines.length };
	}
	lines.splice(section.end, 0, ...newLines);
	return lines.join("\n");
}

/** localId 블록을 제거한다(없으면 원본 그대로). */
export function removeEvent(content: string, localId: string): string {
	const existing = parseNoteEvents(content).find((e) => e.localId === localId);
	if (!existing) return content;
	const lines = content.split("\n");
	lines.splice(existing.startLine, existing.endLine - existing.startLine);
	return lines.join("\n");
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/note-repository.test.ts`
Expected: 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/sync/note-repository.ts plugins/daily-calendar/src/sync/note-repository.test.ts
git commit -m "feat(daily-calendar): 일정 직렬화/upsert/remove"
```

---

## Task 4: ics.ts — VEVENT ↔ CalEvent

`ical.js`로 iCalendar 문자열을 `CalEvent`로 파싱하고, `CalEvent`를 단일 VEVENT가 든 VCALENDAR 문자열로 만든다. TDD.

**Files:**
- Create: `plugins/daily-calendar/src/ical/ics.ts`
- Test: `plugins/daily-calendar/src/ical/ics.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`plugins/daily-calendar/src/ical/ics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseVEvent, buildICS } from "./ics";

const SAMPLE = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:abc-123",
	"SUMMARY:치과 예약",
	"DESCRIPTION:정기 검진",
	"DTSTART:20260617T090000",
	"DTEND:20260617T100000",
	"LAST-MODIFIED:20260616T120000Z",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("parseVEvent", () => {
	it("UID/제목/설명/시작·종료를 읽는다", () => {
		const ev = parseVEvent(SAMPLE, "/cal/work/");
		expect(ev).toMatchObject({
			uid: "abc-123",
			title: "치과 예약",
			description: "정기 검진",
			allDay: false,
			calendarId: "/cal/work/",
		});
		expect(ev!.start.getHours()).toBe(9);
		expect(ev!.end!.getHours()).toBe(10);
		expect(ev!.lastModified).toBeInstanceOf(Date);
	});

	it("DTSTART가 DATE(종일)이면 allDay=true", () => {
		const allday = SAMPLE.replace("DTSTART:20260617T090000", "DTSTART;VALUE=DATE:20260617")
			.replace("DTEND:20260617T100000", "DTEND;VALUE=DATE:20260618");
		const ev = parseVEvent(allday, "/cal/work/");
		expect(ev!.allDay).toBe(true);
	});
});

describe("buildICS", () => {
	it("CalEvent를 다시 파싱하면 핵심 필드가 보존된다", () => {
		const ics = buildICS({
			uid: "new-1",
			title: "회의",
			description: "안건",
			start: new Date(2026, 5, 17, 14, 0, 0),
			end: new Date(2026, 5, 17, 15, 0, 0),
			allDay: false,
			calendarId: "/cal/work/",
			lastModified: null,
		});
		expect(ics).toContain("BEGIN:VEVENT");
		const round = parseVEvent(ics, "/cal/work/");
		expect(round).toMatchObject({ uid: "new-1", title: "회의", description: "안건" });
		expect(round!.start.getHours()).toBe(14);
	});

	it("allDay 이벤트는 VALUE=DATE로 쓴다", () => {
		const ics = buildICS({
			uid: "ad-1",
			title: "휴가",
			description: "",
			start: new Date(2026, 5, 17, 0, 0, 0),
			end: null,
			allDay: true,
			calendarId: "/cal/personal/",
			lastModified: null,
		});
		expect(ics).toMatch(/DTSTART;VALUE=DATE:20260617/);
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/ics.test.ts`
Expected: FAIL — 모듈 미정의.

- [ ] **Step 3: 구현**

`plugins/daily-calendar/src/ical/ics.ts`:

```ts
import ICAL from "ical.js";
import type { CalEvent } from "../types";

/** iCalendar(VCALENDAR) 문자열에서 첫 VEVENT를 CalEvent로 파싱한다. 없으면 null. */
export function parseVEvent(ics: string, calendarId: string): CalEvent | null {
	const jcal = ICAL.parse(ics);
	const comp = new ICAL.Component(jcal);
	const vevent = comp.getFirstSubcomponent("vevent");
	if (!vevent) return null;

	const event = new ICAL.Event(vevent);
	const startTime = event.startDate;
	const endTime = event.endDate;
	const allDay = startTime ? startTime.isDate : false;

	const lastModProp = vevent.getFirstPropertyValue("last-modified");
	const lastModified =
		lastModProp && typeof (lastModProp as ICAL.Time).toJSDate === "function"
			? (lastModProp as ICAL.Time).toJSDate()
			: null;

	return {
		uid: event.uid,
		title: event.summary ?? "",
		description: event.description ?? "",
		start: startTime.toJSDate(),
		end: endTime ? endTime.toJSDate() : null,
		allDay,
		calendarId,
		lastModified,
	};
}

/** CalEvent를 단일 VEVENT가 든 VCALENDAR 문자열로 직렬화한다. */
export function buildICS(event: CalEvent): string {
	const vcalendar = new ICAL.Component(["vcalendar", [], []]);
	vcalendar.updatePropertyWithValue("version", "2.0");
	vcalendar.updatePropertyWithValue("prodid", "-//daily-calendar//iCloud sync//KO");

	const vevent = new ICAL.Component("vevent");
	const ev = new ICAL.Event(vevent);
	ev.uid = event.uid;
	ev.summary = event.title;
	if (event.description) ev.description = event.description;

	ev.startDate = ICAL.Time.fromJSDate(event.start, false);
	if (event.allDay) ev.startDate.isDate = true;

	if (event.end) {
		ev.endDate = ICAL.Time.fromJSDate(event.end, false);
		if (event.allDay) ev.endDate.isDate = true;
	}

	vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
	vcalendar.addSubcomponent(vevent);
	return vcalendar.toString();
}
```

> 참고: ical.js v2는 ESM/CJS 모두 default export(`import ICAL from "ical.js"`)를 제공한다. 타입은 패키지에 동봉되어 있다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/ics.test.ts`
Expected: 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/ical/ics.ts plugins/daily-calendar/src/ical/ics.test.ts
git commit -m "feat(daily-calendar): VEVENT <-> CalEvent 변환(ical.js)"
```

---

## Task 5: event-store — 동기화 메타 저장소

`SyncRecord`를 uid 기준으로 보관하고, 플러그인 `data.json`을 통해 영속화한다. 저장 I/O는 주입형 콜백으로 받아 테스트에서 모킹한다. TDD.

`data.json` 스키마(플러그인 설정과 공존):
```
{
  settings: {...},        // 기존 MyPluginSettings
  syncRecords: SyncRecord[],
  calendars: CalendarRef[]
}
```

**Files:**
- Create: `plugins/daily-calendar/src/sync/event-store.ts`
- Test: `plugins/daily-calendar/src/sync/event-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`plugins/daily-calendar/src/sync/event-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EventStore } from "./event-store";
import type { SyncRecord } from "../types";

function record(uid: string, localId: string): SyncRecord {
	return {
		uid,
		localId,
		calendarId: "/cal/work/",
		etag: "etag-1",
		notePath: "Daily/2026-06-17.md",
		snapshot: {
			title: "회의",
			description: "",
			startISO: "2026-06-17T05:00:00.000Z",
			endISO: null,
			allDay: false,
			calendarId: "/cal/work/",
		},
	};
}

describe("EventStore", () => {
	it("uid와 localId로 조회한다", () => {
		const store = new EventStore([record("u1", "ic-1")]);
		expect(store.byUid("u1")?.localId).toBe("ic-1");
		expect(store.byLocalId("ic-1")?.uid).toBe("u1");
		expect(store.byUid("nope")).toBeUndefined();
	});

	it("put은 uid 기준으로 교체한다", () => {
		const store = new EventStore([record("u1", "ic-1")]);
		store.put({ ...record("u1", "ic-1"), etag: "etag-2" });
		expect(store.byUid("u1")?.etag).toBe("etag-2");
		expect(store.all()).toHaveLength(1);
	});

	it("remove는 uid를 지운다", () => {
		const store = new EventStore([record("u1", "ic-1")]);
		store.remove("u1");
		expect(store.byUid("u1")).toBeUndefined();
		expect(store.all()).toHaveLength(0);
	});

	it("toJSON/fromJSON 왕복", () => {
		const store = new EventStore([record("u1", "ic-1")]);
		const restored = EventStore.fromJSON(store.toJSON());
		expect(restored.byUid("u1")?.localId).toBe("ic-1");
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/event-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`plugins/daily-calendar/src/sync/event-store.ts`:

```ts
import type { SyncRecord } from "../types";

/** uid 기준 SyncRecord 인메모리 인덱스. 영속화는 호출자가 toJSON 결과를 저장. */
export class EventStore {
	private byUidMap = new Map<string, SyncRecord>();
	private byLocalIdMap = new Map<string, SyncRecord>();

	constructor(records: SyncRecord[] = []) {
		for (const r of records) this.index(r);
	}

	private index(r: SyncRecord) {
		this.byUidMap.set(r.uid, r);
		this.byLocalIdMap.set(r.localId, r);
	}

	byUid(uid: string): SyncRecord | undefined {
		return this.byUidMap.get(uid);
	}

	byLocalId(localId: string): SyncRecord | undefined {
		return this.byLocalIdMap.get(localId);
	}

	all(): SyncRecord[] {
		return [...this.byUidMap.values()];
	}

	put(record: SyncRecord) {
		const prev = this.byUidMap.get(record.uid);
		if (prev) this.byLocalIdMap.delete(prev.localId);
		this.index(record);
	}

	remove(uid: string) {
		const prev = this.byUidMap.get(uid);
		if (!prev) return;
		this.byUidMap.delete(uid);
		this.byLocalIdMap.delete(prev.localId);
	}

	toJSON(): SyncRecord[] {
		return this.all();
	}

	static fromJSON(records: SyncRecord[] | undefined): EventStore {
		return new EventStore(records ?? []);
	}
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/event-store.test.ts`
Expected: 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/sync/event-store.ts plugins/daily-calendar/src/sync/event-store.test.ts
git commit -m "feat(daily-calendar): 동기화 메타 저장소(event-store)"
```

---

## Task 6: reconcile — 3-way LWW 머지 결정(순수)

로컬/원격/스냅샷을 받아 uid별로 수행할 액션 목록을 결정한다. 네트워크/파일 I/O 없음. 이 함수가 동기화의 두뇌다. TDD.

액션 종류:
- `push` — 로컬을 iCloud로 (생성 또는 갱신)
- `pull` — iCloud를 마크다운으로 (생성 또는 갱신)
- `delete-remote` — iCloud에서 삭제
- `delete-local` — 마크다운에서 삭제

**Files:**
- Create: `plugins/daily-calendar/src/sync/reconcile.ts`
- Test: `plugins/daily-calendar/src/sync/reconcile.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`plugins/daily-calendar/src/sync/reconcile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reconcile, type ReconcileInput } from "./reconcile";
import type { CalEvent, SyncRecord } from "../types";

function ev(uid: string, title: string, lastModified: Date | null = null): CalEvent {
	return {
		uid,
		title,
		description: "",
		start: new Date(2026, 5, 17, 9, 0, 0),
		end: null,
		allDay: false,
		calendarId: "/cal/work/",
		lastModified,
	};
}

function rec(uid: string, snapshotTitle: string): SyncRecord {
	return {
		uid,
		localId: `ic-${uid}`,
		calendarId: "/cal/work/",
		etag: "e1",
		notePath: "Daily/2026-06-17.md",
		snapshot: {
			title: snapshotTitle,
			description: "",
			startISO: "2026-06-17T00:00:00.000Z",
			endISO: null,
			allDay: false,
			calendarId: "/cal/work/",
		},
	};
}

function run(input: Partial<ReconcileInput>) {
	return reconcile({
		local: input.local ?? [],
		remote: input.remote ?? [],
		records: input.records ?? [],
		localMtime: input.localMtime ?? new Date(2026, 5, 17, 12, 0, 0),
	});
}

describe("reconcile", () => {
	it("스냅샷 없는 로컬 신규는 push", () => {
		const actions = run({ local: [ev("a", "신규")] });
		expect(actions).toContainEqual({ type: "push", event: expect.objectContaining({ uid: "a" }) });
	});

	it("스냅샷 없는 원격 신규는 pull", () => {
		const actions = run({ remote: [ev("b", "원격신규")] });
		expect(actions).toContainEqual({ type: "pull", event: expect.objectContaining({ uid: "b" }) });
	});

	it("로컬만 변경되면 push", () => {
		const actions = run({
			local: [ev("c", "수정됨")],
			remote: [ev("c", "원본")],
			records: [rec("c", "원본")],
		});
		expect(actions).toContainEqual({ type: "push", event: expect.objectContaining({ title: "수정됨" }) });
	});

	it("원격만 변경되면 pull", () => {
		const actions = run({
			local: [ev("d", "원본")],
			remote: [ev("d", "원격수정")],
			records: [rec("d", "원본")],
		});
		expect(actions).toContainEqual({ type: "pull", event: expect.objectContaining({ title: "원격수정" }) });
	});

	it("양쪽 변경 충돌 시 더 최신(LWW)이 이긴다 - 원격이 최신", () => {
		const actions = run({
			local: [ev("e", "로컬수정")],
			remote: [ev("e", "원격수정", new Date(2026, 5, 17, 13, 0, 0))],
			records: [rec("e", "원본")],
			localMtime: new Date(2026, 5, 17, 12, 0, 0),
		});
		expect(actions).toContainEqual({ type: "pull", event: expect.objectContaining({ title: "원격수정" }) });
	});

	it("로컬에서 삭제(스냅샷 있음, 로컬 없음)되면 delete-remote", () => {
		const actions = run({
			remote: [ev("f", "원본")],
			records: [rec("f", "원본")],
		});
		expect(actions).toContainEqual({ type: "delete-remote", uid: "f" });
	});

	it("원격에서 삭제(스냅샷 있음, 원격 없음)되면 delete-local", () => {
		const actions = run({
			local: [ev("g", "원본")],
			records: [rec("g", "원본")],
		});
		expect(actions).toContainEqual({ type: "delete-local", uid: "g" });
	});

	it("변경 없으면 액션 없음", () => {
		const actions = run({
			local: [ev("h", "동일")],
			remote: [ev("h", "동일")],
			records: [rec("h", "동일")],
		});
		expect(actions).toHaveLength(0);
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/reconcile.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`plugins/daily-calendar/src/sync/reconcile.ts`:

```ts
import type { CalEvent, CalEventSnapshot, SyncRecord } from "../types";

export type SyncAction =
	| { type: "push"; event: CalEvent }
	| { type: "pull"; event: CalEvent }
	| { type: "delete-remote"; uid: string }
	| { type: "delete-local"; uid: string };

export interface ReconcileInput {
	local: CalEvent[];
	remote: CalEvent[];
	records: SyncRecord[];
	/** 데일리 노트들의 가장 최근 수정 시각(로컬 변경 시점 추정, LWW용). */
	localMtime: Date;
}

function snapshotOf(e: CalEvent): CalEventSnapshot {
	return {
		title: e.title,
		description: e.description,
		startISO: e.start.toISOString(),
		endISO: e.end ? e.end.toISOString() : null,
		allDay: e.allDay,
		calendarId: e.calendarId,
	};
}

function sameAsSnapshot(e: CalEvent, snap: CalEventSnapshot): boolean {
	const s = snapshotOf(e);
	return (
		s.title === snap.title &&
		s.description === snap.description &&
		s.startISO === snap.startISO &&
		s.endISO === snap.endISO &&
		s.allDay === snap.allDay &&
		s.calendarId === snap.calendarId
	);
}

/** 3-way 비교로 동기화 액션을 결정한다(LWW). */
export function reconcile(input: ReconcileInput): SyncAction[] {
	const actions: SyncAction[] = [];
	const localByUid = new Map(input.local.map((e) => [e.uid, e]));
	const remoteByUid = new Map(input.remote.map((e) => [e.uid, e]));
	const recByUid = new Map(input.records.map((r) => [r.uid, r]));

	const uids = new Set<string>([
		...localByUid.keys(),
		...remoteByUid.keys(),
		...recByUid.keys(),
	]);

	for (const uid of uids) {
		const local = localByUid.get(uid);
		const remote = remoteByUid.get(uid);
		const record = recByUid.get(uid);

		// 신규: 한쪽에만 있고 스냅샷 없음.
		if (!record) {
			if (local && !remote) actions.push({ type: "push", event: local });
			else if (remote && !local) actions.push({ type: "pull", event: remote });
			// 양쪽 다 있는데 record 없음(드묾): 원격을 진실로 보고 pull.
			else if (remote && local) actions.push({ type: "pull", event: remote });
			continue;
		}

		// 삭제 판정: 스냅샷 있는데 한쪽이 사라짐.
		if (record && !local && remote) {
			actions.push({ type: "delete-remote", uid });
			continue;
		}
		if (record && local && !remote) {
			actions.push({ type: "delete-local", uid });
			continue;
		}
		if (record && !local && !remote) {
			// 양쪽 다 사라짐: 정리만(액션 없음, sync-engine이 record 제거).
			continue;
		}

		// 양쪽 다 존재: 변경 여부 비교.
		const localChanged = local ? !sameAsSnapshot(local, record.snapshot) : false;
		const remoteChanged = remote ? !sameAsSnapshot(remote, record.snapshot) : false;

		if (!localChanged && !remoteChanged) continue;
		if (localChanged && !remoteChanged) {
			actions.push({ type: "push", event: local! });
			continue;
		}
		if (!localChanged && remoteChanged) {
			actions.push({ type: "pull", event: remote! });
			continue;
		}

		// 충돌: LWW. 원격 lastModified vs 로컬 mtime.
		const remoteTime = remote!.lastModified?.getTime() ?? 0;
		const localTime = input.localMtime.getTime();
		if (remoteTime >= localTime) actions.push({ type: "pull", event: remote! });
		else actions.push({ type: "push", event: local! });
	}

	return actions;
}

export { snapshotOf };
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/reconcile.test.ts`
Expected: 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/sync/reconcile.ts plugins/daily-calendar/src/sync/reconcile.test.ts
git commit -m "feat(daily-calendar): 3-way LWW reconcile"
```

---

## Task 7: caldav-xml — 요청 XML 빌더 + 응답 파서(순수)

CalDAV 요청 본문 XML을 만들고, multistatus 응답에서 href/etag/calendar-data/displayname/color를 추출한다. DOMParser는 Obsidian(Electron) 런타임에 있으나 vitest(node)에는 없으므로, **파서 함수는 `DOMParser` 구현을 주입**받는다. 테스트에서는 `@xmldom/xmldom`을 쓴다.

**Files:**
- Modify: `plugins/daily-calendar/package.json` (devDep `@xmldom/xmldom`)
- Create: `plugins/daily-calendar/src/ical/caldav-xml.ts`
- Test: `plugins/daily-calendar/src/ical/caldav-xml.test.ts`

- [ ] **Step 1: 테스트용 XML 파서 설치**

`plugins/daily-calendar/package.json`의 `devDependencies`에 `"@xmldom/xmldom": "^0.9.0"` 추가 후:

Run (루트): `pnpm install`
Expected: 설치 성공.

- [ ] **Step 2: 실패 테스트 작성**

`plugins/daily-calendar/src/ical/caldav-xml.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import {
	buildCalendarQuery,
	buildSyncCollection,
	parseCalendarList,
	parseEventReport,
} from "./caldav-xml";

const parse = (xml: string) =>
	new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument;

describe("XML 빌더", () => {
	it("calendar-query에 시간 범위가 들어간다", () => {
		const xml = buildCalendarQuery("20260601T000000Z", "20260701T000000Z");
		expect(xml).toContain("calendar-query");
		expect(xml).toContain("20260601T000000Z");
	});

	it("sync-collection에 sync-token이 들어간다", () => {
		expect(buildSyncCollection("tok-1")).toContain("<d:sync-token>tok-1</d:sync-token>");
		expect(buildSyncCollection(undefined)).toContain("<d:sync-token></d:sync-token>");
	});
});

describe("응답 파서", () => {
	it("캘린더 목록에서 href/이름/색을 뽑는다", () => {
		const xml = `<?xml version="1.0"?>
		<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
		  <d:response>
		    <d:href>/123/calendars/work/</d:href>
		    <d:propstat><d:prop>
		      <d:displayname>업무</d:displayname>
		      <ic:calendar-color>#FF0000</ic:calendar-color>
		      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
		    </d:prop></d:propstat>
		  </d:response>
		  <d:response>
		    <d:href>/123/calendars/inbox/</d:href>
		    <d:propstat><d:prop>
		      <d:displayname>Inbox</d:displayname>
		      <d:resourcetype><d:collection/></d:resourcetype>
		    </d:prop></d:propstat>
		  </d:response>
		</d:multistatus>`;
		const cals = parseCalendarList(parse(xml));
		expect(cals).toHaveLength(1); // calendar resourcetype 인 것만
		expect(cals[0]).toMatchObject({ id: "/123/calendars/work/", name: "업무", color: "#FF0000" });
	});

	it("이벤트 리포트에서 href/etag/calendar-data를 뽑는다", () => {
		const xml = `<?xml version="1.0"?>
		<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
		  <d:response>
		    <d:href>/123/calendars/work/evt1.ics</d:href>
		    <d:propstat><d:prop>
		      <d:getetag>"etag-1"</d:getetag>
		      <c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data>
		    </d:prop></d:propstat>
		  </d:response>
		</d:multistatus>`;
		const items = parseEventReport(parse(xml));
		expect(items[0]).toMatchObject({
			href: "/123/calendars/work/evt1.ics",
			etag: '"etag-1"',
		});
		expect(items[0].calendarData).toContain("VCALENDAR");
	});
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/caldav-xml.test.ts`
Expected: FAIL.

- [ ] **Step 4: 구현**

`plugins/daily-calendar/src/ical/caldav-xml.ts`:

```ts
import type { CalendarRef } from "../types";

/** 시간 범위로 VEVENT를 조회하는 calendar-query REPORT 본문. */
export function buildCalendarQuery(startUTC: string, endUTC: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startUTC}" end="${endUTC}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

/** 증분 변경을 받는 sync-collection REPORT 본문. token 없으면 전체. */
export function buildSyncCollection(syncToken: string | undefined): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-token>${syncToken ?? ""}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:sync-collection>`;
}

/** PROPFIND(calendar-home 하위)로 캘린더 컬렉션을 찾는 본문. */
export function buildCalendarPropfind(): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <ic:calendar-color/>
    <d:sync-token/>
  </d:prop>
</d:propfind>`;
}

function local(el: Element, name: string): Element | null {
	const list = el.getElementsByTagName("*");
	for (let i = 0; i < list.length; i++) {
		const node = list[i];
		if (node.localName === name) return node as Element;
	}
	return null;
}

function text(el: Element | null): string {
	return el?.textContent?.trim() ?? "";
}

/** PROPFIND 응답에서 calendar 컬렉션만 CalendarRef로 추출. */
export function parseCalendarList(doc: XMLDocument): CalendarRef[] {
	const cals: CalendarRef[] = [];
	const responses = doc.getElementsByTagName("*");
	for (let i = 0; i < responses.length; i++) {
		const r = responses[i];
		if (r.localName !== "response") continue;
		const resourcetype = local(r as Element, "resourcetype");
		const isCalendar =
			!!resourcetype &&
			Array.from(resourcetype.getElementsByTagName("*")).some(
				(n) => (n as Element).localName === "calendar",
			);
		if (!isCalendar) continue;
		const href = text(local(r as Element, "href"));
		const name = text(local(r as Element, "displayname")) || href;
		const color = text(local(r as Element, "calendar-color")) || undefined;
		if (href) cals.push({ id: href, name, color });
	}
	return cals;
}

export interface ReportItem {
	href: string;
	etag: string;
	/** 삭제된 항목(404 status)이면 calendarData는 빈 문자열. */
	calendarData: string;
	deleted: boolean;
}

/** REPORT(multistatus) 응답에서 이벤트 항목들을 추출. */
export function parseEventReport(doc: XMLDocument): ReportItem[] {
	const items: ReportItem[] = [];
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		const r = all[i];
		if (r.localName !== "response") continue;
		const el = r as Element;
		const href = text(local(el, "href"));
		const status = text(local(el, "status"));
		const deleted = status.includes("404");
		items.push({
			href,
			etag: text(local(el, "getetag")),
			calendarData: text(local(el, "calendar-data")),
			deleted,
		});
	}
	return items;
}

/** multistatus의 최상위 sync-token 추출. */
export function parseSyncToken(doc: XMLDocument): string | undefined {
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		const n = all[i];
		if (n.localName === "sync-token" && n.parentNode && (n.parentNode as Element).localName === "multistatus") {
			return n.textContent?.trim() || undefined;
		}
	}
	return undefined;
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/caldav-xml.test.ts`
Expected: 모든 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
git add plugins/daily-calendar/src/ical/caldav-xml.ts plugins/daily-calendar/src/ical/caldav-xml.test.ts plugins/daily-calendar/package.json pnpm-lock.yaml
git commit -m "feat(daily-calendar): CalDAV XML 빌더/파서"
```

---

## Task 8: caldav-client — requestUrl 기반 CalDAV 클라이언트

네트워크 계층. `requestUrl`과 `DOMParser`를 주입받아(테스트 가능성 + 런타임 분리) iCloud와 통신한다. 단위 테스트는 주입한 가짜 `requestUrl`로 호출 인자/흐름만 검증한다(실제 네트워크는 수동 통합 테스트).

iCloud 흐름:
1. `PROPFIND` `https://caldav.icloud.com/` (Depth 0, `current-user-principal`) → principal URL.
2. `PROPFIND` principal (`calendar-home-set`) → calendar-home URL.
3. `PROPFIND` calendar-home (Depth 1, `buildCalendarPropfind`) → 캘린더 목록.
4. `REPORT` 각 캘린더 → 이벤트.
5. `PUT`/`DELETE` `https://caldav.icloud.com<href>` → 생성/수정/삭제.

**Files:**
- Create: `plugins/daily-calendar/src/ical/caldav-client.ts`
- Test: `plugins/daily-calendar/src/ical/caldav-client.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`plugins/daily-calendar/src/ical/caldav-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { CalDavClient, type HttpResponse } from "./caldav-client";

const deps = (responder: (url: string, opts: any) => HttpResponse) => ({
	requestUrl: vi.fn(async (opts: any) => responder(opts.url, opts)),
	parseXml: (xml: string) =>
		new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument,
});

describe("CalDavClient", () => {
	it("PUT은 Authorization 헤더와 ICS 본문을 보낸다", async () => {
		const d = deps(() => ({ status: 201, headers: { etag: '"e9"' }, text: "" }));
		const client = new CalDavClient(
			{ username: "me@icloud.com", appPassword: "abcd-efgh" },
			d,
		);
		const res = await client.putEvent("/123/calendars/work/new.ics", "BEGIN:VCALENDAR");
		expect(res.etag).toBe('"e9"');
		const call = d.requestUrl.mock.calls[0][0];
		expect(call.method).toBe("PUT");
		expect(call.headers.Authorization).toMatch(/^Basic /);
		expect(call.body).toContain("VCALENDAR");
	});

	it("deleteEvent는 DELETE를 보낸다", async () => {
		const d = deps(() => ({ status: 204, headers: {}, text: "" }));
		const client = new CalDavClient(
			{ username: "u", appPassword: "p" },
			d,
		);
		await client.deleteEvent("/123/calendars/work/x.ics");
		expect(d.requestUrl.mock.calls[0][0].method).toBe("DELETE");
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/caldav-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`plugins/daily-calendar/src/ical/caldav-client.ts`:

```ts
import type { CalendarRef } from "../types";
import {
	buildCalendarPropfind,
	buildSyncCollection,
	parseCalendarList,
	parseEventReport,
	parseSyncToken,
	type ReportItem,
} from "./caldav-xml";

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

export interface CalDavDeps {
	/** Obsidian requestUrl 호환 시그니처. */
	requestUrl: (opts: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: string;
	}) => Promise<HttpResponse>;
	parseXml: (xml: string) => XMLDocument;
}

export interface Credentials {
	username: string;
	appPassword: string;
}

const BASE = "https://caldav.icloud.com";

export class CalDavClient {
	constructor(
		private creds: Credentials,
		private deps: CalDavDeps,
	) {}

	private authHeader(): string {
		const raw = `${this.creds.username}:${this.creds.appPassword}`;
		// Electron/Node 모두 Buffer 사용 가능(번들 대상이 Electron).
		const b64 =
			typeof btoa === "function"
				? btoa(raw)
				: Buffer.from(raw, "utf-8").toString("base64");
		return `Basic ${b64}`;
	}

	private async request(
		url: string,
		method: string,
		extraHeaders: Record<string, string> = {},
		body?: string,
	): Promise<HttpResponse> {
		const fullUrl = url.startsWith("http") ? url : `${BASE}${url}`;
		const res = await this.deps.requestUrl({
			url: fullUrl,
			method,
			headers: {
				Authorization: this.authHeader(),
				"Content-Type": "application/xml; charset=utf-8",
				...extraHeaders,
			},
			body,
		});
		if (res.status >= 400) {
			throw new Error(`CalDAV ${method} ${url} 실패: ${res.status}`);
		}
		return res;
	}

	/** current-user-principal → calendar-home → 캘린더 목록. */
	async discoverCalendars(): Promise<CalendarRef[]> {
		const principalBody = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
		const principalRes = await this.request("/", "PROPFIND", { Depth: "0" }, principalBody);
		const principalHref = firstHref(
			this.deps.parseXml(principalRes.text),
			"current-user-principal",
		);

		const homeBody = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
		const homeRes = await this.request(principalHref, "PROPFIND", { Depth: "0" }, homeBody);
		const homeHref = firstHref(this.deps.parseXml(homeRes.text), "calendar-home-set");

		const listRes = await this.request(
			homeHref,
			"PROPFIND",
			{ Depth: "1" },
			buildCalendarPropfind(),
		);
		const doc = this.deps.parseXml(listRes.text);
		const cals = parseCalendarList(doc);
		return cals;
	}

	/** sync-collection으로 증분(또는 전체) 이벤트와 새 sync-token을 받는다. */
	async fetchEvents(
		calendar: CalendarRef,
	): Promise<{ items: ReportItem[]; syncToken: string | undefined }> {
		const res = await this.request(
			calendar.id,
			"REPORT",
			{ Depth: "1" },
			buildSyncCollection(calendar.syncToken),
		);
		const doc = this.deps.parseXml(res.text);
		return { items: parseEventReport(doc), syncToken: parseSyncToken(doc) };
	}

	/** ICS를 PUT으로 생성/갱신. ifMatch가 있으면 조건부. 새 etag 반환. */
	async putEvent(
		href: string,
		ics: string,
		ifMatch?: string,
	): Promise<{ etag: string }> {
		const headers: Record<string, string> = {
			"Content-Type": "text/calendar; charset=utf-8",
		};
		if (ifMatch) headers["If-Match"] = ifMatch;
		const res = await this.request(href, "PUT", headers, ics);
		return { etag: res.headers["etag"] ?? res.headers["ETag"] ?? "" };
	}

	async deleteEvent(href: string, ifMatch?: string): Promise<void> {
		const headers: Record<string, string> = {};
		if (ifMatch) headers["If-Match"] = ifMatch;
		await this.request(href, "DELETE", headers);
	}
}

/** multistatus에서 특정 prop 아래의 첫 href를 찾는다. */
function firstHref(doc: XMLDocument, propName: string): string {
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		if (all[i].localName === propName) {
			const hrefs = (all[i] as Element).getElementsByTagName("*");
			for (let j = 0; j < hrefs.length; j++) {
				if (hrefs[j].localName === "href") {
					return hrefs[j].textContent?.trim() ?? "";
				}
			}
		}
	}
	throw new Error(`${propName}에서 href를 찾지 못했습니다`);
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/ical/caldav-client.test.ts`
Expected: 2 passed.

- [ ] **Step 5: 커밋**

```bash
git add plugins/daily-calendar/src/ical/caldav-client.ts plugins/daily-calendar/src/ical/caldav-client.test.ts
git commit -m "feat(daily-calendar): requestUrl 기반 CalDAV 클라이언트"
```

---

## Task 9: sync-engine — reconcile + I/O 오케스트레이션

순수 계층을 조립해 실제 동기화를 수행한다. Obsidian `vault`/`requestUrl`에 의존하므로 단위 테스트는 핵심 헬퍼(uid→href 매핑, CalEvent↔NoteEvent 변환)만 다루고, 전체 흐름은 수동 통합 테스트.

**Files:**
- Create: `plugins/daily-calendar/src/sync/sync-engine.ts`
- Test: `plugins/daily-calendar/src/sync/sync-engine.test.ts`

- [ ] **Step 1: 실패 테스트 작성(순수 헬퍼)**

`plugins/daily-calendar/src/sync/sync-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { noteEventToCalEvent, calEventToNoteEvent } from "./sync-engine";
import type { CalEvent } from "../types";

const DAY = new Date(2026, 5, 17);

describe("noteEventToCalEvent", () => {
	it("시간 일정을 그날 날짜의 Date로 변환한다", () => {
		const ce = noteEventToCalEvent(
			{
				localId: "ic-1",
				title: "회의",
				description: "안건",
				startMinutes: 540,
				endMinutes: 600,
				allDay: false,
				calendarName: "업무",
				startLine: 0,
				endLine: 0,
			},
			DAY,
			"u1",
			"/cal/work/",
		);
		expect(ce.start.getHours()).toBe(9);
		expect(ce.end?.getHours()).toBe(10);
		expect(ce.allDay).toBe(false);
		expect(ce.uid).toBe("u1");
	});
});

describe("calEventToNoteEvent", () => {
	it("CalEvent의 시각을 분으로 환산한다", () => {
		const ce: CalEvent = {
			uid: "u1",
			title: "회의",
			description: "",
			start: new Date(2026, 5, 17, 14, 30, 0),
			end: new Date(2026, 5, 17, 15, 0, 0),
			allDay: false,
			calendarId: "/cal/work/",
			lastModified: null,
		};
		const ne = calEventToNoteEvent(ce, "ic-9", "업무");
		expect(ne.startMinutes).toBe(870);
		expect(ne.endMinutes).toBe(900);
		expect(ne.localId).toBe("ic-9");
		expect(ne.calendarName).toBe("업무");
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/sync-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현(헬퍼 + 엔진)**

`plugins/daily-calendar/src/sync/sync-engine.ts`:

```ts
import { Notice, type Vault } from "obsidian";
import type { CalEvent, CalendarRef, NoteEvent, SyncRecord } from "../types";
import { CalDavClient } from "../ical/caldav-client";
import { buildICS, parseVEvent } from "../ical/ics";
import { EventStore } from "./event-store";
import { reconcile, snapshotOf } from "./reconcile";
import {
	parseNoteEvents,
	upsertEvent,
	removeEvent,
} from "./note-repository";

/** NoteEvent를 특정 날짜 기준 CalEvent로 변환. */
export function noteEventToCalEvent(
	ne: NoteEvent,
	day: Date,
	uid: string,
	calendarId: string,
): CalEvent {
	const base = new Date(day.getFullYear(), day.getMonth(), day.getDate());
	const start = new Date(base);
	if (!ne.allDay && ne.startMinutes !== null) {
		start.setMinutes(ne.startMinutes);
	}
	let end: Date | null = null;
	if (!ne.allDay && ne.endMinutes !== null) {
		end = new Date(base);
		end.setMinutes(ne.endMinutes);
	}
	return {
		uid,
		title: ne.title,
		description: ne.description,
		start,
		end,
		allDay: ne.allDay,
		calendarId,
		lastModified: null,
	};
}

/** CalEvent를 NoteEvent로 변환(마크다운 기록용). */
export function calEventToNoteEvent(
	ce: CalEvent,
	localId: string,
	calendarName: string,
): NoteEvent {
	const startMinutes = ce.allDay
		? null
		: ce.start.getHours() * 60 + ce.start.getMinutes();
	const endMinutes =
		ce.allDay || !ce.end ? null : ce.end.getHours() * 60 + ce.end.getMinutes();
	return {
		localId,
		title: ce.title,
		description: ce.description,
		startMinutes,
		endMinutes,
		allDay: ce.allDay,
		calendarName,
		startLine: 0,
		endLine: 0,
	};
}

/** ISO yyyy-mm-dd 로컬 날짜 문자열. */
function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

let idCounter = 0;
function genLocalId(): string {
	idCounter += 1;
	return `ic-${Date.now().toString(36)}${idCounter.toString(36)}`;
}
function genUid(): string {
	return `${Date.now().toString(36)}-${Math.floor(idCounter++).toString(36)}@daily-calendar`;
}

export interface SyncEngineConfig {
	folder: string;
	calendars: CalendarRef[];
	/** 새 일정 push 대상 캘린더 id(모달 미지정 시 기본). */
	defaultCalendarId: string;
}

export class SyncEngine {
	constructor(
		private vault: Vault,
		private client: CalDavClient,
		private store: EventStore,
		private config: SyncEngineConfig,
		private persist: () => Promise<void>,
	) {}

	private calName(id: string): string {
		return this.config.calendars.find((c) => c.id === id)?.name ?? "";
	}
	private calIdByName(name: string): string {
		return (
			this.config.calendars.find((c) => c.name === name)?.id ??
			this.config.defaultCalendarId
		);
	}
	private notePath(day: string): string {
		const f = this.config.folder.trim();
		return f ? `${f}/${day}.md` : `${day}.md`;
	}
	private hrefFor(record: SyncRecord): string {
		return `${record.calendarId}${encodeURIComponent(record.uid)}.ics`;
	}

	/** 전체 양방향 동기화 1회 실행. */
	async syncAll(): Promise<void> {
		try {
			// 1) 원격 수집.
			const remote: CalEvent[] = [];
			for (const cal of this.config.calendars) {
				const { items, syncToken } = await this.client.fetchEvents(cal);
				cal.syncToken = syncToken;
				for (const it of items) {
					if (it.deleted || !it.calendarData) continue;
					const ev = parseVEvent(it.calendarData, cal.id);
					if (ev) remote.push(ev);
				}
			}

			// 2) 로컬 수집(모든 데일리 노트).
			const { local, mtime } = await this.collectLocal();

			// 3) reconcile.
			const actions = reconcile({
				local,
				remote,
				records: this.store.all(),
				localMtime: mtime,
			});

			// 4) 액션 실행.
			for (const action of actions) {
				if (action.type === "push") await this.doPush(action.event);
				else if (action.type === "pull") await this.doPull(action.event);
				else if (action.type === "delete-remote") await this.doDeleteRemote(action.uid);
				else if (action.type === "delete-local") await this.doDeleteLocal(action.uid);
			}

			await this.persist();
			new Notice(`iCloud 동기화 완료 (${actions.length}건)`);
		} catch (e) {
			console.error(e);
			new Notice(`iCloud 동기화 실패: ${(e as Error).message}`);
		}
	}

	private async collectLocal(): Promise<{ local: CalEvent[]; mtime: Date }> {
		const local: CalEvent[] = [];
		let mtime = new Date(0);
		const folder = this.config.folder.trim();
		const files = this.vault.getMarkdownFiles().filter((f) =>
			folder ? f.path.startsWith(`${folder}/`) : true,
		);
		for (const file of files) {
			const day = file.basename; // YYYY-MM-DD
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
			if (file.stat.mtime > mtime.getTime()) mtime = new Date(file.stat.mtime);
			const content = await this.vault.cachedRead(file);
			const dayDate = new Date(`${day}T00:00:00`);
			for (const ne of parseNoteEvents(content)) {
				const rec = ne.localId ? this.store.byLocalId(ne.localId) : undefined;
				const uid = rec?.uid ?? genUid();
				const calId = this.calIdByName(ne.calendarName);
				local.push(noteEventToCalEvent(ne, dayDate, uid, calId));
				// 신규(블록ID 없던 줄)를 위해 임시 매핑은 push 시 처리.
				if (!ne.localId) {
					(local[local.length - 1] as any).__newLocalId = genLocalId();
					(local[local.length - 1] as any).__notePath = file.path;
				}
			}
		}
		return { local, mtime };
	}

	private async doPush(event: CalEvent): Promise<void> {
		const existing = this.store.byUid(event.uid);
		const localId = existing?.localId ?? (event as any).__newLocalId ?? genLocalId();
		const ics = buildICS(event);
		const href = `${event.calendarId}${encodeURIComponent(event.uid)}.ics`;
		const { etag } = await this.client.putEvent(href, ics, existing?.etag);

		const notePath =
			existing?.notePath ?? (event as any).__notePath ?? this.notePath(dayKey(event.start));
		// 블록ID가 없던 신규면 마크다운에 블록ID를 써넣는다.
		await this.writeNote(notePath, (content) =>
			upsertEvent(content, calEventToNoteEvent(event, localId, this.calName(event.calendarId))),
		);
		this.store.put({
			uid: event.uid,
			localId,
			calendarId: event.calendarId,
			etag,
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doPull(event: CalEvent): Promise<void> {
		const existing = this.store.byUid(event.uid);
		const localId = existing?.localId ?? genLocalId();
		const notePath = this.notePath(dayKey(event.start));
		await this.writeNote(notePath, (content) =>
			upsertEvent(content, calEventToNoteEvent(event, localId, this.calName(event.calendarId))),
		);
		this.store.put({
			uid: event.uid,
			localId,
			calendarId: event.calendarId,
			etag: existing?.etag ?? "",
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doDeleteRemote(uid: string): Promise<void> {
		const rec = this.store.byUid(uid);
		if (!rec) return;
		await this.client.deleteEvent(this.hrefFor(rec), rec.etag);
		this.store.remove(uid);
	}

	private async doDeleteLocal(uid: string): Promise<void> {
		const rec = this.store.byUid(uid);
		if (!rec) return;
		await this.writeNote(rec.notePath, (content) => removeEvent(content, rec.localId));
		this.store.remove(uid);
	}

	/** 파일을 읽어 transform 적용 후 저장(없으면 생성). */
	private async writeNote(path: string, transform: (c: string) => string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);
		if (file && "stat" in file) {
			const content = await this.vault.read(file as any);
			await this.vault.modify(file as any, transform(content));
		} else {
			await this.vault.create(path, transform(`# ${path.replace(/.*\//, "").replace(/\.md$/, "")}\n`));
		}
	}

	/** 모달에서 새 일정 생성 → 즉시 push. */
	async createEvent(input: {
		day: Date;
		title: string;
		description: string;
		startMinutes: number | null;
		endMinutes: number | null;
		allDay: boolean;
		calendarId: string;
	}): Promise<void> {
		const uid = genUid();
		const ne: NoteEvent = {
			localId: null,
			title: input.title,
			description: input.description,
			startMinutes: input.startMinutes,
			endMinutes: input.endMinutes,
			allDay: input.allDay,
			calendarName: this.calName(input.calendarId),
			startLine: 0,
			endLine: 0,
		};
		const ce = noteEventToCalEvent(ne, input.day, uid, input.calendarId);
		await this.doPush(ce);
		await this.persist();
	}
}
```

> 주: `collectLocal`에서 신규 줄에 임시로 붙인 `__newLocalId`/`__notePath`는 `doPush`에서만 읽는 일회용 힌트다. 더 깔끔히 하려면 별도 타입을 둘 수 있으나 v1은 이 방식으로 둔다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter daily-calendar exec vitest run src/sync/sync-engine.test.ts`
Expected: 통과(헬퍼 2개 테스트).

- [ ] **Step 5: 타입체크 + 커밋**

Run: `pnpm --filter daily-calendar exec tsc -noEmit -skipLibCheck`
Expected: 에러 없음.

```bash
git add plugins/daily-calendar/src/sync/sync-engine.ts plugins/daily-calendar/src/sync/sync-engine.test.ts
git commit -m "feat(daily-calendar): 동기화 엔진(reconcile+I/O 조립)"
```

---

## Task 10: 설정 UI 확장

자격증명, 캘린더 발견/선택, 동기화 간격을 설정에 추가한다. UI라 단위 테스트 없음 — 타입체크와 수동 확인.

**Files:**
- Modify: `plugins/daily-calendar/src/settings.ts`

- [ ] **Step 1: settings.ts 교체**

```ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";
import type { CalendarRef, SyncRecord } from "./types";

export interface MyPluginSettings {
	calendarFolder: string;
	icloudUsername: string;
	icloudAppPassword: string;
	/** 자동 동기화 간격(분). 0이면 자동 끔. */
	syncIntervalMinutes: number;
	/** 새 일정 push 기본 캘린더 id. */
	defaultCalendarId: string;
	/** 발견된 캘린더 캐시. */
	calendars: CalendarRef[];
	/** 동기화 메타(event-store 직렬화). */
	syncRecords: SyncRecord[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	calendarFolder: "",
	icloudUsername: "",
	icloudAppPassword: "",
	syncIntervalMinutes: 15,
	defaultCalendarId: "",
	calendars: [],
	syncRecords: [],
};

export class CalendarSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Calendar folder")
			.setDesc("데일리 노트가 저장되는 폴더. 비우면 vault 루트.")
			.addText((text) =>
				text
					.setPlaceholder("e.g. Daily Notes")
					.setValue(this.plugin.settings.calendarFolder)
					.onChange(async (value) => {
						this.plugin.settings.calendarFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "iCloud 동기화" });

		const warn = containerEl.createEl("p", {
			text: "⚠️ Apple ID와 앱 전용 비밀번호는 data.json에 평문 저장됩니다. vault를 외부에 공유한다면 주의하세요. 앱 전용 비밀번호는 appleid.apple.com에서 발급하세요.",
		});
		warn.style.color = "var(--text-warning)";

		new Setting(containerEl)
			.setName("Apple ID")
			.addText((text) =>
				text
					.setPlaceholder("you@icloud.com")
					.setValue(this.plugin.settings.icloudUsername)
					.onChange(async (value) => {
						this.plugin.settings.icloudUsername = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("앱 전용 비밀번호")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("xxxx-xxxx-xxxx-xxxx")
					.setValue(this.plugin.settings.icloudAppPassword)
					.onChange(async (value) => {
						this.plugin.settings.icloudAppPassword = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("자동 동기화 간격(분)")
			.setDesc("0이면 자동 동기화를 끕니다.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						const n = Number(value);
						this.plugin.settings.syncIntervalMinutes = Number.isFinite(n) ? n : 0;
						await this.plugin.saveSettings();
						this.plugin.restartSyncTimer();
					}),
			);

		new Setting(containerEl)
			.setName("캘린더 연결")
			.setDesc("iCloud에서 캘린더 목록을 가져옵니다.")
			.addButton((btn) =>
				btn.setButtonText("캘린더 불러오기").onClick(async () => {
					try {
						const cals = await this.plugin.discoverCalendars();
						new Notice(`${cals.length}개 캘린더를 찾았습니다.`);
						this.display();
					} catch (e) {
						new Notice(`실패: ${(e as Error).message}`);
					}
				}),
			);

		if (this.plugin.settings.calendars.length) {
			new Setting(containerEl)
				.setName("새 일정 기본 캘린더")
				.addDropdown((dd) => {
					for (const c of this.plugin.settings.calendars) dd.addOption(c.id, c.name);
					dd.setValue(this.plugin.settings.defaultCalendarId || this.plugin.settings.calendars[0].id);
					dd.onChange(async (value) => {
						this.plugin.settings.defaultCalendarId = value;
						await this.plugin.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName("지금 동기화")
			.addButton((btn) =>
				btn.setButtonText("동기화 실행").setCta().onClick(() => this.plugin.runSync()),
			);
	}
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter daily-calendar exec tsc -noEmit -skipLibCheck`
Expected: `main.ts`가 아직 새 메서드(`discoverCalendars`/`runSync`/`restartSyncTimer`)를 안 가져 에러가 날 수 있다. Task 12에서 해소. 우선 settings.ts 자체 문법 에러가 없는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add plugins/daily-calendar/src/settings.ts plugins/daily-calendar/src/types.ts
git commit -m "feat(daily-calendar): iCloud 설정 UI"
```

---

## Task 11: 일정 추가/수정 모달

제목·설명·시간(시작/종료 또는 종일)·캘린더 select를 받는 모달. UI라 단위 테스트 없음.

**Files:**
- Create: `plugins/daily-calendar/src/ui/event-modal.ts`

- [ ] **Step 1: event-modal.ts 작성**

```ts
import { App, Modal, Setting } from "obsidian";
import type { CalendarRef } from "../types";

export interface EventModalResult {
	title: string;
	description: string;
	allDay: boolean;
	startMinutes: number | null;
	endMinutes: number | null;
	calendarId: string;
}

function parseHHMM(value: string): number | null {
	const m = value.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/** 새 일정 입력 모달. 확정 시 onSubmit 호출. */
export class EventModal extends Modal {
	private result: EventModalResult;

	constructor(
		app: App,
		private calendars: CalendarRef[],
		private defaultCalendarId: string,
		private onSubmit: (r: EventModalResult) => void,
	) {
		super(app);
		this.result = {
			title: "",
			description: "",
			allDay: false,
			startMinutes: 540,
			endMinutes: 600,
			calendarId: defaultCalendarId || calendars[0]?.id || "",
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "새 일정" });

		new Setting(contentEl).setName("제목").addText((t) =>
			t.onChange((v) => (this.result.title = v)),
		);

		new Setting(contentEl).setName("설명").addTextArea((t) =>
			t.onChange((v) => (this.result.description = v)),
		);

		let startSetting: Setting;
		let endSetting: Setting;

		new Setting(contentEl).setName("종일").addToggle((t) =>
			t.setValue(false).onChange((v) => {
				this.result.allDay = v;
				startSetting.settingEl.toggle(!v);
				endSetting.settingEl.toggle(!v);
			}),
		);

		startSetting = new Setting(contentEl).setName("시작 (HH:MM)").addText((t) =>
			t.setValue("09:00").onChange((v) => (this.result.startMinutes = parseHHMM(v))),
		);
		endSetting = new Setting(contentEl).setName("종료 (HH:MM)").addText((t) =>
			t.setValue("10:00").onChange((v) => (this.result.endMinutes = parseHHMM(v))),
		);

		new Setting(contentEl).setName("캘린더").addDropdown((dd) => {
			for (const c of this.calendars) dd.addOption(c.id, c.name);
			dd.setValue(this.result.calendarId);
			dd.onChange((v) => (this.result.calendarId = v));
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("추가")
				.setCta()
				.onClick(() => {
					if (!this.result.title.trim()) return;
					if (this.result.allDay) {
						this.result.startMinutes = null;
						this.result.endMinutes = null;
					}
					this.onSubmit(this.result);
					this.close();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter daily-calendar exec tsc -noEmit -skipLibCheck`
Expected: event-modal 관련 문법 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add plugins/daily-calendar/src/ui/event-modal.ts
git commit -m "feat(daily-calendar): 일정 추가 모달"
```

---

## Task 12: main.ts 와이어링 + calendar-view 연동

플러그인 전체를 조립한다: 설정 로드/저장 확장, sync-engine/clients 생성, 캘린더 발견 명령, 주기 타이머, 수동 sync 명령/리본, 캘린더 셀에서 "새 일정" 모달 열기.

**Files:**
- Modify: `plugins/daily-calendar/src/main.ts`
- Modify: `plugins/daily-calendar/src/calendar-view.ts`

- [ ] **Step 1: main.ts 교체**

```ts
import { Notice, Plugin, requestUrl } from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./calendar-view";
import {
	CalendarSettingTab,
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from "./settings";
import type { CalendarRef } from "./types";
import { CalDavClient, type HttpResponse } from "./ical/caldav-client";
import { EventStore } from "./sync/event-store";
import { SyncEngine } from "./sync/sync-engine";

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;
	private store!: EventStore;
	private syncTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		this.store = EventStore.fromJSON(this.settings.syncRecords);

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this),
		);

		const ribbonIconEl = this.addRibbonIcon("calendar-days", "Calendar Reborn", () => {
			this.activateView();
		});
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		this.addCommand({
			id: "icloud-sync-now",
			name: "iCloud 동기화 실행",
			callback: () => this.runSync(),
		});

		this.addSettingTab(new CalendarSettingTab(this.app, this));
		this.restartSyncTimer();
	}

	onunload() {
		if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
	}

	async activateView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
		if (existing.length > 0) {
			existing.slice(1).forEach((leaf) => leaf.detach());
			workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
		workspace.revealLeaf(leaf);
	}

	private caldavDeps() {
		return {
			requestUrl: async (opts: {
				url: string;
				method: string;
				headers: Record<string, string>;
				body?: string;
			}): Promise<HttpResponse> => {
				const res = await requestUrl({
					url: opts.url,
					method: opts.method,
					headers: opts.headers,
					body: opts.body,
					throw: false,
				});
				return { status: res.status, headers: res.headers, text: res.text };
			},
			parseXml: (xml: string) =>
				new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument,
		};
	}

	private client(): CalDavClient {
		return new CalDavClient(
			{
				username: this.settings.icloudUsername,
				appPassword: this.settings.icloudAppPassword,
			},
			this.caldavDeps(),
		);
	}

	syncEngine(): SyncEngine {
		return new SyncEngine(
			this.app.vault,
			this.client(),
			this.store,
			{
				folder: this.settings.calendarFolder,
				calendars: this.settings.calendars,
				defaultCalendarId:
					this.settings.defaultCalendarId || this.settings.calendars[0]?.id || "",
			},
			() => this.persistSyncState(),
		);
	}

	async discoverCalendars(): Promise<CalendarRef[]> {
		const cals = await this.client().discoverCalendars();
		// 기존 syncToken 보존 병합.
		const prev = new Map(this.settings.calendars.map((c) => [c.id, c]));
		this.settings.calendars = cals.map((c) => ({ ...c, syncToken: prev.get(c.id)?.syncToken }));
		if (!this.settings.defaultCalendarId && cals[0]) {
			this.settings.defaultCalendarId = cals[0].id;
		}
		await this.saveSettings();
		return this.settings.calendars;
	}

	async runSync(): Promise<void> {
		if (!this.settings.icloudUsername || !this.settings.icloudAppPassword) {
			new Notice("먼저 설정에서 Apple ID와 앱 전용 비밀번호를 입력하세요.");
			return;
		}
		if (!this.settings.calendars.length) {
			new Notice("먼저 설정에서 캘린더를 불러오세요.");
			return;
		}
		await this.syncEngine().syncAll();
		await this.persistSyncState();
		this.refreshCalendarViews();
	}

	restartSyncTimer() {
		if (this.syncTimer !== null) {
			window.clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		const minutes = this.settings.syncIntervalMinutes;
		if (minutes > 0) {
			this.syncTimer = window.setInterval(
				() => void this.runSync(),
				minutes * 60 * 1000,
			);
			this.registerInterval(this.syncTimer);
		}
	}

	private refreshCalendarViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
			const view = leaf.view;
			if (view instanceof CalendarView) view.forceRender();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** event-store 상태를 settings에 반영 후 저장. */
	async persistSyncState() {
		this.settings.syncRecords = this.store.toJSON();
		await this.saveData(this.settings);
	}
}
```

- [ ] **Step 2: calendar-view.ts에 모달 연동 추가**

`calendar-view.ts` 상단 import에 모달을 추가:

```ts
import { EventModal } from "./ui/event-modal";
```

`forceRender` 공개 메서드를 클래스에 추가(주기 sync 후 재렌더용). `onClose` 아래에 추가:

```ts
	/** 외부(플러그인)에서 강제로 다시 그릴 때 사용. */
	forceRender() {
		this.render();
	}
```

`createDayCell`의 셀 클릭 핸들러를, 기존 "노트 열기"는 유지하되 **새 일정 추가 버튼**을 셀에 추가한다. `eventList` 생성 직후에 다음을 삽입:

```ts
		// 셀 우상단 "+" 버튼: 해당 날짜에 새 일정 모달 열기.
		const addBtn = cell.createEl("button", {
			cls: "calendar-reborn-add-btn",
			text: "+",
			attr: { "aria-label": "새 일정" },
		});
		addBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openEventModal(cellDate);
		});
```

클래스에 메서드 추가:

```ts
	private openEventModal(date: Date) {
		const settings = this.plugin.settings;
		if (!settings.calendars.length) {
			new Notice("설정에서 캘린더를 먼저 불러오세요.");
			return;
		}
		new EventModal(
			this.app,
			settings.calendars,
			settings.defaultCalendarId,
			async (r) => {
				await this.plugin.syncEngine().createEvent({
					day: date,
					title: r.title,
					description: r.description,
					startMinutes: r.startMinutes,
					endMinutes: r.endMinutes,
					allDay: r.allDay,
					calendarId: r.calendarId,
				});
				await this.plugin.persistSyncState();
				this.render();
			},
		).open();
	}
```

`calendar-view.ts` import에 `Notice` 추가(기존 obsidian import 묶음에):

```ts
import {
	ItemView,
	MarkdownView,
	Notice,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	debounce,
	normalizePath,
	setIcon,
} from "obsidian";
```

- [ ] **Step 3: "+" 버튼 스타일 추가**

`plugins/daily-calendar/styles.css` 끝에 추가:

```css
.calendar-reborn-day-cell {
	position: relative;
}
.calendar-reborn-add-btn {
	position: absolute;
	top: 2px;
	right: 2px;
	opacity: 0;
	border: none;
	background: var(--interactive-accent);
	color: var(--text-on-accent);
	border-radius: 4px;
	width: 18px;
	height: 18px;
	line-height: 1;
	cursor: pointer;
}
.calendar-reborn-day-cell:hover .calendar-reborn-add-btn {
	opacity: 1;
}
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `pnpm --filter daily-calendar exec tsc -noEmit -skipLibCheck`
Expected: 에러 없음.

Run: `pnpm --filter daily-calendar build`
Expected: 빌드 성공, `dist/main.js` 생성.

- [ ] **Step 5: 전체 테스트**

Run: `pnpm --filter daily-calendar test`
Expected: 모든 단위 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
git add plugins/daily-calendar/src/main.ts plugins/daily-calendar/src/calendar-view.ts plugins/daily-calendar/styles.css
git commit -m "feat(daily-calendar): main 와이어링 + 모달/주기 동기화 연동"
```

---

## Task 13: 수동 통합 검증 (네트워크)

실제 iCloud 계정으로 끝단까지 확인한다. 자동화 불가 — 사람이 수행.

- [ ] **Step 1: 플러그인 배포**

Run (루트): `pnpm build:deploy` (또는 `dist/`를 테스트 vault의 `.obsidian/plugins/daily-calendar/`로 복사)
Expected: Obsidian에서 플러그인 로드됨.

- [ ] **Step 2: 자격증명 입력 + 캘린더 불러오기**

설정에서 Apple ID + 앱 전용 비밀번호 입력 → "캘린더 불러오기" → 캘린더 목록(가족/개인/업무 등)이 나타나는지 확인.

- [ ] **Step 3: 모달로 일정 생성 → iCloud 반영 확인**

캘린더 셀의 "+"로 일정 추가(캘린더 선택 포함) → 데일리 노트에 `^ic-xxx` 형식으로 기록되는지, iCloud(아이폰/iCloud.com)에 해당 일정이 나타나는지 확인.

- [ ] **Step 4: iCloud → 마크다운 (pull) 확인**

iCloud에서 일정 하나 수정/추가 → "iCloud 동기화 실행" → 데일리 노트가 갱신되는지 확인.

- [ ] **Step 5: 충돌(LWW) 확인**

같은 일정을 마크다운/iCloud 양쪽에서 수정 → sync 후 더 최근 수정본이 남는지 확인.

- [ ] **Step 6: 삭제 전파 확인**

마크다운에서 일정 줄 삭제 → sync → iCloud에서도 삭제. 반대로 iCloud 삭제 → sync → 마크다운에서 제거.

- [ ] **Step 7: 결과 기록**

문제 발견 시 이슈로 정리하고 해당 Task로 돌아가 수정.

---

## Self-Review (작성자 점검 결과)

- **스펙 커버리지:** 데이터모델(마크다운 SoT, 양방향)=Task2/3/9, 형식(블록ID+하위불릿)=Task2/3, 일정+할일 VEVENT=형식상 동일 처리(할일 완료 미반영은 비목표), 시점(자동주기+수동)=Task10/12, 충돌 LWW=Task6, 다중 캘린더 읽기+선택 push=Task8/9/11, 종일 지원=Task2/3/4, 보안 경고=Task10, 에러처리=Task9 try/catch+Notice, 테스트=각 순수 모듈. 반복/멀티데이 읽기전용은 v1에서 별도 표시 로직을 강제하지 않고 일반 이벤트로 pull(편집 시 단일 인스턴스로 처리됨) — v1 범위 내 한계로 문서화.
- **플레이스홀더:** 없음(모든 코드/명령 구체화).
- **타입 일관성:** `CalEvent`/`NoteEvent`/`SyncRecord`/`CalendarRef`가 Task1 정의와 이후 사용처에서 일치. `snapshotOf`/`reconcile`/`SyncAction` 시그니처 일치.

## 알려진 한계 (v1)

- 반복(RRULE) 일정의 양방향 편집은 미지원(스펙 비목표). pull 시 마스터 이벤트가 단일 일정으로 들어올 수 있음 — v2에서 occurrence 펼침/읽기전용 처리.
- 멀티데이 일정은 시작일 노트에만 기록(걸친 모든 날 표시는 v2).
- `requestUrl`의 `headers` 키 대소문자는 플랫폼에 따라 다를 수 있어 `etag`/`ETag` 모두 확인.
