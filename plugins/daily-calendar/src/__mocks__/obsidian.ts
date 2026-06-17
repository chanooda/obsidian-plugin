/** Minimal stub of the obsidian package for unit tests. */

export class Notice {
	constructor(public message: string) {}
}

export class TFile {
	constructor(
		public path: string,
		public stat = { mtime: 0, ctime: 0, size: 0 },
		public basename = "",
		public extension = "md",
		public name = "",
		public parent = null,
		public vault = null,
	) {}
}
