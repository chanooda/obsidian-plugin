import { Notice, TFile, type Vault } from "obsidian";
import type { CalEvent, CalendarRef, NoteEvent } from "../types";
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

/** 내용 기반 매칭 키(store 분실 시 재채택용). */
function contentKey(calendarId: string, allDay: boolean, startISO: string, title: string): string {
	return `${calendarId}|${allDay}|${startISO}|${title}`;
}

/** ISO yyyy-mm-dd 로컬 날짜 문자열. */
function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Date를 CalDAV time-range용 UTC 문자열(YYYYMMDDTHHMMSSZ)로 변환. */
function toCalDavUTC(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
		`T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
	);
}

/**
 * 동기화 시간 창을 계산한다. 너무 넓으면 과거 일정까지 노트로 쏟아지므로
 * 과거 3개월 ~ 미래 12개월로 제한한다. 로컬·원격 모두 이 창으로 필터해야
 * 창 밖 일정이 "삭제됨"으로 오인되지 않는다(데이터 손실 방지).
 */
function syncWindow(now: Date): { startDay: Date; endDay: Date } {
	const startDay = new Date(now.getFullYear(), now.getMonth() - 3, 1);
	const endDay = new Date(now.getFullYear(), now.getMonth() + 13, 0);
	return { startDay, endDay };
}

let idCounter = 0;
function randomToken(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	idCounter += 1;
	return `${Date.now().toString(36)}${idCounter.toString(36)}`;
}
function genLocalId(): string {
	return `ic-${randomToken().replace(/-/g, "").slice(0, 12)}`;
}
function genUid(): string {
	return `${randomToken()}@daily-calendar`;
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

	/** 전체 양방향 동기화 1회 실행. */
	async syncAll(): Promise<void> {
		try {
			const { startDay, endDay } = syncWindow(new Date());
			const range = {
				start: toCalDavUTC(startDay),
				end: toCalDavUTC(new Date(endDay.getTime() + 24 * 60 * 60 * 1000)),
			};

			// 1) 원격 수집(시간 창 내). 한 캘린더 실패가 전체를 막지 않게 격리.
			const remote: CalEvent[] = [];
			const remoteMeta = new Map<string, { href: string; etag: string }>();
			for (const cal of this.config.calendars) {
				try {
					const { items } = await this.client.fetchEvents(cal, range);
					for (const it of items) {
						if (it.deleted || !it.calendarData) continue;
						const ev = parseVEvent(it.calendarData, cal.id);
						if (ev) {
							remote.push(ev);
							remoteMeta.set(ev.uid, { href: it.href, etag: it.etag });
						}
					}
				} catch (e) {
					console.error(`캘린더 "${cal.name}" 조회 실패`, e);
				}
			}

			// 2) 로컬 수집(시간 창 내 데일리 노트).
			const { local, hints, mtime } = await this.collectLocal(
				remote,
				remoteMeta,
				startDay,
				endDay,
			);

			// 3) reconcile.
			const actions = reconcile({
				local,
				remote,
				records: this.store.all(),
				localMtime: mtime,
			});

			// 4) 액션 실행.
			for (const action of actions) {
				if (action.type === "push") await this.doPush(action.event, hints.get(action.event.uid));
				else if (action.type === "pull") await this.doPull(action.event, remoteMeta.get(action.event.uid));
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

	private async collectLocal(
		remote: CalEvent[],
		remoteMeta: Map<string, { href: string; etag: string }>,
		startDay: Date,
		endDay: Date,
	): Promise<{
		local: CalEvent[];
		hints: Map<string, { newLocalId: string; notePath: string }>;
		mtime: Date;
	}> {
		const local: CalEvent[] = [];
		const hints = new Map<string, { newLocalId: string; notePath: string }>();
		let mtime = new Date(0);

		// 내용 키 → 원격 이벤트(재채택 매칭용).
		const remoteByKey = new Map<string, CalEvent>();
		for (const ev of remote) {
			remoteByKey.set(
				contentKey(ev.calendarId, ev.allDay, ev.start.toISOString(), ev.title),
				ev,
			);
		}

		const folder = this.config.folder.trim();
		const files = this.vault.getMarkdownFiles().filter((f) =>
			folder ? f.path.startsWith(`${folder}/`) : true,
		);
		for (const file of files) {
			const day = file.basename; // YYYY-MM-DD
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
			const dayDate = new Date(`${day}T00:00:00`);
			// 시간 창 밖의 노트는 원격 조회 범위 밖이므로 reconcile에서 제외한다
			// (창 밖 일정이 "원격에 없음 → 삭제"로 오인되는 것을 막는다).
			if (dayDate < startDay || dayDate > endDay) continue;
			if (file.stat.mtime > mtime.getTime()) mtime = new Date(file.stat.mtime);
			const content = await this.vault.cachedRead(file);
			for (const ne of parseNoteEvents(content)) {
				const calId = this.calIdByName(ne.calendarName);
				const rec = ne.localId ? this.store.byLocalId(ne.localId) : undefined;

				if (rec) {
					// 정상: 기존 매핑 사용.
					local.push(noteEventToCalEvent(ne, dayDate, rec.uid, calId));
					continue;
				}

				// 신규 후보 이벤트(아직 uid 미정).
				const candidate = noteEventToCalEvent(ne, dayDate, "", calId);

				if (ne.localId) {
					// 블록ID는 있는데 store 기록 없음(분실/새 기기).
					// 내용으로 원격과 매칭되면 그 매핑을 재채택(중복 방지).
					const key = contentKey(calId, candidate.allDay, candidate.start.toISOString(), candidate.title);
					const matched = remoteByKey.get(key);
					if (matched) {
						const meta = remoteMeta.get(matched.uid);
						this.store.put({
							uid: matched.uid,
							localId: ne.localId,
							calendarId: matched.calendarId,
							etag: meta?.etag ?? "",
							href:
								meta?.href ??
								`${matched.calendarId}${encodeURIComponent(matched.uid)}.ics`,
							notePath: file.path,
							snapshot: snapshotOf(matched),
						});
						local.push({ ...candidate, uid: matched.uid });
						continue;
					}
					// 원격에 없으면 신규로 push하되, 기존 블록ID를 그대로 재사용(마크다운 중복 방지).
					const uid = genUid();
					hints.set(uid, { newLocalId: ne.localId, notePath: file.path });
					local.push({ ...candidate, uid });
					continue;
				}

				// 블록ID 자체가 없는 완전 신규 줄.
				const uid = genUid();
				hints.set(uid, { newLocalId: genLocalId(), notePath: file.path });
				local.push({ ...candidate, uid });
			}
		}
		return { local, hints, mtime };
	}

	private async doPush(
		event: CalEvent,
		hint?: { newLocalId: string; notePath: string },
	): Promise<void> {
		const existing = this.store.byUid(event.uid);
		const localId = existing?.localId ?? hint?.newLocalId ?? genLocalId();
		const ics = buildICS(event);
		const href =
			existing?.href ?? `${event.calendarId}${encodeURIComponent(event.uid)}.ics`;
		const { etag } = await this.client.putEvent(href, ics, existing?.etag || undefined);

		const notePath =
			existing?.notePath ?? hint?.notePath ?? this.notePath(dayKey(event.start));
		await this.writeNote(notePath, (content) =>
			upsertEvent(content, calEventToNoteEvent(event, localId, this.calName(event.calendarId))),
		);
		this.store.put({
			uid: event.uid,
			localId,
			calendarId: event.calendarId,
			etag,
			href,
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doPull(
		event: CalEvent,
		meta?: { href: string; etag: string },
	): Promise<void> {
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
			etag: meta?.etag ?? existing?.etag ?? "",
			href:
				meta?.href ??
				existing?.href ??
				`${event.calendarId}${encodeURIComponent(event.uid)}.ics`,
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doDeleteRemote(uid: string): Promise<void> {
		const rec = this.store.byUid(uid);
		if (!rec) return;
		await this.client.deleteEvent(rec.href, rec.etag || undefined);
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
		if (file instanceof TFile) {
			const content = await this.vault.read(file);
			await this.vault.modify(file, transform(content));
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
