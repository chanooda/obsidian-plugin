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
