import type { Vault } from "obsidian";

/**
 * 주어진 파일 경로의 상위 폴더들을 위에서부터 차례로 생성한다.
 * `vault.create`는 상위 폴더를 자동 생성하지 않으므로 파일 생성/이동 전에 호출한다.
 */
export async function ensureParentFolders(
	vault: Vault,
	path: string,
): Promise<void> {
	const parts = path.split("/");
	parts.pop(); // 파일명 제거
	let current = "";
	for (const segment of parts) {
		current = current ? `${current}/${segment}` : segment;
		if (!vault.getAbstractFileByPath(current)) {
			try {
				await vault.createFolder(current);
			} catch {
				// 이미 존재하면 무시.
			}
		}
	}
}
