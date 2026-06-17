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
