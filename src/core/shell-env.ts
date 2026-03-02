import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let cachedEnv: Record<string, string> | null = null;

/**
 * Load the user's shell environment asynchronously.
 * Uses a login shell (-l) instead of sourcing interactive rc files directly,
 * which is safer and avoids executing arbitrary .zshrc commands.
 * Results are cached for the session lifetime.
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
	if (cachedEnv) return cachedEnv;

	if (process.platform === "win32") {
		cachedEnv = filterEnv(process.env);
		return cachedEnv;
	}

	const shell = process.env.SHELL || "/bin/sh";

	try {
		const output = await execAsync(`${shell} -lc 'env -0'`, {
			timeout: 5000,
			maxBuffer: 10 * 1024 * 1024,
		});

		const env: Record<string, string> = {};
		for (const entry of output.split("\0")) {
			const idx = entry.indexOf("=");
			if (idx > 0) {
				env[entry.substring(0, idx)] = entry.substring(idx + 1);
			}
		}
		cachedEnv = env;
		return env;
	} catch {
		cachedEnv = filterEnv(process.env);
		return cachedEnv;
	}
}

/**
 * Find the claude CLI binary path.
 */
export async function findClaudePath(customPath?: string): Promise<string | null> {
	if (customPath) return customPath;

	const env = await getShellEnvironment();
	try {
		const result = await execAsync("which claude", { timeout: 5000, env });
		return result.trim() || null;
	} catch {
		const candidates = [
			path.join(os.homedir(), ".claude", "local", "claude"),
			"/usr/local/bin/claude",
			path.join(os.homedir(), ".npm-global", "bin", "claude"),
		];
		for (const c of candidates) {
			try {
				fs.accessSync(c, fs.constants.X_OK);
				return c;
			} catch {
				continue;
			}
		}
		return null;
	}
}

/** Clear cached environment (for settings changes). */
export function clearEnvCache(): void {
	cachedEnv = null;
}

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v !== undefined) result[k] = v;
	}
	return result;
}

function execAsync(
	command: string,
	options: { timeout?: number; maxBuffer?: number; env?: Record<string, string> },
): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, { encoding: "utf-8", ...options }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}
