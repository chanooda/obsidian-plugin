/** 연결된 iCloud 캘린더 한 개. */
export interface CalendarRef {
	/** CalDAV 컬렉션 URL의 경로 부분(고유 식별자). 예: "/123/calendars/work/" */
	id: string;
	/** 사람이 보는 이름. 예: "개인", "업무" */
	name: string;
	/** CalDAV calendar-color (#RRGGBB). 없으면 undefined. */
	color?: string;
	/** 이 컬렉션의 현재 sync-token(증분 pull용). 없으면 undefined. */
	syncToken?: string;
}

/** 동기화의 단위가 되는 정규화된 일정. uid가 동일성의 기준이다. */
export interface CalEvent {
	/** iCloud VEVENT UID. 신규 로컬 생성 시에도 생성해 부여한다. */
	uid: string;
	title: string;
	/** 설명. 없으면 "". */
	description: string;
	/** 시작 시각. 종일이면 해당 날짜 00:00(로컬). */
	start: Date;
	/** 종료 시각. 명시 종료가 없으면 null. */
	end: Date | null;
	allDay: boolean;
	/** 이 일정이 속한 CalendarRef.id. */
	calendarId: string;
	/** iCloud LAST-MODIFIED. LWW 비교에 쓴다. 모르면 null. */
	lastModified: Date | null;
}

/** 데일리 노트 한 줄(+하위 설명 불릿)에서 파싱한 일정 표현. */
export interface NoteEvent {
	/** 블록 ID에서 캐럿을 뺀 값. 예: "ic-a1b2c3". 신규(블록ID 없음)면 null. */
	localId: string | null;
	title: string;
	description: string;
	/** 시작 분(자정 기준). 종일이면 null. */
	startMinutes: number | null;
	/** 종료 분(자정 기준). 없으면 null. */
	endMinutes: number | null;
	allDay: boolean;
	/** [대괄호] 안 캘린더 이름. 없으면 "". */
	calendarName: string;
	/** 노트 본문에서 이 일정이 차지하는 줄 범위 [시작, 끝) (0-based). */
	startLine: number;
	endLine: number;
}

/** event-store에 보관하는 일정별 동기화 메타. */
export interface SyncRecord {
	uid: string;
	localId: string;
	calendarId: string;
	/** iCloud ETag(변경 감지). */
	etag: string;
	/** 이 일정이 기록된 데일리 노트 경로. */
	notePath: string;
	/** 마지막 동기화 시점의 일정 스냅샷(3-way 비교 기준). */
	snapshot: CalEventSnapshot;
}

/** 직렬화 가능한 스냅샷(Date는 ISO 문자열로 저장). */
export interface CalEventSnapshot {
	title: string;
	description: string;
	startISO: string;
	endISO: string | null;
	allDay: boolean;
	calendarId: string;
}
