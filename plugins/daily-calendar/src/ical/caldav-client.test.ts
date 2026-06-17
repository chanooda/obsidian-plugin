import { describe, it, expect, vi } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { CalDavClient, type HttpResponse } from "./caldav-client";

const deps = (responder: (url: string, opts: any) => HttpResponse) => ({
	requestUrl: vi.fn(async (opts: any) => responder(opts.url, opts)),
	parseXml: (xml: string) =>
		new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument,
});

describe("CalDavClient", () => {
	it("PUT은 Authorization 헤더와 ICS 본문을 보낸다", async () => {
		const d = deps(() => ({ status: 201, headers: { etag: '"e9"' }, text: "" }));
		const client = new CalDavClient(
			{ username: "me@icloud.com", appPassword: "abcd-efgh" },
			d,
		);
		const res = await client.putEvent("/123/calendars/work/new.ics", "BEGIN:VCALENDAR");
		expect(res.etag).toBe('"e9"');
		const call = d.requestUrl.mock.calls[0][0];
		expect(call.method).toBe("PUT");
		expect(call.headers.Authorization).toMatch(/^Basic /);
		expect(call.body).toContain("VCALENDAR");
	});

	it("deleteEvent는 DELETE를 보낸다", async () => {
		const d = deps(() => ({ status: 204, headers: {}, text: "" }));
		const client = new CalDavClient(
			{ username: "u", appPassword: "p" },
			d,
		);
		await client.deleteEvent("/123/calendars/work/x.ics");
		expect(d.requestUrl.mock.calls[0][0].method).toBe("DELETE");
	});
});
