import { App, MarkdownRenderer, PluginSettingTab, Setting } from "obsidian";
import type TangentPlugin from "./main";

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
	return (options as readonly string[]).includes(value);
}

const TANGENT_STYLES = ["research", "template", "short", "dynamic", "custom"] as const;
const TITLE_MODES = ["always", "when-long", "never"] as const;
const REPLACEMENT_MODES = ["link", "both"] as const;
const WIKILINK_MODES = ["existing-only", "create-new", "none"] as const;

export interface TangentSettings {
	/** Path to claude CLI binary. Empty = auto-detect from shell */
	claudePath: string;
	/** Folder for tangent notes. Empty = vault root */
	tangentFolder: string;
	/** Whether to search the web in addition to vault */
	webResearch: boolean;
	/** Model to use */
	model: string;
	/** Permission mode for the agent */
	permissionMode: "default" | "acceptEdits" | "bypassPermissions";
	/** Auto-trigger tangent when user types closing << */
	autoTrigger: boolean;
	/** Add frontmatter properties to tangent notes */
	addFrontmatter: boolean;
	/** Tangent style — what kind of note the agent produces */
	tangentStyle: "research" | "template" | "short" | "dynamic" | "custom";
	/** Custom prompt instructions when tangentStyle is "custom" */
	customStylePrompt: string;
	/** How to replace >>topic<< in the source note */
	replacementMode: "link" | "both";
	/** Control how agent uses wikilinks in generated notes */
	wikilinkMode: "existing-only" | "create-new" | "none";
	/** Add tags to tangent notes */
	addTags: boolean;
	/** Tags to add (comma-separated) */
	tags: string;
	/** When to ask the agent to generate a concise title */
	titleMode: "always" | "when-long" | "never";
	/** Optional prefix for note titles */
	titlePrefix: string;
	/** Maximum number of concurrent agent processes */
	maxConcurrent: number;
}

export const DEFAULT_SETTINGS: TangentSettings = {
	claudePath: "",
	tangentFolder: "Tangents",
	webResearch: true,
	model: "opus",
	permissionMode: "bypassPermissions",
	autoTrigger: true,
	addFrontmatter: true,
	tangentStyle: "dynamic",
	customStylePrompt: "Write a note that captures the essence of this topic in your own style.",
	replacementMode: "link",
	wikilinkMode: "existing-only",
	addTags: true,
	tags: "tangent, ai-generated",
	titleMode: "when-long",
	titlePrefix: "",
	maxConcurrent: 3,
};

export class TangentSettingTab extends PluginSettingTab {
	plugin: TangentPlugin;

	constructor(app: App, plugin: TangentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Create a preview block after a setting element and return its render function */
	private addPreview(afterEl: HTMLElement, buildMarkdown: () => string): () => void {
		const el = createDiv({ cls: "tangent-replacement-preview" });
		afterEl.after(el);
		const render = () => {
			el.empty();
			el.createEl("div", { cls: "tangent-preview-label", text: "Preview" });
			const contentEl = el.createDiv({ cls: "tangent-preview-content" });
			MarkdownRenderer.render(this.app, buildMarkdown(), contentEl, "", this.plugin);
		};
		render();
		return render;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Claude CLI path")
			.setDesc("Path to the claude binary. Leave empty to auto-detect from your shell environment.")
			.addText((text) =>
				text
					.setPlaceholder("/usr/local/bin/claude")
					.setValue(this.plugin.settings.claudePath)
					.onChange(async (value) => {
						this.plugin.settings.claudePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Tangent folder")
			.setDesc("Folder where tangent notes are created. Leave empty for vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Tangents")
					.setValue(this.plugin.settings.tangentFolder)
					.onChange(async (value) => {
						this.plugin.settings.tangentFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Claude model to use for tangent research.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("sonnet", "Sonnet")
					.addOption("opus", "Opus")
					.addOption("haiku", "Haiku")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-trigger on <<")
			.setDesc("Automatically fire the agent as soon as you close a >>topic<< marker.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoTrigger).onChange(async (value) => {
					this.plugin.settings.autoTrigger = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Concurrent agents")
			.setDesc("Maximum number of tangent agents running at the same time.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("1", "1 (sequential)")
					.addOption("2", "2")
					.addOption("3", "3 (default)")
					.addOption("5", "5")
					.setValue(String(this.plugin.settings.maxConcurrent))
					.onChange(async (value) => {
						this.plugin.settings.maxConcurrent = parseInt(value, 10);
						await this.plugin.saveSettings();
					}),
			);

		// --- Agent Behavior ---
		containerEl.createEl("h3", { text: "Agent Behavior" });

		new Setting(containerEl)
			.setName("Web research")
			.setDesc("Allow the agent to search the web in addition to your vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.webResearch).onChange(async (value) => {
					this.plugin.settings.webResearch = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Tangent style")
			.setDesc("What kind of note the agent produces.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("dynamic", "Dynamic (agent decides)")
					.addOption("research", "Research (comprehensive)")
					.addOption("template", "Template (prompts for you)")
					.addOption("short", "Short note (~200 words)")
					.addOption("custom", "Custom (your own instructions)")
					.setValue(this.plugin.settings.tangentStyle)
					.onChange(async (value: string) => {
						if (isOneOf(value, TANGENT_STYLES)) this.plugin.settings.tangentStyle = value;
						await this.plugin.saveSettings();
						customPromptSetting.settingEl.toggle(value === "custom");
						renderStylePreview();
					}),
			);

		const customPromptSetting = new Setting(containerEl)
			.setName("Custom style prompt")
			.setDesc("Your instructions for the agent when using the custom style.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Write a note that captures the essence of this topic in your own style.")
					.setValue(this.plugin.settings.customStylePrompt)
					.onChange(async (value) => {
						this.plugin.settings.customStylePrompt = value;
						await this.plugin.saveSettings();
						renderStylePreview();
					}),
			);

		customPromptSetting.settingEl.addClass("tangent-custom-prompt-setting");
		if (this.plugin.settings.tangentStyle !== "custom") customPromptSetting.settingEl.hide();

		const renderStylePreview = this.addPreview(customPromptSetting.settingEl, () => {
			switch (this.plugin.settings.tangentStyle) {
				case "research":
					return "## Summary\nQuantum entanglement is a phenomenon... ^summary\n\n## Background\nFirst described by Einstein, Podolsky, and Rosen in 1935...\n\n## Key Concepts\n- **Non-locality** — measurements on entangled particles...\n- **Bell's theorem** — proves no local hidden variable theory...\n\n## Applications\n...\n\n*~800 words, comprehensive with sections and detail*";
				case "template":
					return "## Summary\nQuantum entanglement connects particles across distance. ^summary\n\n## What I know\n- <!-- What do you already understand about this? -->\n\n## Open questions\n- How does decoherence affect entanglement in practice?\n- <!-- What else are you curious about? -->\n\n## Connections\n- Related to [[quantum computing]] — how?\n- <!-- What other ideas does this connect to? -->\n\n*Scaffolding with prompts for your own thinking*";
				case "short":
					return "## Summary\nQuantum entanglement is a phenomenon where particles become correlated such that measuring one instantly affects the other, regardless of distance. ^summary\n\n## Key points\n- Described by EPR paradox (1935)\n- Confirmed by Bell test experiments\n- Foundation of quantum computing and cryptography\n\n*~200 words, essentials only*";
				case "dynamic":
					return "The agent reads your topic and vault context to decide:\n- Simple concept → short note\n- Deep question → research paper\n- Exploratory prompt → template with thinking prompts\n\n*Adapts to what makes sense for the topic*";
				case "custom":
					return `*Your custom instructions:*\n\n> ${this.plugin.settings.customStylePrompt}`;
			}
		});

		// --- Note Titles ---
		containerEl.createEl("h3", { text: "Note Titles" });

		new Setting(containerEl)
			.setName("Note title")
			.setDesc("When to ask the agent to generate a concise title instead of using the raw prompt.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("when-long", "Only when prompt is too long")
					.addOption("always", "Always generate a title")
					.addOption("never", "Never (truncate if too long)")
					.setValue(this.plugin.settings.titleMode)
					.onChange(async (value: string) => {
						if (isOneOf(value, TITLE_MODES)) this.plugin.settings.titleMode = value;
						await this.plugin.saveSettings();
						renderTitlePreview();
					}),
			);

		const BANNED_CHARS = /[\\/:*?"<>|#^[\]]/;
		const titlePrefixSetting = new Setting(containerEl)
			.setName("Title prefix")
			.setDesc("Optional prefix added to all note titles.")
			.addText((text) => {
				const inputEl = text.inputEl;
				text
					.setPlaceholder("e.g. AI: ")
					.setValue(this.plugin.settings.titlePrefix)
					.onChange(async (value) => {
						if (BANNED_CHARS.test(value)) {
							inputEl.style.borderColor = "var(--text-error)";
							inputEl.title = 'Characters \\ / : * ? " < > | # ^ [ ] are not allowed';
							return;
						}
						inputEl.style.borderColor = "";
						inputEl.title = "";
						this.plugin.settings.titlePrefix = value;
						await this.plugin.saveSettings();
						renderTitlePreview();
					});
			});

		const renderTitlePreview = this.addPreview(titlePrefixSetting.settingEl, () => {
			const prefix = this.plugin.settings.titlePrefix.replace(/[\\/:*?"<>|#^[\]]/g, "");
			const shortPrompt = "chess";
			const longPrompt = "what is the relationship between quantum mechanics and consciousness";
			const generated = "Quantum Mechanics and Consciousness";
			const truncated = longPrompt.slice(0, 60) + "…";

			switch (this.plugin.settings.titleMode) {
				case "always":
					return (
						`Short prompt \`>>${shortPrompt}<<\`:\n` +
						`\`\`\`\n${prefix}Strategy and Beauty of Chess.md\n→ [[${prefix}Strategy and Beauty of Chess|${shortPrompt}]]\n\`\`\`\n\n` +
						`Long prompt \`>>${longPrompt.slice(0, 40)}…<<\`:\n` +
						`\`\`\`\n${prefix}${generated}.md\n→ [[${prefix}${generated}|${longPrompt}]]\n\`\`\`\n\n` +
						`*Agent always generates a concise title. Wikilink shows original prompt as alias.*`
					);
				case "when-long":
					return (
						`Short prompt \`>>${shortPrompt}<<\`:\n` +
						`\`\`\`\n${prefix}${shortPrompt}.md\n→ [[${prefix}${shortPrompt}]]\n\`\`\`\n\n` +
						`Long prompt \`>>${longPrompt.slice(0, 40)}…<<\`:\n` +
						`\`\`\`\n${prefix}${generated}.md\n→ [[${prefix}${generated}|${longPrompt}]]\n\`\`\`\n\n` +
						`*Short prompts become the title directly. Long prompts (>60 chars) get an agent-generated title.*`
					);
				case "never":
					return (
						`Short prompt \`>>${shortPrompt}<<\`:\n` +
						`\`\`\`\n${prefix}${shortPrompt}.md\n→ [[${prefix}${shortPrompt}]]\n\`\`\`\n\n` +
						`Long prompt \`>>${longPrompt.slice(0, 40)}…<<\`:\n` +
						`\`\`\`\n${prefix}${truncated}.md\n→ [[${prefix}${truncated}]]\n\`\`\`\n\n` +
						`*Prompt is always used as title, truncated to 60 chars if needed.*`
					);
			}
		});

		// --- Source Note ---
		containerEl.createEl("h3", { text: "Source Note" });
		const replacementSetting = new Setting(containerEl)
			.setName("Source note replacement")
			.setDesc("How to replace >>topic<< in the source note after the agent finishes.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("link", "Wikilink only")
					.addOption("both", "Wikilink + callout summary")
					.setValue(this.plugin.settings.replacementMode)
					.onChange(async (value: string) => {
						if (isOneOf(value, REPLACEMENT_MODES)) this.plugin.settings.replacementMode = value;
						await this.plugin.saveSettings();
						renderReplacementPreview();
					}),
			);

		const renderReplacementPreview = this.addPreview(replacementSetting.settingEl, () => {
			const title = "Why Tangent Uses Itself";
			const summary =
				"Tangent eats its own dog food — the plugin's documentation was generated by firing >>tangent internals<< inside its own development vault, creating a self-referential loop that stress-tests every output mode.";
			if (this.plugin.settings.replacementMode === "both") {
				return `I was thinking about [[${title}]] and it changed my perspective.\n\n> [!tangent] [[${title}]]\n> ${summary}`;
			}
			return `I was thinking about [[${title}]] and it changed my perspective.`;
		});

		// --- Generated Notes ---
		containerEl.createEl("h3", { text: "Generated Notes" });

		const wikilinkSetting = new Setting(containerEl)
			.setName("Wikilinks in generated notes")
			.setDesc("Control whether the agent creates [[links]] to existing notes, new notes, or neither.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("existing-only", "Existing notes only")
					.addOption("create-new", "Allow new note links")
					.addOption("none", "No wikilinks")
					.setValue(this.plugin.settings.wikilinkMode)
					.onChange(async (value: string) => {
						if (isOneOf(value, WIKILINK_MODES)) this.plugin.settings.wikilinkMode = value;
						await this.plugin.saveSettings();
						renderWikilinkPreview();
					}),
			);

		const renderWikilinkPreview = this.addPreview(wikilinkSetting.settingEl, () => {
			switch (this.plugin.settings.wikilinkMode) {
				case "existing-only":
					return "Obsidian's [[local-first architecture]] means your data never leaves your machine. Unlike [[cloud-based editors]], this gives you full ownership.";
				case "create-new":
					return "Obsidian's [[local-first architecture]] means your data never leaves your machine. Unlike [[cloud-based editors]], this gives you full [[data sovereignty]].";
				case "none":
					return "Obsidian's local-first architecture means your data never leaves your machine. Unlike cloud-based editors, this gives you full ownership.";
			}
		});

		// --- Frontmatter + tags + preview (combined) ---
		new Setting(containerEl)
			.setName("Add frontmatter")
			.setDesc("Add generated-by, tangent-source, tangent-prompt, and date properties to tangent notes.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addFrontmatter).onChange(async (value) => {
					this.plugin.settings.addFrontmatter = value;
					await this.plugin.saveSettings();
					renderFrontmatterPreview();
				}),
			);

		new Setting(containerEl)
			.setName("Add tags")
			.setDesc("Add tags to tangent notes for easy filtering.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addTags).onChange(async (value) => {
					this.plugin.settings.addTags = value;
					await this.plugin.saveSettings();
					tagsSetting.settingEl.toggle(value);
					renderFrontmatterPreview();
				}),
			);

		const tagsSetting = new Setting(containerEl)
			.setName("Tags")
			.setDesc("Comma-separated tags to add to tangent notes.")
			.addText((text) =>
				text
					.setPlaceholder("tangent, ai-generated")
					.setValue(this.plugin.settings.tags)
					.onChange(async (value) => {
						this.plugin.settings.tags = value;
						await this.plugin.saveSettings();
						renderFrontmatterPreview();
					}),
			);

		if (!this.plugin.settings.addTags) tagsSetting.settingEl.hide();

		const renderFrontmatterPreview = this.addPreview(tagsSetting.settingEl, () => {
			const hasFm = this.plugin.settings.addFrontmatter;
			const hasTags = this.plugin.settings.addTags;
			if (!hasFm && !hasTags) return "*No frontmatter will be added.*";

			const lines: string[] = ["```yaml", "---"];
			if (hasFm) {
				lines.push("generated-by: tangent");
				lines.push('tangent-source: "My Daily Note.md"');
				lines.push('tangent-prompt: "local-first architecture"');
				lines.push("date: 2026-03-02");
			}
			if (hasTags) {
				const tags = this.plugin.settings.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);
				if (tags.length > 0) {
					lines.push("tags:");
					for (const tag of tags) {
						lines.push(`  - ${tag}`);
					}
				}
			}
			lines.push("---", "```");
			return lines.join("\n");
		});
	}
}
