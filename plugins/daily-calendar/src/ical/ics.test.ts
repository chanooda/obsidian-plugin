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
