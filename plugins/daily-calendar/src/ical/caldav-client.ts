import type { CalendarRef } from "../types";
import {
	buildCalendarPropfind,
	buildCalendarQuery,
	buildSyncCollection,
	parseCalendarList,
	parseEventReport,
	parseSyncToken,
	type ReportItem,
} from "./caldav-xml";

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

export interface CalDavDeps {
	/** Obsidian requestUrl 호환 시그니처. */
	requestUrl: (opts: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: string;
	}) => Promise<HttpResponse>;
	parseXml: (xml: string) => XMLDocument;
}

export interface Credentials {
	username: string;
	appPassword: string;
}

const BASE = "https://caldav.icloud.com";

export class CalDavClient {
	constructor(
		private creds: Credentials,
		private deps: CalDavDeps,
	) {}

	private authHeader(): string {
		const raw = `${this.creds.username}:${this.creds.appPassword}`;
		// Electron/Node 모두 Buffer 사용 가능(번들 대상이 Electron).
		const b64 =
			typeof btoa === "function"
				? btoa(raw)
				: Buffer.from(raw, "utf-8").toString("base64");
		return `Basic ${b64}`;
	}

	private async request(
		url: string,
		method: string,
		extraHeaders: Record<string, string> = {},
		body?: string,
	): Promise<HttpResponse> {
		const fullUrl = url.startsWith("http") ? url : `${BASE}${url}`;
		const res = await this.deps.requestUrl({
			url: fullUrl,
			method,
			headers: {
				Authorization: this.authHeader(),
				"Content-Type": "application/xml; charset=utf-8",
				...extraHeaders,
			},
			body,
		});
		if (res.status >= 400) {
			throw new Error(`CalDAV ${method} ${url} 실패: ${res.status}`);
		}
		return res;
	}

	/** current-user-principal → calendar-home → 캘린더 목록. */
	async discoverCalendars(): Promise<CalendarRef[]> {
		const principalBody = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
		const principalRes = await this.request("/", "PROPFIND", { Depth: "0" }, principalBody);
		const principalHref = firstHref(
			this.deps.parseXml(principalRes.text),
			"current-user-principal",
		);

		const homeBody = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
		const homeRes = await this.request(principalHref, "PROPFIND", { Depth: "0" }, homeBody);
		const homeHref = firstHref(this.deps.parseXml(homeRes.text), "calendar-home-set");

		const listRes = await this.request(
			homeHref,
			"PROPFIND",
			{ Depth: "1" },
			buildCalendarPropfind(),
		);
		const doc = this.deps.parseXml(listRes.text);
		const cals = parseCalendarList(doc);
		return cals;
	}

	/** sync-collection으로 증분(또는 전체) 이벤트와 새 sync-token을 받는다. */
	async fetchEvents(
		calendar: CalendarRef,
	): Promise<{ items: ReportItem[]; syncToken: string | undefined }> {
		try {
			const res = await this.request(
				calendar.id,
				"REPORT",
				{ Depth: "1" },
				buildSyncCollection(calendar.syncToken),
			);
			const doc = this.deps.parseXml(res.text);
			return { items: parseEventReport(doc), syncToken: parseSyncToken(doc) };
		} catch (_e) {
			// iCloud가 sync-collection을 거부하는 경우 calendar-query로 전체 조회.
			const res = await this.request(
				calendar.id,
				"REPORT",
				{ Depth: "1" },
				buildCalendarQuery(),
			);
			const doc = this.deps.parseXml(res.text);
			return { items: parseEventReport(doc), syncToken: undefined };
		}
	}

	/** ICS를 PUT으로 생성/갱신. ifMatch가 있으면 조건부. 새 etag 반환. */
	async putEvent(
		href: string,
		ics: string,
		ifMatch?: string,
	): Promise<{ etag: string }> {
		const headers: Record<string, string> = {
			"Content-Type": "text/calendar; charset=utf-8",
		};
		if (ifMatch) headers["If-Match"] = ifMatch;
		const res = await this.request(href, "PUT", headers, ics);
		return { etag: res.headers["etag"] ?? res.headers["ETag"] ?? "" };
	}

	async deleteEvent(href: string, ifMatch?: string): Promise<void> {
		const headers: Record<string, string> = {};
		if (ifMatch) headers["If-Match"] = ifMatch;
		await this.request(href, "DELETE", headers);
	}
}

/** multistatus에서 특정 prop 아래의 첫 href를 찾는다. */
function firstHref(doc: XMLDocument, propName: string): string {
	const all = doc.getElementsByTagName("*");
	for (let i = 0; i < all.length; i++) {
		if (all[i].localName === propName) {
			const hrefs = (all[i] as Element).getElementsByTagName("*");
			for (let j = 0; j < hrefs.length; j++) {
				if (hrefs[j].localName === "href") {
					return hrefs[j].textContent?.trim() ?? "";
				}
			}
		}
	}
	throw new Error(`${propName}에서 href를 찾지 못했습니다`);
}
