import { describe, it, expect } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import {
	buildCalendarQuery,
	buildSyncCollection,
	parseCalendarList,
	parseEventReport,
} from "./caldav-xml";

const parse = (xml: string) =>
	new DOMParser().parseFromString(xml, "text/xml") as unknown as XMLDocument;

describe("XML 빌더", () => {
	it("calendar-query에 시간 범위가 들어간다", () => {
		const xml = buildCalendarQuery("20260601T000000Z", "20260701T000000Z");
		expect(xml).toContain("calendar-query");
		expect(xml).toContain("20260601T000000Z");
	});

	it("sync-collection에 sync-token이 들어간다", () => {
		expect(buildSyncCollection("tok-1")).toContain("<d:sync-token>tok-1</d:sync-token>");
		expect(buildSyncCollection(undefined)).toContain("<d:sync-token></d:sync-token>");
	});
});

describe("응답 파서", () => {
	it("캘린더 목록에서 href/이름/색을 뽑는다", () => {
		const xml = `<?xml version="1.0"?>
		<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
		  <d:response>
		    <d:href>/123/calendars/work/</d:href>
		    <d:propstat><d:prop>
		      <d:displayname>업무</d:displayname>
		      <ic:calendar-color>#FF0000</ic:calendar-color>
		      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
		    </d:prop></d:propstat>
		  </d:response>
		  <d:response>
		    <d:href>/123/calendars/inbox/</d:href>
		    <d:propstat><d:prop>
		      <d:displayname>Inbox</d:displayname>
		      <d:resourcetype><d:collection/></d:resourcetype>
		    </d:prop></d:propstat>
		  </d:response>
		</d:multistatus>`;
		const cals = parseCalendarList(parse(xml));
		expect(cals).toHaveLength(1); // calendar resourcetype 인 것만
		expect(cals[0]).toMatchObject({ id: "/123/calendars/work/", name: "업무", color: "#FF0000" });
	});

	it("이벤트 리포트에서 href/etag/calendar-data를 뽑는다", () => {
		const xml = `<?xml version="1.0"?>
		<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
		  <d:response>
		    <d:href>/123/calendars/work/evt1.ics</d:href>
		    <d:propstat><d:prop>
		      <d:getetag>"etag-1"</d:getetag>
		      <c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data>
		    </d:prop></d:propstat>
		  </d:response>
		</d:multistatus>`;
		const items = parseEventReport(parse(xml));
		expect(items[0]).toMatchObject({
			href: "/123/calendars/work/evt1.ics",
			etag: '"etag-1"',
		});
		expect(items[0].calendarData).toContain("VCALENDAR");
	});
});
