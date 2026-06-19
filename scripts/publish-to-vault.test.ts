import { describe, expect, it } from "vitest";
import { PUBLISH_WHITELIST, selectPublishFiles } from "./publish-to-vault.mjs";

describe("selectPublishFiles", () => {
	it("화이트리스트 파일만 통과시킨다", () => {
		const entries = ["main.js", "manifest.json", "styles.css", "versions.json"];
		expect(selectPublishFiles(entries)).toEqual(PUBLISH_WHITELIST);
	});

	it("data.json은 절대 배포하지 않는다", () => {
		const entries = ["main.js", "manifest.json", "data.json"];
		expect(selectPublishFiles(entries)).not.toContain("data.json");
	});

	it("알 수 없는 파일은 제외한다", () => {
		const entries = ["main.js", "secret.env", ".hotreload"];
		expect(selectPublishFiles(entries)).toEqual(["main.js"]);
	});

	it("dist에 없는 선택적 파일은 건너뛴다", () => {
		const entries = ["main.js", "manifest.json"]; // styles.css 없음
		expect(selectPublishFiles(entries)).toEqual(["main.js", "manifest.json"]);
	});
});
