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
