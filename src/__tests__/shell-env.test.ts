import { describe, it, expect, vi, beforeEach } from "vitest";

// We test findClaudePath logic by mocking child_process and fs
vi.mock("child_process", () => ({
	exec: vi.fn(),
}));

vi.mock("fs", () => ({
	default: { accessSync: vi.fn(), constants: { X_OK: 1 } },
	accessSync: vi.fn(),
	constants: { X_OK: 1 },
}));

describe("findClaudePath", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("returns custom path when provided", async () => {
		const { findClaudePath } = await import("../core/shell-env");
		const result = await findClaudePath("/custom/claude");
		expect(result).toBe("/custom/claude");
	});

	describe("P1: Windows-compatible discovery", () => {
		it("uses 'where' instead of 'which' on win32", async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });

			// Reset module to pick up new platform
			vi.resetModules();
			const cp = await import("child_process");
			const mockExec = vi.mocked(cp.exec);
			mockExec.mockImplementation(((
				cmd: string,
				_opts: unknown,
				cb: (err: Error | null, stdout: string) => void,
			) => {
				if (cmd.includes("where")) {
					cb(null, "C:\\Users\\test\\.claude\\local\\claude.exe\r\n");
				} else {
					cb(new Error("not found"), "");
				}
			}) as typeof cp.exec);

			const { findClaudePath } = await import("../core/shell-env");
			const result = await findClaudePath();
			expect(result).toBe("C:\\Users\\test\\.claude\\local\\claude.exe");

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("falls back to Windows-style paths when 'where' fails", async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });

			vi.resetModules();
			const cp = await import("child_process");
			const mockExec = vi.mocked(cp.exec);
			mockExec.mockImplementation(((
				_cmd: string,
				_opts: unknown,
				cb: (err: Error | null, stdout: string) => void,
			) => {
				cb(new Error("not found"), "");
			}) as typeof cp.exec);

			const fs = await import("fs");
			const mockAccess = vi.mocked(fs.accessSync);
			mockAccess.mockImplementation((p: string | unknown) => {
				if (typeof p === "string" && p.includes("AppData")) return;
				throw new Error("ENOENT");
			});

			const { findClaudePath } = await import("../core/shell-env");
			const result = await findClaudePath();
			expect(result).toMatch(/AppData/);

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});
	});
});
