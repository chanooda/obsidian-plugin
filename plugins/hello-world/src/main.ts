import { Notice, Plugin } from "obsidian";
import { formatDate, greeting } from "@repo/shared";

export default class HelloWorldPlugin extends Plugin {
	async onload() {
		this.addRibbonIcon("smile", "Hello World", () => {
			new Notice(greeting("chanooda"));
		});

		this.addCommand({
			id: "say-hello",
			name: "Say hello",
			callback: () => {
				new Notice(`${greeting("World")} Today is ${formatDate(new Date())}.`);
			},
		});
	}

	onunload() {}
}
