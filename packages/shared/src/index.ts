// Code shared across plugins in this monorepo.
// Plugins import from "@repo/shared"; esbuild bundles the source directly.

export function greeting(name: string): string {
	return `Hello, ${name}!`;
}

/** Format a date as YYYY-MM-DD (local time). */
export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** True when both dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
	return formatDate(a) === formatDate(b);
}
