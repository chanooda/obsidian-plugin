import type { CalendarRef } from "../types";

/** VEVENT를 조회하는 calendar-query REPORT 본문. 범위를 모두 주면 time-range로 제한. */
export function buildCalendarQuery(startUTC?: string, endUTC?: string): string {
	const range =
		startUTC && endUTC ? `<c:time-range start="${startUTC}" end="${endUTC}"/>` : "";
	return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        ${range}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

/** 증분 변경을 받는 sync-collection REPORT 본문. token 없으면 전체. */
export function buildSyncCollection(syncToken: string | undefined): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-token>${syncToken ?? ""}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:sync-collection>`;
}

/** PROPFIND(calendar-home 하위)로 캘린더 컬렉션을 찾는 본문. */
export function buildCalendarPropfind(): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <ic:calendar-color/>
    <d:sync-token/>
  </d:prop>
</d:propfind>`;
}

function local(el: Element, name: string): Element | null {
	const list = el.getElementsByTagName("*");
	for (let i = 0; i < list.length; i++) {
		const node = list[i];
		if (node.localName === name) return node as Element;
	}
	return null;
}

function text(el: Element | null): string {
	return el?.textContent?.trim() ?? "";
}

/** PROPFIND 응답에서 calendar 컬렉션만 CalendarRef로 추출. */
export function parseCalendarList(doc: XMLDocument): CalendarRef[] {
	const cals: CalendarRef[] = [];
	const responses = doc.getElementsByTagName("*");
	for (let i = 0; i < responses.length; i++) {
		const r = responses[i];
		if (r.localName !== "response") continue;
		const resourcetype = local(r as Element, "resourcetype");
		const isCalendar =
			!!resourcetype &&
			Array.from(resourcetype.getElementsByTagName("*")).some(
				(n) => (n as Element).localName === "calendar",
			);
		if (!isCalendar) continue;
		const href = text(local(r as Element, "href"));
		const name = text(local(r as Element, "displayname")) || href;
		const color = text(local(r as Element, "calendar-color")) || undefined;
		if (href) cals.push({ id: href, name, color });
	}
	return cals;
}

export interface ReportItem {
	href: string;
	etag: string;
	/** 삭제된 항목(404 status)이면 calendarData는 빈 문자열. */
	calendarData: string;
	deleted: boolean;
}

/** REPORT(multistatus) 응답에서 이벤트 항목들을 추출. */
export function parseEventReport(doc: XMLDocument): ReportItem[] {
	const items: ReportItem[] = [];
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		const r = all[i];
		if (r.localName !== "response") continue;
		const el = r as Element;
		const href = text(local(el, "href"));
		const status = text(local(el, "status"));
		const deleted = status.includes("404");
		items.push({
			href,
			etag: text(local(el, "getetag")),
			calendarData: text(local(el, "calendar-data")),
			deleted,
		});
	}
	return items;
}

/** multistatus의 최상위 sync-token 추출. */
export function parseSyncToken(doc: XMLDocument): string | undefined {
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		const n = all[i];
		if (n.localName === "sync-token" && n.parentNode && (n.parentNode as Element).localName === "multistatus") {
			return n.textContent?.trim() || undefined;
		}
	}
	return undefined;
}
