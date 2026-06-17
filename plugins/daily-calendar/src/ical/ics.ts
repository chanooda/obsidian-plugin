import ICAL from "ical.js";
import type { CalEvent } from "../types";

/** iCalendar(VCALENDAR) 문자열에서 첫 VEVENT를 CalEvent로 파싱한다. 없으면 null. */
export function parseVEvent(ics: string, calendarId: string): CalEvent | null {
	const jcal = ICAL.parse(ics);
	const comp = new ICAL.Component(jcal);
	const vevent = comp.getFirstSubcomponent("vevent");
	if (!vevent) return null;

	const event = new ICAL.Event(vevent);
	const startTime = event.startDate;
	const endTime = event.endDate;
	const allDay = startTime ? startTime.isDate : false;

	const lastModProp = vevent.getFirstPropertyValue("last-modified");
	const lastModified =
		lastModProp && typeof (lastModProp as ICAL.Time).toJSDate === "function"
			? (lastModProp as ICAL.Time).toJSDate()
			: null;

	return {
		uid: event.uid,
		title: event.summary ?? "",
		description: event.description ?? "",
		start: startTime.toJSDate(),
		end: allDay ? null : endTime ? endTime.toJSDate() : null,
		allDay,
		calendarId,
		lastModified,
	};
}

/** CalEvent를 단일 VEVENT가 든 VCALENDAR 문자열로 직렬화한다. */
export function buildICS(event: CalEvent): string {
	const vcalendar = new ICAL.Component(["vcalendar", [], []]);
	vcalendar.updatePropertyWithValue("version", "2.0");
	vcalendar.updatePropertyWithValue("prodid", "-//daily-calendar//iCloud sync//KO");

	const vevent = new ICAL.Component("vevent");
	const ev = new ICAL.Event(vevent);
	ev.uid = event.uid;
	ev.summary = event.title;
	if (event.description) ev.description = event.description;

	if (event.allDay) {
		const year = event.start.getFullYear();
		const month = String(event.start.getMonth() + 1).padStart(2, "0");
		const day = String(event.start.getDate()).padStart(2, "0");
		ev.startDate = ICAL.Time.fromDateString(`${year}-${month}-${day}`);

		if (event.end) {
			const ey = event.end.getFullYear();
			const em = String(event.end.getMonth() + 1).padStart(2, "0");
			const ed = String(event.end.getDate()).padStart(2, "0");
			ev.endDate = ICAL.Time.fromDateString(`${ey}-${em}-${ed}`);
		}
	} else {
		ev.startDate = ICAL.Time.fromJSDate(event.start, false);
		if (event.end) {
			ev.endDate = ICAL.Time.fromJSDate(event.end, false);
		}
	}

	vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
	vcalendar.addSubcomponent(vevent);
	return vcalendar.toString();
}
