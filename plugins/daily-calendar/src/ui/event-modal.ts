import { App, Modal, Setting } from "obsidian";
import type { CalendarRef } from "../types";

export interface EventModalResult {
	title: string;
	description: string;
	allDay: boolean;
	startMinutes: number | null;
	endMinutes: number | null;
	calendarId: string;
}

function parseHHMM(value: string): number | null {
	const m = value.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/** 새 일정 입력 모달. 확정 시 onSubmit 호출. */
export class EventModal extends Modal {
	private result: EventModalResult;

	constructor(
		app: App,
		private calendars: CalendarRef[],
		private defaultCalendarId: string,
		private onSubmit: (r: EventModalResult) => void,
	) {
		super(app);
		this.result = {
			title: "",
			description: "",
			allDay: false,
			startMinutes: 540,
			endMinutes: 600,
			calendarId: defaultCalendarId || calendars[0]?.id || "",
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "새 일정" });

		new Setting(contentEl).setName("제목").addText((t) =>
			t.onChange((v) => (this.result.title = v)),
		);

		new Setting(contentEl).setName("설명").addTextArea((t) =>
			t.onChange((v) => (this.result.description = v)),
		);

		let startSetting: Setting;
		let endSetting: Setting;

		new Setting(contentEl).setName("종일").addToggle((t) =>
			t.setValue(false).onChange((v) => {
				this.result.allDay = v;
				startSetting.settingEl.style.display = v ? "none" : "";
				endSetting.settingEl.style.display = v ? "none" : "";
			}),
		);

		startSetting = new Setting(contentEl).setName("시작 (HH:MM)").addText((t) =>
			t.setValue("09:00").onChange((v) => (this.result.startMinutes = parseHHMM(v))),
		);
		endSetting = new Setting(contentEl).setName("종료 (HH:MM)").addText((t) =>
			t.setValue("10:00").onChange((v) => (this.result.endMinutes = parseHHMM(v))),
		);

		new Setting(contentEl).setName("캘린더").addDropdown((dd) => {
			for (const c of this.calendars) dd.addOption(c.id, c.name);
			dd.setValue(this.result.calendarId);
			dd.onChange((v) => (this.result.calendarId = v));
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("추가")
				.setCta()
				.onClick(() => {
					if (!this.result.title.trim()) return;
					if (this.result.allDay) {
						this.result.startMinutes = null;
						this.result.endMinutes = null;
					}
					this.onSubmit(this.result);
					this.close();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
