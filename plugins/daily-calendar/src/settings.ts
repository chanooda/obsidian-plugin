import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";
import type { CalendarRef, SyncRecord } from "./types";

export interface MyPluginSettings {
	calendarFolder: string;
	icloudUsername: string;
	icloudAppPassword: string;
	/** 자동 동기화 간격(분). 0이면 자동 끔. */
	syncIntervalMinutes: number;
	/** 새 일정 push 기본 캘린더 id. */
	defaultCalendarId: string;
	/** 발견된 캘린더 캐시. */
	calendars: CalendarRef[];
	/** 동기화 메타(event-store 직렬화). */
	syncRecords: SyncRecord[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	calendarFolder: "",
	icloudUsername: "",
	icloudAppPassword: "",
	syncIntervalMinutes: 15,
	defaultCalendarId: "",
	calendars: [],
	syncRecords: [],
};

export class CalendarSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Calendar folder")
			.setDesc("데일리 노트가 저장되는 폴더. 비우면 vault 루트.")
			.addText((text) =>
				text
					.setPlaceholder("e.g. Daily Notes")
					.setValue(this.plugin.settings.calendarFolder)
					.onChange(async (value) => {
						this.plugin.settings.calendarFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "iCloud 동기화" });

		const warn = containerEl.createEl("p", {
			text: "⚠️ Apple ID와 앱 전용 비밀번호는 data.json에 평문 저장됩니다. vault를 외부에 공유한다면 주의하세요. 앱 전용 비밀번호는 appleid.apple.com에서 발급하세요.",
		});
		warn.style.color = "var(--text-warning)";

		new Setting(containerEl)
			.setName("Apple ID")
			.addText((text) =>
				text
					.setPlaceholder("you@icloud.com")
					.setValue(this.plugin.settings.icloudUsername)
					.onChange(async (value) => {
						this.plugin.settings.icloudUsername = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("앱 전용 비밀번호")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("xxxx-xxxx-xxxx-xxxx")
					.setValue(this.plugin.settings.icloudAppPassword)
					.onChange(async (value) => {
						this.plugin.settings.icloudAppPassword = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("자동 동기화 간격(분)")
			.setDesc("0이면 자동 동기화를 끕니다.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						const n = Number(value);
						this.plugin.settings.syncIntervalMinutes = Number.isFinite(n) ? n : 0;
						await this.plugin.saveSettings();
						this.plugin.restartSyncTimer();
					}),
			);

		new Setting(containerEl)
			.setName("캘린더 연결")
			.setDesc("iCloud에서 캘린더 목록을 가져옵니다.")
			.addButton((btn) =>
				btn.setButtonText("캘린더 불러오기").onClick(async () => {
					try {
						const cals = await this.plugin.discoverCalendars();
						new Notice(`${cals.length}개 캘린더를 찾았습니다.`);
						this.display();
					} catch (e) {
						new Notice(`실패: ${(e as Error).message}`);
					}
				}),
			);

		if (this.plugin.settings.calendars.length) {
			new Setting(containerEl)
				.setName("새 일정 기본 캘린더")
				.addDropdown((dd) => {
					for (const c of this.plugin.settings.calendars) dd.addOption(c.id, c.name);
					dd.setValue(this.plugin.settings.defaultCalendarId || this.plugin.settings.calendars[0].id);
					dd.onChange(async (value) => {
						this.plugin.settings.defaultCalendarId = value;
						await this.plugin.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName("지금 동기화")
			.addButton((btn) =>
				btn.setButtonText("동기화 실행").setCta().onClick(() => this.plugin.runSync()),
			);
	}
}
