import {
	ItemView,
	MarkdownView,
	Notice,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	debounce,
	normalizePath,
	setIcon,
} from "obsidian";
import type MyPlugin from "./main";
import { EventModal } from "./ui/event-modal";
import { dailyNotePath as buildDailyNotePath } from "./daily-note-path";
import { ensureParentFolders } from "./vault-utils";

export const VIEW_TYPE_CALENDAR = "calendar-reborn-view";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 한 셀에 표시할 일정 최대 개수(초과분은 "+N"으로 요약) */
const MAX_VISIBLE_EVENTS = 3;

/** 해당 달의 1일(자정)을 반환합니다. */
function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 연/월/일이 모두 같은지 비교합니다. */
function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** Date를 YYYY-MM-DD 문자열로 변환합니다. */
function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 요일에 따른 주말 강조 클래스(일=빨강, 토=파랑)를 반환합니다. */
function weekendClass(weekday: number): string | null {
	if (weekday === 0) return "is-sunday";
	if (weekday === 6) return "is-saturday";
	return null;
}

/** 달력 셀에 표시되는 하나의 일정/할 일 항목 */
interface CalendarEvent {
	/** 노트 내 0-based 줄 번호(할 일 토글에 사용) */
	line: number;
	/** 표시용 시작 시각 "HH:MM" (시간이 없으면 null) */
	time: string | null;
	/** 정렬용 시작 시각(분 단위, 시간이 없으면 null) */
	startMinutes: number | null;
	title: string;
	isTodo: boolean;
	done: boolean;
}

/**
 * 최상위 리스트 항목: `-`/`*`/`+` 불릿 + 선택적 `[ ]`/`[x]` 체크박스.
 * 줄 맨 앞이어야 하며(들여쓰기 없음), 들여쓴 하위 불릿(설명)은 일정으로 보지 않습니다.
 */
const LIST_ITEM_RE = /^[-*+]\s+(\[[ xX]\]\s+)?(.*)$/;
/** 표시 제목에서 제거할 동기화 메타: 종일 표기 → 블록ID → [캘린더] 순으로 뒤에서 제거 */
const ALLDAY_TAG_RE = /\s*\(종일\)\s*$/;
const BLOCK_ID_TAG_RE = /\s*\^ic-[A-Za-z0-9]+\s*$/;
const CAL_TAG_RE = /\s*\[[^\]]+\]\s*$/;
/** 본문 맨 앞의 시각 표기: `HH:MM` 또는 `HH:MM-HH:MM` / `HH:MM~HH:MM` */
const TIME_RE = /^(\d{1,2}:\d{2})(?:\s*[-~]\s*\d{1,2}:\d{2})?\s+(.*)$/;

/** "HH:MM"을 자정 기준 분으로 변환합니다(형식 오류면 null). */
function toMinutes(time: string): number | null {
	const [hours, mins] = time.split(":").map(Number);
	if (hours > 23 || mins > 59) return null;
	return hours * 60 + mins;
}

/**
 * 마크다운 본문에서 "기능 문법"에 해당하는 항목만 추출합니다.
 * 인식 대상은 리스트 항목뿐이며, 다음 형태를 지원합니다.
 *   - 제목                  (종일 일정)
 *   - HH:MM 제목            (시간 일정)
 *   - HH:MM-HH:MM 제목      (시간 범위 일정)
 *   - [ ] 제목 / - [x] 제목 (할 일)
 * 위 문법에 맞지 않거나 제목이 빈 줄은 무시합니다.
 */
function parseEvents(content: string): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	content.split("\n").forEach((rawLine, line) => {
		const listMatch = rawLine.match(LIST_ITEM_RE);
		if (!listMatch) return;

		const checkbox = listMatch[1];
		const isTodo = checkbox !== undefined;
		const done = isTodo && /[xX]/.test(checkbox);

		let title = listMatch[2].trim();
		let time: string | null = null;
		let startMinutes: number | null = null;

		const timeMatch = title.match(TIME_RE);
		if (timeMatch) {
			const minutes = toMinutes(timeMatch[1]);
			if (minutes !== null) {
				time = timeMatch[1];
				startMinutes = minutes;
				title = timeMatch[2].trim();
			}
		}

		// 동기화 메타데이터(종일 표기·블록ID·[캘린더])는 표시 제목에서 제거합니다.
		title = title
			.replace(ALLDAY_TAG_RE, "")
			.replace(BLOCK_ID_TAG_RE, "")
			.replace(CAL_TAG_RE, "")
			.trim();

		if (!title) return; // 제목이 없는 항목은 일정으로 보지 않습니다.

		events.push({ line, time, startMinutes, title, isTodo, done });
	});

	// 시간이 있는 일정을 앞쪽에 시간순으로(없는 항목은 작성 순서 유지) 정렬합니다.
	return events.sort((a, b) => {
		if (a.startMinutes === null && b.startMinutes === null) return 0;
		if (a.startMinutes === null) return 1;
		if (b.startMinutes === null) return -1;
		return a.startMinutes - b.startMinutes;
	});
}

export class CalendarView extends ItemView {
	/** 현재 화면에 표시 중인 달(1일 기준) */
	private displayedMonth: Date = startOfMonth(new Date());

	/** 잦은 vault 변경에도 렌더를 한 번으로 모으기 위한 디바운스 */
	private scheduleRefresh = debounce(() => this.render(), 300, true);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MyPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR;
	}

	getDisplayText(): string {
		return "Calendar Reborn";
	}

	getIcon(): string {
		return "calendar-days";
	}

	async onOpen() {
		// 뷰가 열릴 때는 항상 오늘이 속한 달을 보여줍니다.
		this.displayedMonth = startOfMonth(new Date());
		this.registerVaultEvents();
		this.render();
	}

	async onClose() {
		// registerEvent로 등록한 핸들러는 자동 정리됩니다.
	}

	/** 외부(플러그인)에서 강제로 다시 그릴 때 사용. */
	forceRender() {
		this.render();
	}

	/** 일정 폴더 내 파일이 바뀌면 달력을 다시 그립니다. */
	private registerVaultEvents() {
		const refresh = (file: TAbstractFile) => {
			if (this.isInCalendarFolder(file)) this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("create", refresh));
		this.registerEvent(this.app.vault.on("modify", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
	}

	private render() {
		const container = this.contentEl;
		container.empty();
		container.addClass("calendar-reborn-view");

		this.renderHeader(container);
		this.renderGrid(container);
	}

	private renderHeader(parent: HTMLElement) {
		const header = parent.createDiv({ cls: "calendar-reborn-header" });

		header.createDiv({
			cls: "calendar-reborn-title",
			text: `${this.displayedMonth.getFullYear()}년 ${this.displayedMonth.getMonth() + 1}월`,
		});

		const nav = header.createDiv({ cls: "calendar-reborn-nav" });
		this.createNavButton(nav, "chevron-left", "이전 달", () =>
			this.shiftMonth(-1),
		);
		this.createNavButton(nav, "dot", "오늘", () => this.goToToday());
		this.createNavButton(nav, "chevron-right", "다음 달", () =>
			this.shiftMonth(1),
		);
	}

	private createNavButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	) {
		const btn = parent.createEl("button", {
			cls: "calendar-reborn-nav-btn",
			attr: { "aria-label": label },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
	}

	private renderGrid(parent: HTMLElement) {
		const grid = parent.createDiv({ cls: "calendar-reborn-grid" });

		WEEKDAYS.forEach((day, weekday) => {
			const cell = grid.createDiv({
				cls: "calendar-reborn-weekday",
				text: day,
			});
			const modifier = weekendClass(weekday);
			if (modifier) cell.addClass(modifier);
		});

		const year = this.displayedMonth.getFullYear();
		const month = this.displayedMonth.getMonth();
		const firstWeekday = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const today = new Date();

		// 앞쪽 빈 칸(이전 달) + 이번 달 + 마지막 주를 채우는 다음 달까지 한 번에 계산합니다.
		const trailing = (7 - ((firstWeekday + daysInMonth) % 7)) % 7;
		const totalCells = firstWeekday + daysInMonth + trailing;

		for (let i = 0; i < totalCells; i++) {
			// 그리드 첫 칸을 기준으로 실제 날짜를 계산합니다(Date가 월 경계를 자동 보정).
			const cellDate = new Date(year, month, 1 - firstWeekday + i);
			this.createDayCell(grid, cellDate, {
				isAdjacent: cellDate.getMonth() !== month,
				isToday: isSameDay(today, cellDate),
			});
		}
	}

	private createDayCell(
		grid: HTMLElement,
		cellDate: Date,
		options: { isAdjacent: boolean; isToday: boolean },
	) {
		const cell = grid.createDiv({ cls: "calendar-reborn-day-cell" });
		if (options.isAdjacent) cell.addClass("is-adjacent");
		if (options.isToday) cell.addClass("is-today");

		const dateText = cell.createSpan({
			cls: "calendar-reborn-day-text",
			text: String(cellDate.getDate()),
		});
		const modifier = weekendClass(cellDate.getDay());
		if (modifier) dateText.addClass(modifier);

		const eventList = cell.createDiv({ cls: "calendar-reborn-events" });
		const eventListScroll = eventList.createDiv({
			cls: "calendar-reborn-events-scroll",
		});

		// 셀 우상단 "+" 버튼: 해당 날짜에 새 일정 모달 열기.
		const addBtn = cell.createEl("button", {
			cls: "calendar-reborn-add-btn",
			text: "+",
			attr: { "aria-label": "새 일정" },
		});
		addBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openEventModal(cellDate);
		});

		// 클릭하면 해당 날짜의 데일리 노트를 생성/열기 합니다.
		cell.addEventListener("click", () => {
			void this.openDailyNote(cellDate);
		});

		// 해당 날짜의 일정 목록을 비동기로 채웁니다.
		void this.populateEvents(cellDate, cell, eventListScroll);
	}

	private openEventModal(date: Date) {
		const settings = this.plugin.settings;
		if (!settings.calendars.length) {
			new Notice("설정에서 캘린더를 먼저 불러오세요.");
			return;
		}
		new EventModal(
			this.app,
			settings.calendars,
			settings.defaultCalendarId,
			async (r) => {
				await this.plugin.syncEngine().createEvent({
					day: date,
					title: r.title,
					description: r.description,
					startMinutes: r.startMinutes,
					endMinutes: r.endMinutes,
					allDay: r.allDay,
					calendarId: r.calendarId,
				});
				await this.plugin.persistSyncState();
				this.render();
			},
		).open();
	}

	private async populateEvents(
		date: Date,
		cell: HTMLElement,
		eventList: HTMLElement,
	) {
		const file = this.app.vault.getAbstractFileByPath(
			this.dailyNotePath(date),
		);
		if (!(file instanceof TFile)) return;

		cell.addClass("has-note");

		const events = parseEvents(await this.app.vault.cachedRead(file));
		events.forEach((event) => {
			this.renderEvent(eventList, date, event);
		});
		// if (events.length > MAX_VISIBLE_EVENTS) {
		// 	eventList.createDiv({
		// 		cls: "calendar-reborn-event is-more",
		// 		text: `+${events.length - MAX_VISIBLE_EVENTS}`,
		// 	});
		// }
	}

	private renderEvent(
		eventList: HTMLElement,
		date: Date,
		event: CalendarEvent,
	) {
		const item = eventList.createDiv({ cls: "calendar-reborn-event" });
		if (event.isTodo) item.addClass("is-todo");
		if (event.done) item.addClass("is-done");

		if (event.isTodo) {
			const checkbox = item.createEl("input", {
				cls: "calendar-reborn-event-check",
				attr: { type: "checkbox" },
			});
			checkbox.checked = event.done;
			// 체크박스 클릭은 노트 열기(셀 클릭)로 전파되지 않게 막습니다.
			checkbox.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.toggleTodo(date, event.line);
			});
		}

		if (event.time) {
			item.createSpan({
				cls: "calendar-reborn-event-time",
				text: event.time,
			});
		}

		item.createSpan({
			cls: "calendar-reborn-event-title",
			text: event.title,
		});
	}

	/** 데일리 노트의 특정 줄에 있는 할 일 체크박스를 토글합니다. */
	private async toggleTodo(date: Date, line: number) {
		const file = this.app.vault.getAbstractFileByPath(
			this.dailyNotePath(date),
		);
		if (!(file instanceof TFile)) return;

		const lines = (await this.app.vault.read(file)).split("\n");
		if (line < 0 || line >= lines.length) return;

		const toggled = lines[line].replace(/\[( |x|X)\]/, (_, mark) =>
			mark === " " ? "[x]" : "[ ]",
		);
		if (toggled === lines[line]) return;

		lines[line] = toggled;
		// 저장하면 modify 이벤트로 달력이 자동 재렌더됩니다.
		await this.app.vault.modify(file, lines.join("\n"));
	}

	/**
	 * 해당 날짜의 데일리 노트를 (없으면 생성한 뒤) 엽니다.
	 * 같은 날짜 노트가 이미 열려 있으면 그 탭을 활성화하여
	 * 날짜별로 탭이 최대 한 개만 유지되게 합니다.
	 */
	private async openDailyNote(date: Date) {
		const file = await this.getOrCreateDailyNote(date);
		if (!file) return;

		const existing = this.findLeafForFile(file);
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
		this.app.workspace.revealLeaf(leaf);
	}

	/** 주어진 파일을 이미 표시 중인 leaf가 있으면 반환합니다. */
	private findLeafForFile(file: TFile): WorkspaceLeaf | null {
		let match: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (match) return;
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				match = leaf;
			}
		});
		return match;
	}

	private async getOrCreateDailyNote(date: Date): Promise<TFile | null> {
		const path = this.dailyNotePath(date);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;

		await ensureParentFolders(this.app.vault, path);
		try {
			return await this.app.vault.create(
				path,
				this.dailyNoteTemplate(date),
			);
		} catch {
			// 거의 동시에 생성된 경우 등 — 다시 조회해 반환합니다.
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? file : null;
		}
	}

	private dailyNotePath(date: Date): string {
		return normalizePath(
			buildDailyNotePath(this.plugin.settings.calendarFolder, formatDate(date)),
		);
	}

	private dailyNoteTemplate(date: Date): string {
		return [
			`# ${formatDate(date)}`,
			"",
			'<!-- 일정: "- HH:MM 제목"  ·  할 일: "- [ ] HH:MM 제목" -->',
			"- ",
		].join("\n");
	}

	private isInCalendarFolder(file: TAbstractFile): boolean {
		const folder = this.plugin.settings.calendarFolder.trim();
		if (!folder) return file.path.endsWith(".md");
		return file.path.startsWith(`${folder}/`);
	}

	private shiftMonth(delta: number) {
		this.displayedMonth = new Date(
			this.displayedMonth.getFullYear(),
			this.displayedMonth.getMonth() + delta,
			1,
		);
		this.render();
	}

	private goToToday() {
		this.displayedMonth = startOfMonth(new Date());
		this.render();
	}
}
