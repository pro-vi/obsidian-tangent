/**
 * Pure functions for title parsing, sanitization, and replacement logic.
 * Extracted from agent.ts and main.ts for testability.
 */

/** Characters banned in Obsidian note titles + control chars */
const BANNED_CHARS_REGEX = /[\\/:*?"<>|#\[\]^]/g;
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

/**
 * Sanitize a string for use as an Obsidian note title.
 * Strips banned chars, control chars, leading dots, trailing dots/spaces.
 */
export function sanitizeTitle(raw: string): string {
	return raw
		.replace(BANNED_CHARS_REGEX, "")
		.replace(CONTROL_CHARS_REGEX, " ")
		.replace(/^\.*/, "")
		.replace(/[. ]+$/, "")
		.trim();
}

/**
 * Strip markdown formatting from a title string.
 * Handles bold, italic, code, heading prefix.
 */
function cleanTitleMarkdown(title: string): string {
	return title
		.replace(/^#+\s*/, "") // leading # heading prefix
		.replace(/\*+/g, "") // bold/italic stars
		.replace(/_+/g, "") // italic underscores (only surrounding)
		.replace(/`/g, "") // backticks
		.trim();
}

/**
 * Parse a TITLE: line from agent output.
 * Returns the generated title (cleaned) and the remaining note content.
 */
export function parseTitle(raw: string): { generatedTitle: string | null; noteContent: string } {
	const titleMatch = raw.match(/(?:^|\n)TITLE:\s*(.+)/);
	let generatedTitle: string | null = null;

	if (titleMatch) {
		generatedTitle = cleanTitleMarkdown(titleMatch[1]!.trim());
		// Strip control chars from title
		generatedTitle = generatedTitle.replace(CONTROL_CHARS_REGEX, "").trim();
		if (!generatedTitle) generatedTitle = null;
	}

	// Determine note content: prefer first heading, but always strip TITLE line
	let noteContent: string;
	const headingIdx = raw.search(/^#\s/m);
	if (headingIdx >= 0) {
		noteContent = raw.slice(headingIdx);
	} else if (titleMatch) {
		// No heading found — strip the TITLE line and any leading blank lines
		const titleLineEnd = raw.indexOf("\n", titleMatch.index! + titleMatch[0].indexOf("TITLE:"));
		noteContent = titleLineEnd >= 0 ? raw.slice(titleLineEnd + 1).replace(/^\n+/, "") : "";
	} else {
		noteContent = raw;
	}

	return { generatedTitle, noteContent: noteContent.trim() };
}

/**
 * Extract the note title from a vault path (strips folder and .md extension).
 * Used after uniqueNotePath may have added a collision suffix like " (1)".
 */
export function extractTitleFromPath(notePath: string): string {
	return notePath.replace(/\.md$/, "").split("/").pop()!;
}

/**
 * Decide whether a Claude agent run should resolve (success) or reject (failure).
 * Non-zero exit always fails, even with partial output. Zero exit requires output.
 */
export function shouldResolveAgent(
	exitCode: number | null,
	resultText: string,
	latestText: string,
): { resolve: true; text: string } | { resolve: false; error: string } {
	if (exitCode !== 0 && exitCode !== null) {
		return { resolve: false, error: `Claude exited with code ${exitCode}` };
	}
	const finalText = resultText || latestText;
	if (finalText.trim()) {
		return { resolve: true, text: finalText.trim() };
	}
	return { resolve: false, error: "Claude produced no output" };
}

/**
 * Build the wikilink for a result, using alias syntax when title was auto-generated.
 */
export function buildWikilink(
	title: string,
	titleWasGenerated: boolean,
	originalPrompt?: string,
): string {
	if (titleWasGenerated && originalPrompt) {
		return `[[${title}|${originalPrompt}]]`;
	}
	return `[[${title}]]`;
}

/**
 * Replace a >>topic<< marker in content with a wikilink (link-only mode).
 */
export function replaceLinkOnly(content: string, topic: string, wikilink: string): string | null {
	const markerText = `>>${topic}<<`;
	const idx = content.indexOf(markerText);
	if (idx < 0) return null;
	return content.slice(0, idx) + wikilink + content.slice(idx + markerText.length);
}

/**
 * Replace a >>topic<< marker with inline wikilink + callout after paragraph ("both" mode).
 */
export function replaceBoth(
	content: string,
	topic: string,
	wikilink: string,
	title: string,
	summary: string,
): string | null {
	const markerText = `>>${topic}<<`;
	const idx = content.indexOf(markerText);
	if (idx < 0) return null;

	const summaryText = summary.replace(/\s*\^summary\s*$/, "");
	const summaryLines = summaryText
		.split(/\n/)
		.map((l) => `> ${l}`)
		.join("\n");
	const block = `\n\n> [!tangent] [[${title}]]\n${summaryLines}`;

	// Replace marker inline
	const inlined = content.slice(0, idx) + wikilink + content.slice(idx + markerText.length);

	// Find end of paragraph
	const afterMarker = idx + wikilink.length;
	const blankLineIdx = inlined.indexOf("\n\n", afterMarker);
	const insertPos = blankLineIdx >= 0 ? blankLineIdx : inlined.length;

	return inlined.slice(0, insertPos) + block + inlined.slice(insertPos);
}
