import { describe, it, expect } from "vitest";
import { dailyNotePath, flatDailyNoteKey } from "./daily-note-path";

describe("dailyNotePath", () => {
	it("폴더가 있으면 연/월 폴더로 묶는다", () => {
		expect(dailyNotePath("Calendar", "2026-06-18")).toBe(
			"Calendar/2026/2026-06/2026-06-18.md",
		);
	});

	it("폴더가 비면 루트 기준 연/월 폴더", () => {
		expect(dailyNotePath("", "2026-07-01")).toBe(
			"2026/2026-07/2026-07-01.md",
		);
	});

	it("폴더 앞뒤 공백을 무시한다", () => {
		expect(dailyNotePath("  Calendar  ", "2026-12-31")).toBe(
			"Calendar/2026/2026-12/2026-12-31.md",
		);
	});
});

describe("flatDailyNoteKey", () => {
	it("폴더 바로 아래 평평한 날짜 노트면 날짜 키 반환", () => {
		expect(flatDailyNoteKey("Calendar", "Calendar/2026-06-18.md")).toBe(
			"2026-06-18",
		);
	});

	it("이미 연/월로 묶인 노트는 null", () => {
		expect(
			flatDailyNoteKey("Calendar", "Calendar/2026/2026-06/2026-06-18.md"),
		).toBeNull();
	});

	it("날짜 형식이 아니면 null", () => {
		expect(flatDailyNoteKey("Calendar", "Calendar/메모.md")).toBeNull();
	});

	it("폴더 밖 노트는 null", () => {
		expect(flatDailyNoteKey("Calendar", "Other/2026-06-18.md")).toBeNull();
	});
});
