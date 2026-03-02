import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { App, FileSystemAdapter, TFile, Notice } from "obsidian";
import { getShellEnvironment, findClaudePath } from "./shell-env";
import { getStylePrompt } from "./prompts";
import { sanitizeTitle, parseTitle as parseTitleLine, extractTitleFromPath, shouldResolveAgent } from "./title-utils";
import type { TangentSettings } from "../settings";

const TOOL_ICONS: Record<string, string> = {
	Read: "📂",
	Glob: "🔍",
	Grep: "🔍",
	WebSearch: "🌐",
	WebFetch: "🌐",
};

interface ProgressInfo {
	type: "tool" | "text";
	toolName?: string;
	toolDetail?: string;
	partialText?: string;
}

export interface TangentJob {
	/** The raw prompt text from >>...<< */
	prompt: string;
	/** The source file where the tangent was triggered */
	sourceFile: TFile | null;
	/** Position in source file to replace with wikilink */
	from: number;
	to: number;
}

export interface TangentResult {
	/** The created note title */
	title: string;
	/** The created note path */
	notePath: string;
	/** Whether it succeeded */
	success: boolean;
	/** 2-3 sentence summary for callout */
	summary?: string;
	/** Whether the title was auto-generated (vs prompt-as-title) */
	titleWasGenerated?: boolean;
	/** Original prompt text (for wikilink alias when title differs) */
	originalPrompt?: string;
	error?: string;
}

/**
 * Spawns a Claude Code agent to research a topic and fill a note.
 */
export class TangentAgent {
	private app: App;
	private settings: TangentSettings;
	private activeProcesses: Map<string, ChildProcess> = new Map();
	private queue: Array<() => Promise<void>> = [];
	private running = false;

	constructor(app: App, settings: TangentSettings) {
		this.app = app;
		this.settings = settings;
	}

	async run(job: TangentJob): Promise<TangentResult> {
		return new Promise<TangentResult>((resolve) => {
			this.queue.push(async () => {
				const result = await this.execute(job);
				resolve(result);
			});
			this.processQueue();
		});
	}

	private async processQueue(): Promise<void> {
		if (this.running) return;
		this.running = true;
		while (this.queue.length > 0) {
			const task = this.queue.shift()!;
			await task();
		}
		this.running = false;
	}

	private async execute(job: TangentJob): Promise<TangentResult> {
		const claudePath = await findClaudePath(this.settings.claudePath || undefined);
		if (!claudePath) {
			return {
				title: job.prompt,
				notePath: "",
				success: false,
				error: "Claude CLI not found. Install it or set the path in settings.",
			};
		}

		const relatedNotes = await this.findRelatedNotes(job.prompt);
		const { adapter } = this.app.vault;
		if (!(adapter instanceof FileSystemAdapter)) {
			return { title: job.prompt, notePath: "", success: false, error: "Vault is not using a local file system." };
		}
		const vaultPath = adapter.getBasePath();
		const agentPrompt = this.buildPrompt(job.prompt, relatedNotes);

		// Determine note title and path, handling collisions
		const folder = this.settings.tangentFolder;
		const sanitizedPrompt = sanitizeTitle(job.prompt.slice(0, 100));
		const notePath = await this.uniqueNotePath(folder, sanitizedPrompt);
		const title = extractTitleFromPath(notePath);

		try {
			await this.ensureFolder(folder);
			await this.app.vault.create(notePath, `\n> [!tangent] 🔍 Researching "${job.prompt}"...\n`);

			new Notice(`Tangent: researching "${job.prompt}"...`);
			// Throttled writer to avoid hammering Obsidian's file watchers
			let lastWriteTime = 0;
			let pendingContent: string | null = null;
			let pendingTimer: ReturnType<typeof setTimeout> | null = null;
			let writeChain = Promise.resolve();
			let accumulatedText = "";
			let textStarted = false;

			const flushWrite = () => {
				if (pendingContent === null) return;
				const content = pendingContent;
				pendingContent = null;
				writeChain = writeChain
					.then(async () => {
						const file = this.app.vault.getAbstractFileByPath(notePath);
						if (file instanceof TFile) {
							await this.app.vault.modify(file, content);
							lastWriteTime = Date.now();
						}
					})
					.catch((err) => {
						console.error("Tangent: intermediate write failed", err);
					});
			};

			const throttledWrite = (content: string) => {
				pendingContent = content;
				const elapsed = Date.now() - lastWriteTime;
				if (elapsed >= 500) {
					if (pendingTimer) {
						clearTimeout(pendingTimer);
						pendingTimer = null;
					}
					flushWrite();
				} else if (!pendingTimer) {
					pendingTimer = setTimeout(() => {
						pendingTimer = null;
						flushWrite();
					}, 500 - elapsed);
				}
			};

			const toolLines: string[] = [];

			const onProgress = (info: ProgressInfo) => {
				if (info.type === "tool" && info.toolName) {
					const icon = TOOL_ICONS[info.toolName] || "⚙️";
					const detail = info.toolDetail ? info.toolDetail.replace(/^.*\//, "") : "";
					const label = detail ? `${icon} ${detail}` : `${icon} ${info.toolName}...`;
					toolLines.push(label);
					if (toolLines.length > 3) toolLines.shift();
					if (!textStarted) {
						const callout =
							`\n> [!tangent] 🔍 Researching "${job.prompt}"...\n` + toolLines.map((l) => `> ${l}\n`).join("");
						throttledWrite(callout);
					}
				} else if (info.type === "text" && info.partialText) {
					if (/^\s*#/.test(info.partialText)) {
						textStarted = true;
						accumulatedText = info.partialText;
						throttledWrite(accumulatedText);
					}
				}
			};

			const rawContent = await this.spawnAgent(claudePath, agentPrompt, vaultPath, onProgress);

			// Drain any in-flight or pending writes before final write
			if (pendingTimer) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			if (pendingContent) flushWrite();
			await writeChain;
			pendingContent = null;

			// Parse TITLE line from agent output if present
			const { generatedTitle, noteContent } = parseTitleLine(rawContent);

			// Parse summary from note content
			const { summary, content } = this.parseSummary(noteContent);

			// Determine final title
			let finalTitle = title;
			let titleWasGenerated = false;
			if (generatedTitle) {
				const sanitized = sanitizeTitle(generatedTitle);
				if (sanitized) {
					finalTitle = this.settings.titlePrefix + sanitized;
					titleWasGenerated = true;
				}
			} else if (this.settings.titlePrefix) {
				finalTitle = this.settings.titlePrefix + title;
				titleWasGenerated = false;
			}

			let finalPath = notePath;
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				const attributed = this.addAttribution(content, job);
				await this.app.vault.modify(file, attributed);

				// Rename file if title changed
				if (finalTitle !== title) {
					const newPath = await this.uniqueNotePath(folder, finalTitle);
					await this.app.vault.rename(file, newPath);
					finalPath = newPath;
					// Update finalTitle to match the actual path (may include collision suffix)
					finalTitle = extractTitleFromPath(newPath);
				}
			}

			new Notice(`Tangent complete: ${finalTitle}`);
			return {
				title: finalTitle,
				notePath: finalPath,
				success: true,
				summary,
				titleWasGenerated,
				originalPrompt: job.prompt,
			};
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				await this.app.vault.modify(
					file,
					`\n> [!error] Tangent failed\n> ${errorMsg}\n\n# ${job.prompt}\n\n*Agent encountered an error. Try again or write manually.*\n`,
				);
			}
			new Notice(`Tangent failed: ${errorMsg}`);
			return { title, notePath, success: false, error: errorMsg };
		}
	}

	private parseSummary(raw: string): { summary: string; content: string } {
		// Extract ## Summary section from the note content
		const summaryMatch = raw.match(/## Summary\n+([\s\S]*?)(?=\n## |\n# |$)/i);
		if (summaryMatch) {
			return { summary: summaryMatch[1]!.trim(), content: raw };
		}
		// Fallback: first paragraph after the heading
		const firstPara = raw.split(/\n\n/)[1] || raw.split(/\n\n/)[0] || "";
		return {
			summary: firstPara
				.replace(/^#+\s*.*\n*/, "")
				.trim()
				.slice(0, 300),
			content: raw,
		};
	}

	private addAttribution(content: string, job: TangentJob): string {
		const parts: string[] = [];

		if (this.settings.addFrontmatter || this.settings.addTags) {
			parts.push("---");
			if (this.settings.addFrontmatter) {
				parts.push(`generated-by: tangent-agent`);
				if (job.sourceFile) {
					parts.push(`tangent-source: "[[${job.sourceFile.basename}]]"`);
				}
				parts.push(`tangent-prompt: "${job.prompt.replace(/"/g, '\\"')}"`);
				parts.push(`date: ${new Date().toISOString().split("T")[0]}`);
			}
			if (this.settings.addTags) {
				const tags = this.settings.tags
					.split(",")
					.map((t: string) => t.trim())
					.filter(Boolean);
				if (tags.length > 0) {
					parts.push("tags:");
					for (const tag of tags) {
						parts.push(`  - ${tag}`);
					}
				}
			}
			parts.push("---");
			parts.push("");
		}

		parts.push(content.replace(/^\n+/, ""));
		return parts.join("\n");
	}

	private async findRelatedNotes(topic: string): Promise<string[]> {
		const files = this.app.vault.getMarkdownFiles();
		const keywords = topic
			.toLowerCase()
			.split(/\s+/)
			.filter((w: string) => w.length > 3);
		const related: string[] = [];

		for (const file of files) {
			const name = file.basename.toLowerCase();
			if (keywords.some((kw: string) => name.includes(kw))) {
				related.push(file.path);
				if (related.length >= 10) break;
			}
		}

		for (const file of files) {
			if (related.length >= 15) break;
			if (related.includes(file.path)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			const headings = cache.headings?.map((h: { heading: string }) => h.heading.toLowerCase()) || [];
			if (keywords.some((kw: string) => headings.some((h: string) => h.includes(kw)))) {
				related.push(file.path);
			}
		}

		return related;
	}

	private shouldGenerateTitle(prompt: string): boolean {
		if (this.settings.titleMode === "always") return true;
		if (this.settings.titleMode === "never") return false;
		// "when-long": generate only when prompt exceeds a reasonable title length
		return prompt.length > 60;
	}

	private buildPrompt(topic: string, relatedNotes: string[]): string {
		const parts: string[] = [];

		parts.push(`You are a research agent creating a comprehensive note about the following topic.`);
		parts.push(`\nTOPIC: ${topic}`);
		parts.push(`\nINSTRUCTIONS:`);
		parts.push(`- Write a well-structured markdown note about this topic.`);
		parts.push(`- Start with a clear heading and overview.`);
		parts.push(`- Include relevant details, examples, and connections.`);
		if (this.settings.wikilinkMode === "existing-only") {
			// Build list of existing note names for the agent
			const existingNames = this.app.vault.getMarkdownFiles().map((f) => f.basename);
			parts.push(`- Use [[wikilinks]] ONLY to link to notes that already exist in the vault.`);
			parts.push(`- Existing notes: ${existingNames.slice(0, 100).join(", ")}`);
			parts.push(`- Do NOT create [[links]] to notes that don't exist in the list above.`);
		} else if (this.settings.wikilinkMode === "create-new") {
			parts.push(`- Use [[wikilinks]] freely to link to existing notes or suggest new ones.`);
		} else {
			parts.push(`- Do NOT use [[wikilinks]] in the output.`);
		}
		parts.push(...getStylePrompt(this.settings.tangentStyle, this.settings.customStylePrompt));
		parts.push(`- Use proper markdown formatting (headings, lists, blockquotes, etc).`);

		if (relatedNotes.length > 0) {
			parts.push(`\nRELATED NOTES IN VAULT (read these for context):`);
			for (const p of relatedNotes) {
				parts.push(`- ${p}`);
			}
			parts.push(`\nRead these related notes to understand existing knowledge and make connections.`);
		}

		if (this.settings.webResearch) {
			parts.push(`\nYou may also search the web for additional information to supplement vault knowledge.`);
		} else {
			parts.push(`\nDo NOT search the web. Only use information from the vault and your training data.`);
		}

		if (this.shouldGenerateTitle(topic)) {
			parts.push(`\nSTRUCTURE: Your output MUST begin with exactly one line in this format:`);
			parts.push(`TITLE: <concise 3-6 word title>`);
			parts.push(`This TITLE line is MANDATORY. It will be used as the filename. Do NOT skip it.`);
			parts.push(
				`After the TITLE line, leave one blank line, then start the note content with a top-level heading, then immediately a ## Summary section containing a SINGLE paragraph of 2-3 sentences summarizing the topic. End that paragraph with " ^summary" (space, caret, the word summary). Then continue with the full note under further ## headings.`,
			);
			parts.push(`Example of correct output format:`);
			parts.push(`TITLE: Quantum Entanglement Explained`);
			parts.push(``);
			parts.push(`# Quantum Entanglement`);
			parts.push(`## Summary`);
			parts.push(`Quantum entanglement is a phenomenon... ^summary`);
		} else {
			parts.push(
				`\nSTRUCTURE: Start the note with a top-level heading, then immediately a ## Summary section containing a SINGLE paragraph of 2-3 sentences summarizing the topic. End that paragraph with " ^summary" (space, caret, the word summary). Then continue with the full note under further ## headings.`,
			);
			parts.push(`Example summary section:`);
			parts.push(`## Summary`);
			parts.push(`The halting problem is a fundamental result... ^summary`);
		}
		parts.push(``);
		parts.push(`Output ONLY the markdown. No preamble, no code fences.`);

		return parts.join("\n");
	}

	private async spawnAgent(
		claudePath: string,
		prompt: string,
		vaultPath: string,
		onProgress?: (info: ProgressInfo) => void,
	): Promise<string> {
		const env = await getShellEnvironment();
		const args = ["--print", "--output-format", "stream-json", "--model", this.settings.model, "--add-dir", vaultPath];

		if (this.settings.permissionMode === "bypassPermissions") {
			args.push("--dangerously-skip-permissions");
		} else if (this.settings.permissionMode === "acceptEdits") {
			args.push("--permission-mode", "acceptEdits");
		}

		// Conditionally include web tools based on setting
		const tools = ["Read", "Glob", "Grep"];
		if (this.settings.webResearch) {
			tools.push("WebSearch", "WebFetch");
		}
		args.push("--allowedTools", tools.join(","));

		return new Promise<string>((resolve, reject) => {
			const proc = spawn(claudePath, args, {
				cwd: vaultPath,
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});

			const jobId = `${Date.now()}`;
			this.activeProcesses.set(jobId, proc);

			let resultText = "";
			let latestText = "";
			let stderr = "";
			const rl = createInterface({ input: proc.stdout });
			rl.on("line", (line: string) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line);
					if (event.type === "assistant" && event.message?.content) {
						for (const block of event.message.content) {
							if (block.type === "tool_use" && onProgress) {
								const input = block.input || {};
								const detail = input.file_path || input.pattern || input.query || input.url || "";
								onProgress({ type: "tool", toolName: block.name, toolDetail: detail });
							} else if (block.type === "text" && block.text) {
								// Show latest text as preview (may include agent chatter)
								latestText = block.text;
								if (onProgress) {
									onProgress({ type: "text", partialText: latestText });
								}
							}
						}
					} else if (event.type === "result" && event.result) {
						// The result contains the clean final text
						resultText = event.result;
					}
				} catch {
					// Skip non-JSON lines
				}
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on("close", (code: number | null) => {
				this.activeProcesses.delete(jobId);
				rl.close();
				const decision = shouldResolveAgent(code, resultText, latestText);
				if (decision.resolve) {
					resolve(decision.text);
				} else {
					reject(new Error(stderr || decision.error));
				}
			});

			proc.on("error", (err: Error) => {
				this.activeProcesses.delete(jobId);
				rl.close();
				reject(err);
			});

			proc.stdin.write(prompt);
			proc.stdin.end();
		});
	}

	private async uniqueNotePath(folder: string, baseName: string): Promise<string> {
		const base = folder ? `${folder}/${baseName}` : baseName;
		let candidate = `${base}.md`;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${base} (${counter}).md`;
			counter++;
		}
		return candidate;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		if (!folderPath) return;
		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (!existing) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	killAll(): void {
		for (const [id, proc] of this.activeProcesses) {
			proc.kill();
			this.activeProcesses.delete(id);
		}
	}
}
