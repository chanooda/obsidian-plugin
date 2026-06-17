import { Notice, TFile, type Vault } from "obsidian";
import type { CalEvent, CalendarRef, NoteEvent, SyncRecord } from "../types";
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

/** ISO yyyy-mm-dd 로컬 날짜 문자열. */
function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

let idCounter = 0;
function genLocalId(): string {
	idCounter += 1;
	return `ic-${Date.now().toString(36)}${idCounter.toString(36)}`;
}
function genUid(): string {
	return `${Date.now().toString(36)}-${Math.floor(idCounter++).toString(36)}@daily-calendar`;
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
	private hrefFor(record: SyncRecord): string {
		return `${record.calendarId}${encodeURIComponent(record.uid)}.ics`;
	}

	/** 전체 양방향 동기화 1회 실행. */
	async syncAll(): Promise<void> {
		try {
			// 1) 원격 수집.
			const remote: CalEvent[] = [];
			for (const cal of this.config.calendars) {
				const { items, syncToken } = await this.client.fetchEvents(cal);
				cal.syncToken = syncToken;
				for (const it of items) {
					if (it.deleted || !it.calendarData) continue;
					const ev = parseVEvent(it.calendarData, cal.id);
					if (ev) remote.push(ev);
				}
			}

			// 2) 로컬 수집(모든 데일리 노트).
			const { local, hints, mtime } = await this.collectLocal();

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
				else if (action.type === "pull") await this.doPull(action.event);
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

	private async collectLocal(): Promise<{
		local: CalEvent[];
		hints: Map<string, { newLocalId: string; notePath: string }>;
		mtime: Date;
	}> {
		const local: CalEvent[] = [];
		const hints = new Map<string, { newLocalId: string; notePath: string }>();
		let mtime = new Date(0);
		const folder = this.config.folder.trim();
		const files = this.vault.getMarkdownFiles().filter((f) =>
			folder ? f.path.startsWith(`${folder}/`) : true,
		);
		for (const file of files) {
			const day = file.basename; // YYYY-MM-DD
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
			if (file.stat.mtime > mtime.getTime()) mtime = new Date(file.stat.mtime);
			const content = await this.vault.cachedRead(file);
			const dayDate = new Date(`${day}T00:00:00`);
			for (const ne of parseNoteEvents(content)) {
				const rec = ne.localId ? this.store.byLocalId(ne.localId) : undefined;
				const uid = rec?.uid ?? genUid();
				const calId = this.calIdByName(ne.calendarName);
				local.push(noteEventToCalEvent(ne, dayDate, uid, calId));
				if (!ne.localId) {
					hints.set(uid, { newLocalId: genLocalId(), notePath: file.path });
				}
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
		const href = `${event.calendarId}${encodeURIComponent(event.uid)}.ics`;
		const { etag } = await this.client.putEvent(href, ics, existing?.etag);

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
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doPull(event: CalEvent): Promise<void> {
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
			etag: existing?.etag ?? "",
			notePath,
			snapshot: snapshotOf(event),
		});
	}

	private async doDeleteRemote(uid: string): Promise<void> {
		const rec = this.store.byUid(uid);
		if (!rec) return;
		await this.client.deleteEvent(this.hrefFor(rec), rec.etag);
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
