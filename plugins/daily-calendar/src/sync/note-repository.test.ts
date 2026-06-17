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
