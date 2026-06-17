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
