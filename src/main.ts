import { Editor, EventRef, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile, Workspace } from "obsidian";
import { DEFAULT_SETTINGS, TangentSettings, TangentSettingTab } from "./settings";
import { TangentAgent, TangentJob } from "./core/agent";
import { tangentDecorationPlugin, findTangentMarkers } from "./core/tangent-decoration";

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
	private knownMarkers = new Map<string, Set<string>>();

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
				const markerRegex = />>([^<>]+)<</g;
				let m: RegExpExecArray | null;

				// Collect current markers in this file
				const currentMarkers = new Set<string>();

				while ((m = markerRegex.exec(content)) !== null) {
					const fullMatch = m[0];
					const topic = m[1]!;
					const matchIdx = m.index;

					// Skip line-start >> (blockquote conflict)
					const lineStart = content.lastIndexOf("\n", matchIdx - 1) + 1;
					const before = content.slice(lineStart, matchIdx);
					if (before.trim() === "") continue;

					// Skip inside inline code
					const line = content.slice(lineStart, content.indexOf("\n", matchIdx + fullMatch.length));
					const localIdx = matchIdx - lineStart;
					let inCode = false;
					for (let i = 0; i < localIdx; i++) {
						if (line[i] === "`") inCode = !inCode;
					}
					if (inCode) continue;

					currentMarkers.add(topic);

					// Only trigger on markers that are NEW (not previously known)
					const previousMarkers = this.knownMarkers.get(file.path);
					if (previousMarkers?.has(topic)) continue;

					const key = `${file.path}::${topic}`;
					if (this.activeMarkers.has(key)) continue;
					this.activeMarkers.add(key);

					const job: TangentJob = {
						prompt: topic,
						sourceFile: file,
						from: 0,
						to: 0,
					};

					this.agent
						.run(job)
						.then((result) => {
							if (result.success) {
								this.replaceMarkerInFile(file, topic, result);
							}
							this.activeMarkers.delete(key);
						})
						.catch((err) => {
							console.error("[tangent] auto-trigger failed:", err);
							this.activeMarkers.delete(key);
						});
				}

				// Update known markers for this file
				this.knownMarkers.set(file.path, currentMarkers);
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
	): Promise<void> {
		// Serialize writes to the same file to prevent read-modify-write races
		const prev = this.fileLocks.get(file.path) ?? Promise.resolve();
		const { promise, resolve } = this.createDeferred();
		this.fileLocks.set(file.path, promise);
		await prev;

		try {
			await this.replaceMarkerInFileUnsafe(file, topic, result);
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

	private async replaceMarkerInFileUnsafe(
		file: TFile,
		topic: string,
		result: { title: string; notePath: string; summary?: string; titleWasGenerated?: boolean; originalPrompt?: string },
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
			const idx = liveContent.indexOf(markerText);
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

				// Replace marker first
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
			// File not open in editor — fall back to vault.modify
			const currentContent = await this.app.vault.read(file);
			const idx = currentContent.indexOf(markerText);
			if (idx < 0) return;

			if (mode === "link") {
				const newContent =
					currentContent.slice(0, idx) + wikilink + currentContent.slice(idx + markerText.length);
				await this.app.vault.modify(file, newContent);
			} else {
				const summaryText = (result.summary || "").replace(/\s*\^summary\s*$/, "");
				const summaryLines = summaryText
					.split(/\n/)
					.map((l: string) => `> ${l}`)
					.join("\n");
				const block = `\n\n> [!tangent] [[${result.title}]]\n${summaryLines}`;

				const inlined =
					currentContent.slice(0, idx) + wikilink + currentContent.slice(idx + markerText.length);
				const afterMarker = idx + wikilink.length;
				const blankLineIdx = inlined.indexOf("\n\n", afterMarker);
				const insertPos = blankLineIdx >= 0 ? blankLineIdx : inlined.length;

				const newContent = inlined.slice(0, insertPos) + block + inlined.slice(insertPos);
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
		const key = `${sourceFile.path}::${marker.topic}`;
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
				await this.replaceMarkerInFile(sourceFile, marker.topic, result);
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

		// Claim the marker before inserting so auto-trigger doesn't race
		const key = `${file.path}::${topic}`;
		this.activeMarkers.add(key);

		// Wrap selection in >>...<< so it enters the same visual + processing flow
		const marker = `>>${topic}<<`;
		editor.replaceSelection(marker);

		// Use cursor position to find the marker we just inserted (avoids matching earlier duplicates)
		const cursor = editor.getCursor();
		const idx = editor.posToOffset(cursor) - marker.length;
		if (idx < 0) {
			this.activeMarkers.delete(key);
			return;
		}

		// Also register in knownMarkers so auto-trigger doesn't race
		const known = this.knownMarkers.get(file.path) ?? new Set<string>();
		known.add(topic);
		this.knownMarkers.set(file.path, known);

		// processMarker will see the key already in activeMarkers and skip the add,
		// but we go through it for the try/finally cleanup
		try {
			const job: TangentJob = {
				prompt: topic,
				sourceFile: file,
				from: idx,
				to: idx + marker.length,
			};

			const result = await this.agent.run(job);

			if (result.success) {
				await this.replaceMarkerInFile(file, topic, result);
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
