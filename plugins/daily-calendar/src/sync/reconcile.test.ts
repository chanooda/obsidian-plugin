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
