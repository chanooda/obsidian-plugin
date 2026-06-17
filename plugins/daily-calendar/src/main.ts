import { Notice, Plugin, TFile, requestUrl } from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./calendar-view";
import {
	CalendarSettingTab,
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from "./settings";
import type { CalendarRef } from "./types";
import { CalDavClient, type HttpResponse } from "./ical/caldav-client";
import { dailyNotePath, flatDailyNoteKey } from "./daily-note-path";
import { ensureParentFolders } from "./vault-utils";
import { EventStore } from "./sync/event-store";
import { SyncEngine } from "./sync/sync-engine";

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;
	private store!: EventStore;
	private syncTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		this.store = EventStore.fromJSON(this.settings.syncRecords);

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this),
		);

		const ribbonIconEl = this.addRibbonIcon("calendar-days", "Calendar Reborn", () => {
			this.activateView();
		});
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		this.addCommand({
			id: "icloud-sync-now",
			name: "iCloud 동기화 실행",
			callback: () => this.runSync(),
		});

		this.addSettingTab(new CalendarSettingTab(this.app, this));
		this.restartSyncTimer();

		// 레이아웃이 준비되면 평평한 데일리 노트를 연/월 폴더 구조로 이동.
		this.app.workspace.onLayoutReady(() => {
			void this.migrateFolderStructure();
		});
	}

	/**
	 * 설정 폴더 바로 아래 평평하게 놓인 데일리 노트(YYYY-MM-DD.md)를
	 * 연/월 폴더(`YYYY/YYYY-MM/`)로 이동한다. 멱등적이라 매번 안전하게 호출 가능.
	 */
	async migrateFolderStructure(): Promise<void> {
		const folder = this.settings.calendarFolder;
		const moves: { file: TFile; from: string; to: string }[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const dayKey = flatDailyNoteKey(folder, file.path);
			if (!dayKey) continue;
			const to = dailyNotePath(folder, dayKey);
			if (to !== file.path) moves.push({ file, from: file.path, to });
		}
		if (!moves.length) return;

		for (const mv of moves) {
			try {
				await ensureParentFolders(this.app.vault, mv.to);
				await this.app.fileManager.renameFile(mv.file, mv.to);
			} catch (e) {
				console.error(`노트 이동 실패: ${mv.from} → ${mv.to}`, e);
			}
		}

		// 이동된 경로를 동기화 레코드에 반영.
		const fromTo = new Map(moves.map((m) => [m.from, m.to]));
		for (const rec of this.store.all()) {
			const to = fromTo.get(rec.notePath);
			if (to) this.store.put({ ...rec, notePath: to });
		}
		await this.persistSyncState();
		this.refreshCalendarViews();
		new Notice(`데일리 노트 ${moves.length}개를 연/월 폴더로 정리했습니다.`);
	}

	onunload() {
		if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
	}

	async activateView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
		if (existing.length > 0) {
			existing.slice(1).forEach((leaf) => leaf.detach());
			workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
		workspace.revealLeaf(leaf);
	}

	private caldavDeps() {
		return {
			requestUrl: async (opts: {
				url: string;
				method: string;
				headers: Record<string, string>;
				body?: string;
			}): Promise<HttpResponse> => {
				const res = await requestUrl({
					url: opts.url,
					method: opts.method,
					headers: opts.headers,
					body: opts.body,
					throw: false,
				});
				return { status: res.status, headers: res.headers, text: res.text };
			},
			parseXml: (xml: string) =>
				new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument,
		};
	}

	private client(): CalDavClient {
		return new CalDavClient(
			{
				username: this.settings.icloudUsername,
				appPassword: this.settings.icloudAppPassword,
			},
			this.caldavDeps(),
		);
	}

	syncEngine(): SyncEngine {
		return new SyncEngine(
			this.app.vault,
			this.client(),
			this.store,
			{
				folder: this.settings.calendarFolder,
				calendars: this.settings.calendars,
				defaultCalendarId:
					this.settings.defaultCalendarId || this.settings.calendars[0]?.id || "",
			},
			() => this.persistSyncState(),
		);
	}

	async discoverCalendars(): Promise<CalendarRef[]> {
		const cals = await this.client().discoverCalendars();
		// 기존 syncToken 보존 병합.
		const prev = new Map(this.settings.calendars.map((c) => [c.id, c]));
		this.settings.calendars = cals.map((c) => ({ ...c, syncToken: prev.get(c.id)?.syncToken }));
		if (!this.settings.defaultCalendarId && cals[0]) {
			this.settings.defaultCalendarId = cals[0].id;
		}
		await this.saveSettings();
		return this.settings.calendars;
	}

	async runSync(): Promise<void> {
		if (!this.settings.icloudUsername || !this.settings.icloudAppPassword) {
			new Notice("먼저 설정에서 Apple ID와 앱 전용 비밀번호를 입력하세요.");
			return;
		}
		if (!this.settings.calendars.length) {
			new Notice("먼저 설정에서 캘린더를 불러오세요.");
			return;
		}
		await this.syncEngine().syncAll();
		await this.persistSyncState();
		this.refreshCalendarViews();
	}

	restartSyncTimer() {
		if (this.syncTimer !== null) {
			window.clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		const minutes = this.settings.syncIntervalMinutes;
		if (minutes > 0) {
			this.syncTimer = window.setInterval(
				() => void this.runSync(),
				minutes * 60 * 1000,
			);
			this.registerInterval(this.syncTimer);
		}
	}

	private refreshCalendarViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
			const view = leaf.view;
			if (view instanceof CalendarView) view.forceRender();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** event-store 상태를 settings에 반영 후 저장. */
	async persistSyncState() {
		this.settings.syncRecords = this.store.toJSON();
		await this.saveData(this.settings);
	}
}
