import { Plugin } from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./calendar-view";
import {
	CalendarSettingTab,
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from "./settings";

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this),
		);

		// 좌측 사이드바 리본 아이콘.
		const ribbonIconEl = this.addRibbonIcon(
			"calendar-days",
			"Calendar Reborn",
			() => {
				this.activateView();
			},
		);
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		this.addSettingTab(new CalendarSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;

		// 이미 열려 있는 캘린더 탭이 있으면 재사용하여 최대 한 개만 유지합니다.
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
		if (existing.length > 0) {
			// 혹시 여러 개가 떠 있다면 첫 번째만 남기고 정리합니다.
			existing.slice(1).forEach((leaf) => leaf.detach());
			workspace.revealLeaf(existing[0]);
			return;
		}

		// 없으면 메인 영역에 새 탭으로 엽니다.
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_CALENDAR,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
