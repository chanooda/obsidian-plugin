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
