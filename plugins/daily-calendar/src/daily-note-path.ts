/**
 * 데일리 노트의 vault 경로를 계산한다.
 * 연/월 폴더로 한 번 더 묶어 `{folder}/YYYY/YYYY-MM/YYYY-MM-DD.md` 형태로 만든다.
 * folder가 비어 있으면 vault 루트 기준 `YYYY/YYYY-MM/YYYY-MM-DD.md`.
 *
 * @param folder 설정된 캘린더 폴더(앞뒤 공백 허용).
 * @param dayKey "YYYY-MM-DD" 형식의 날짜 문자열.
 */
export function dailyNotePath(folder: string, dayKey: string): string {
	const year = dayKey.slice(0, 4);
	const month = dayKey.slice(0, 7); // YYYY-MM
	const segments = [folder.trim(), year, month, `${dayKey}.md`].filter(
		(s) => s.length > 0,
	);
	return segments.join("/");
}

/** 날짜 파일명(YYYY-MM-DD) 패턴. */
const DATE_BASENAME_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 설정 폴더 바로 아래에 평평하게 놓인 데일리 노트인지 판별한다
 * (마이그레이션 대상 탐지용). 이미 연/월로 묶인 노트는 false.
 *
 * @returns 평평한 데일리 노트면 그 날짜 키(YYYY-MM-DD), 아니면 null.
 */
export function flatDailyNoteKey(folder: string, path: string): string | null {
	const prefix = folder.trim() ? `${folder.trim()}/` : "";
	if (!path.startsWith(prefix)) return null;
	const rel = path.slice(prefix.length);
	if (rel.includes("/")) return null; // 이미 하위 폴더에 있음
	if (!rel.endsWith(".md")) return null;
	const base = rel.slice(0, -".md".length);
	return DATE_BASENAME_RE.test(base) ? base : null;
}
