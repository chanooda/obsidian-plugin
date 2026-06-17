import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
	calendarFolder: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	calendarFolder: "",
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
			.setDesc(
				"Folder where daily notes are stored. Leave empty to use the vault root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. Daily Notes")
					.setValue(this.plugin.settings.calendarFolder)
					.onChange(async (value) => {
						this.plugin.settings.calendarFolder = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
