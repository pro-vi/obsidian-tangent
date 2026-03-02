import { Editor, EventRef, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile, Workspace } from "obsidian";
import { DEFAULT_SETTINGS, TangentSettings, TangentSettingTab } from "./settings";
import { TangentAgent, TangentJob } from "./core/agent";
import { tangentDecorationPlugin, findTangentMarkers } from "./core/tangent-decoration";
import { MarkerTracker } from "./core/marker-tracking";
import { replaceMarkerByOffset } from "./core/replace-marker";

/** Obsidian exposes "editor-change" at runtime but not in public types */
type WorkspaceWithEditorChange = Workspace & {
	on(name: "editor-change", callback: (editor: Editor, info: MarkdownView) => void): EventRef;
};

export default class TangentPlugin extends Plugin {
	settings!: TangentSettings;
	agent!: TangentAgent;
	/** Track in-flight tangents to prevent duplicate processing */
	private activeMarkers = new Set<string>();
	/** Per-file write lock to serialize marker replacements */
	private fileLocks = new Map<string, Promise<void>>();
	/** Track known markers per file so auto-trigger only fires on newly appeared ones */
	private markerTracker = new MarkerTracker();

	private markerKey(filePath: string, topic: string, offset: number): string {
		return `${filePath}::${topic}@${offset}`;
	}

	private getMarkerOccurrences(content: string): Array<{ topic: string; offset: number }> {
		return findTangentMarkers(content).map((marker) => ({
			topic: marker.topic,
			offset: marker.from,
		}));
	}

	async onload() {
		await this.loadSettings();
		this.agent = new TangentAgent(this.app, this.settings);

		// Register the CodeMirror editor extension for >>topic<< highlighting
		this.registerEditorExtension(tangentDecorationPlugin);

		// Command: Process all tangent markers in the current note
		this.addCommand({
			id: "process-tangents",
			name: "Process all >>tangent<< markers in current note",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (ctx instanceof MarkdownView) {
					this.processCurrentNote(editor, ctx);
				}
			},
		});

		// Command: Create tangent from selection
		this.addCommand({
			id: "tangent-from-selection",
			name: "Create tangent from selected text",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (!(ctx instanceof MarkdownView)) return;
				const selection = editor.getSelection();
				if (!selection.trim()) {
					new Notice("Select some text first to create a tangent.");
					return;
				}
				this.createTangent(selection.trim(), editor, ctx);
			},
		});

		// Command: Quick tangent via input modal
		this.addCommand({
			id: "quick-tangent",
			name: "Quick tangent (type a topic)",
			callback: () => {
				// Use Obsidian's built-in prompt
				const modal = new QuickTangentModal(this.app, (topic) => {
					if (topic.trim()) {
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view) {
							this.createTangent(topic.trim(), view.editor, view);
						} else {
							this.createStandaloneTangent(topic.trim());
						}
					}
				});
				modal.open();
			},
		});

		// Ribbon icon
		this.addRibbonIcon("waypoints", "Process tangents", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				this.processCurrentNote(view.editor, view);
			} else {
				new Notice("Open a note first.");
			}
		});

		// Auto-trigger: watch for << closing a >>...<< marker
		this.registerEvent(
			(this.app.workspace as WorkspaceWithEditorChange).on("editor-change", (editor, info) => {
				if (!this.settings.autoTrigger) return;
				const file = info.file;
				if (!file) return;

				const content = editor.getValue();
				const currentMarkers = this.getMarkerOccurrences(content);

				// Let tracker determine which markers are genuinely new
				const newMarkers = this.markerTracker.update(file.path, currentMarkers);

				for (const marker of newMarkers) {
					const key = this.markerKey(file.path, marker.topic, marker.offset);
					if (this.activeMarkers.has(key)) continue;
					this.activeMarkers.add(key);

					const job: TangentJob = {
						prompt: marker.topic,
						sourceFile: file,
						from: marker.offset,
						to: marker.offset + `>>${marker.topic}<<`.length,
					};

					this.agent
						.run(job)
						.then(async (result) => {
							if (result.success) {
								await this.replaceMarkerInFile(file, marker.topic, result, marker.offset);
							}
						})
						.catch((err) => {
							console.error("[tangent] auto-trigger failed:", err);
						})
						.finally(() => {
							this.activeMarkers.delete(key);
						});
				}
			}),
		);

		// Right-click context menu
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				if (!(view instanceof MarkdownView)) return;
				const selection = editor.getSelection().trim();
				if (selection) {
					menu.addItem((item) =>
						item
							.setTitle("Create tangent from selection")
							.setIcon("waypoints")
							.onClick(() => {
								this.createTangent(selection, editor, view);
							}),
					);
				}

				const content = editor.getValue();
				const markers = findTangentMarkers(content);
				if (markers.length > 0) {
					menu.addItem((item) =>
						item
							.setTitle(`Process ${markers.length} tangent marker${markers.length > 1 ? "s" : ""}`)
							.setIcon("waypoints")
							.onClick(() => {
								this.processCurrentNote(editor, view);
							}),
					);
				}
			}),
		);

		// Settings tab
		this.addSettingTab(new TangentSettingTab(this.app, this));
	}

	onunload() {
		this.agent.killAll();
	}

	async loadSettings() {
		const saved: Partial<TangentSettings> = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Migrate old titleMode values
		const titleMigration: Record<string, TangentSettings["titleMode"]> = {
			auto: "when-long",
			"always-generate": "always",
			"prompt-as-title": "never",
		};
		if (titleMigration[this.settings.titleMode]) {
			this.settings.titleMode = titleMigration[this.settings.titleMode]!;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Replace a >>topic<< marker in a file with the appropriate replacement
	 * (callout, link, or both) based on settings.
	 */
	private async replaceMarkerInFile(
		file: TFile,
		topic: string,
		result: { title: string; notePath: string; summary?: string },
		markerOffset?: number,
	): Promise<void> {
		// Serialize writes to the same file to prevent read-modify-write races
		const prev = this.fileLocks.get(file.path) ?? Promise.resolve();
		const { promise, resolve } = this.createDeferred();
		this.fileLocks.set(file.path, promise);
		await prev;

		try {
			await this.replaceMarkerInFileUnsafe(file, topic, result, markerOffset);
		} finally {
			this.fileLocks.delete(file.path);
			resolve();
		}
	}

	private createDeferred(): { promise: Promise<void>; resolve: () => void } {
		let resolve!: () => void;
		const promise = new Promise<void>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	}

	/**
	 * Find the active editor for a file, if it's currently open.
	 */
	private getEditorForFile(file: TFile): Editor | null {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				return view.editor;
			}
		}
		return null;
	}

	/**
	 * Find the marker offset in content, preferring the hint offset if it still matches.
	 */
	private findMarkerOffset(content: string, markerText: string, hintOffset?: number): number {
		// If we have a hint, check if marker is still there (may have shifted slightly)
		if (hintOffset !== undefined) {
			// Exact match at hint
			if (content.slice(hintOffset, hintOffset + markerText.length) === markerText) {
				return hintOffset;
			}
			// Search nearby (user may have typed a few chars before it)
			const searchStart = Math.max(0, hintOffset - 200);
			const searchEnd = Math.min(content.length, hintOffset + 200);
			const region = content.slice(searchStart, searchEnd);
			const localIdx = region.indexOf(markerText);
			if (localIdx >= 0) {
				return searchStart + localIdx;
			}
			// A known occurrence that has moved too far is safer to leave untouched
			// than to replace the first matching topic in the file.
			return -1;
		}
		// Fallback: first occurrence
		return content.indexOf(markerText);
	}

	private async replaceMarkerInFileUnsafe(
		file: TFile,
		topic: string,
		result: { title: string; notePath: string; summary?: string; titleWasGenerated?: boolean; originalPrompt?: string },
		markerOffset?: number,
	): Promise<void> {
		const markerText = `>>${topic}<<`;
		const mode = this.settings.replacementMode;

		// Use alias syntax when title was auto-generated so inline text shows original prompt
		const wikilink =
			result.titleWasGenerated && result.originalPrompt
				? `[[${result.title}|${result.originalPrompt}]]`
				: `[[${result.title}]]`;

		const editor = this.getEditorForFile(file);

		if (editor) {
			// Use live editor content to avoid stale offset from vault.read()
			const liveContent = editor.getValue();
			const idx = this.findMarkerOffset(liveContent, markerText, markerOffset);
			if (idx < 0) return;

			const markerFrom = editor.offsetToPos(idx);
			const markerTo = editor.offsetToPos(idx + markerText.length);

			if (mode === "link") {
				editor.replaceRange(wikilink, markerFrom, markerTo);
			} else {
				// "both" — replace marker, then insert callout after paragraph
				const summaryText = (result.summary || "").replace(/\s*\^summary\s*$/, "");
				const summaryLines = summaryText
					.split(/\n/)
					.map((l: string) => `> ${l}`)
					.join("\n");
				const block = `\n\n> [!tangent] [[${result.title}]]\n${summaryLines}`;

				editor.replaceRange(wikilink, markerFrom, markerTo);

				// Recalculate positions after the first replacement
				const newIdx = idx + wikilink.length;
				const afterContent = editor.getValue();
				const blankLineIdx = afterContent.indexOf("\n\n", newIdx);
				const insertPos = blankLineIdx >= 0 ? blankLineIdx : afterContent.length;
				const insertAt = editor.offsetToPos(insertPos);

				editor.replaceRange(block, insertAt);
			}
		} else {
			// File not open in editor — use replaceMarkerByOffset for correctness
			const currentContent = await this.app.vault.read(file);
			const idx = this.findMarkerOffset(currentContent, markerText, markerOffset);
			if (idx < 0) return;

			const newContent = replaceMarkerByOffset(
				currentContent,
				topic,
				idx,
				wikilink,
				mode,
				result.summary,
				`[[${result.title}]]`,
			);
			if (newContent) {
				await this.app.vault.modify(file, newContent);
			}
		}
	}

	/**
	 * Find all >>topic<< markers in the current note and process them.
	 */
	private async processCurrentNote(editor: Editor, view: MarkdownView) {
		const file = view.file;
		if (!file) return;

		const content = editor.getValue();
		const markers = findTangentMarkers(content);

		if (markers.length === 0) {
			new Notice("No >>tangent<< markers found in this note.");
			return;
		}

		new Notice(`Found ${markers.length} tangent(s). Processing...`);

		// Process markers in reverse order so positions stay valid
		for (let i = markers.length - 1; i >= 0; i--) {
			const marker = markers[i]!;
			await this.processMarker(marker, editor, file);
		}
	}

	/**
	 * Process a single >>topic<< marker.
	 */
	private async processMarker(marker: { topic: string; from: number; to: number }, _editor: Editor, sourceFile: TFile) {
		const key = this.markerKey(sourceFile.path, marker.topic, marker.from);
		if (this.activeMarkers.has(key)) return;
		this.activeMarkers.add(key);

		try {
			const job: TangentJob = {
				prompt: marker.topic,
				sourceFile,
				from: marker.from,
				to: marker.to,
			};

			const result = await this.agent.run(job);

			if (result.success) {
				await this.replaceMarkerInFile(sourceFile, marker.topic, result, marker.from);
			}
		} finally {
			this.activeMarkers.delete(key);
		}
	}

	/**
	 * Create a tangent from selected text — wraps it as a marker then processes.
	 */
	private async createTangent(topic: string, editor: Editor, view: MarkdownView) {
		const file = view.file;
		if (!file) return;

		const selectionStart = editor.getCursor("from");
		const idx = editor.posToOffset(selectionStart);
		if (idx < 0) return;

		// Claim the marker before inserting so auto-trigger doesn't race
		const key = this.markerKey(file.path, topic, idx);
		this.activeMarkers.add(key);

		// Wrap selection in >>...<< so it enters the same visual + processing flow
		const marker = `>>${topic}<<`;
		editor.replaceSelection(marker);
		this.markerTracker.remember(file.path, this.getMarkerOccurrences(editor.getValue()));

		try {
			const job: TangentJob = {
				prompt: topic,
				sourceFile: file,
				from: idx,
				to: idx + marker.length,
			};

			const result = await this.agent.run(job);

			if (result.success) {
				await this.replaceMarkerInFile(file, topic, result, idx);
			}
		} finally {
			this.activeMarkers.delete(key);
		}
	}

	/**
	 * Create a standalone tangent (no source note context).
	 */
	private async createStandaloneTangent(topic: string) {
		const job: TangentJob = {
			prompt: topic,
			sourceFile: null,
			from: 0,
			to: 0,
		};

		await this.agent.run(job);
	}
}

import { Modal, App } from "obsidian";

class QuickTangentModal extends Modal {
	private onSubmit: (topic: string) => void;

	constructor(app: App, onSubmit: (topic: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Create Tangent" });
		contentEl.createEl("p", {
			text: "Enter a topic or question. A Claude agent will research it and create a note.",
			cls: "tangent-modal-desc",
		});

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "e.g., how does quantum entanglement relate to consciousness",
			cls: "tangent-modal-input",
		});
		input.style.width = "100%";
		input.style.padding = "8px";
		input.style.marginTop = "8px";

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.onSubmit(input.value);
				this.close();
			}
		});

		const btn = contentEl.createEl("button", { text: "Go →", cls: "tangent-modal-btn" });
		btn.style.marginTop = "12px";
		btn.addEventListener("click", () => {
			this.onSubmit(input.value);
			this.close();
		});

		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}
