import { describe, it, expect } from "vitest";
import { sanitizeTitle, parseTitle, replaceBoth, extractTitleFromPath, shouldResolveAgent } from "./title-utils";

// =============================================================================
// Issue 1: Banned chars regex is broken — unescaped [ ] inside character class
// =============================================================================
describe("sanitizeTitle — banned chars", () => {
	it("strips basic banned chars", () => {
		expect(sanitizeTitle('hello/world:test?"yes"')).toBe("helloworldtestyes");
	});

	it("strips # which has special meaning in wikilinks", () => {
		expect(sanitizeTitle("My #Topic")).toBe("My Topic");
	});

	it("strips ^ which has special meaning in block refs", () => {
		expect(sanitizeTitle("Topic ^ref")).toBe("Topic ref");
	});

	// THIS IS THE BUG: [ and ] should be stripped but the regex doesn't catch them
	it("strips [ and ] which break wikilinks", () => {
		expect(sanitizeTitle("Topic [with] brackets")).toBe("Topic with brackets");
	});

	it("strips \\ / : * ? < > |", () => {
		expect(sanitizeTitle('a\\b/c:d*e?f"g<h>i|j')).toBe("abcdefghij");
	});
});

// =============================================================================
// Issue 2: TITLE line leaks into note content when no # heading follows
// =============================================================================
describe("parseTitle — TITLE line extraction", () => {
	it("extracts TITLE and content with heading", () => {
		const raw = "TITLE: My Title\n\n# Heading\n\nBody text";
		const result = parseTitle(raw);
		expect(result.generatedTitle).toBe("My Title");
		expect(result.noteContent).toBe("# Heading\n\nBody text");
	});

	it("returns null title when no TITLE line", () => {
		const raw = "# Just a heading\n\nBody text";
		const result = parseTitle(raw);
		expect(result.generatedTitle).toBeNull();
		expect(result.noteContent).toBe("# Just a heading\n\nBody text");
	});

	// BUG: When agent outputs TITLE but no heading, the TITLE line stays in content
	it("strips TITLE line from content even when no # heading follows", () => {
		const raw = "TITLE: My Title\n\nJust a paragraph, no heading.";
		const result = parseTitle(raw);
		expect(result.generatedTitle).toBe("My Title");
		// Should NOT contain the TITLE line
		expect(result.noteContent).not.toContain("TITLE:");
		expect(result.noteContent).toBe("Just a paragraph, no heading.");
	});

	// BUG: Agent chatter before TITLE line — TITLE line and chatter leak into content
	it("strips TITLE line and preamble when heading follows", () => {
		const raw = "Sure, here's the note:\nTITLE: My Title\n\n# Heading\n\nBody";
		const result = parseTitle(raw);
		expect(result.generatedTitle).toBe("My Title");
		expect(result.noteContent).not.toContain("TITLE:");
		expect(result.noteContent).not.toContain("Sure, here");
		expect(result.noteContent).toBe("# Heading\n\nBody");
	});

	// BUG: Markdown formatting in title
	it("does not include markdown formatting in generated title", () => {
		const raw = "TITLE: **Bold Title**\n\n# Heading\n\nBody";
		const result = parseTitle(raw);
		// Currently this would return "**Bold Title**" — markdown chars in filename
		expect(result.generatedTitle).not.toContain("*");
		expect(result.generatedTitle).toBe("Bold Title");
	});

	// BUG: Control characters in title
	it("does not include control characters in generated title", () => {
		const raw = "TITLE: Title\twith\ttabs\n\n# Heading\n\nBody";
		const result = parseTitle(raw);
		expect(result.generatedTitle).not.toContain("\t");
	});

	it("does not include newlines in generated title", () => {
		// Edge case: \r\n line endings
		const raw = "TITLE: My Title\r\n\r\n# Heading\r\nBody";
		const result = parseTitle(raw);
		expect(result.generatedTitle).not.toContain("\r");
	});
});

// =============================================================================
// Issue 3: sanitizeTitle should also strip control chars
// =============================================================================
describe("sanitizeTitle — control characters", () => {
	it("strips tab characters", () => {
		expect(sanitizeTitle("Hello\tWorld")).toBe("Hello World");
	});

	it("strips newline characters", () => {
		expect(sanitizeTitle("Hello\nWorld")).toBe("Hello World");
	});

	it("strips carriage return", () => {
		expect(sanitizeTitle("Hello\rWorld")).toBe("Hello World");
	});

	it("strips null byte", () => {
		expect(sanitizeTitle("Hello\0World")).toBe("Hello World");
	});

	it("strips leading dots (hidden files)", () => {
		expect(sanitizeTitle(".hidden")).toBe("hidden");
	});

	it("strips trailing dots (Windows FS issue)", () => {
		expect(sanitizeTitle("title.")).toBe("title");
	});

	it("strips trailing spaces (Windows FS issue)", () => {
		expect(sanitizeTitle("title  ")).toBe("title");
	});
});

// =============================================================================
// Issue 4: parseTitle should strip markdown formatting from titles
// =============================================================================
describe("parseTitle — markdown stripping", () => {
	it("strips bold markers from title", () => {
		const raw = "TITLE: **Quantum Consciousness**\n\n# Heading";
		expect(parseTitle(raw).generatedTitle).toBe("Quantum Consciousness");
	});

	it("strips italic markers from title", () => {
		const raw = "TITLE: _Italic Title_\n\n# Heading";
		expect(parseTitle(raw).generatedTitle).toBe("Italic Title");
	});

	it("strips backtick markers from title", () => {
		const raw = "TITLE: `Code Title`\n\n# Heading";
		expect(parseTitle(raw).generatedTitle).toBe("Code Title");
	});

	it("strips heading prefix if agent puts # in TITLE", () => {
		const raw = "TITLE: # My Heading Title\n\n## Summary";
		expect(parseTitle(raw).generatedTitle).toBe("My Heading Title");
	});

	it("handles double-star bold with spaces", () => {
		const raw = "TITLE: ** Spaced Bold **\n\n# Heading";
		expect(parseTitle(raw).generatedTitle).toBe("Spaced Bold");
	});
});

// =============================================================================
// Bonus: "both" mode replacement — paragraph boundary edge cases
// =============================================================================
describe("replaceBoth — paragraph detection", () => {
	it("keeps wikilink inline and puts callout after paragraph", () => {
		const content = "Exploring >>chess<< today\n\nAnother paragraph.";
		const result = replaceBoth(content, "chess", "[[Chess]]", "Chess", "Summary text");
		expect(result).not.toBeNull();
		// Wikilink should be inline
		expect(result).toContain("Exploring [[Chess]] today");
		// Callout should be between paragraphs
		expect(result).toContain("today\n\n> [!tangent]");
		// Other paragraph should follow
		expect(result).toContain("\n\nAnother paragraph.");
	});

	it("appends callout at EOF when no blank line follows", () => {
		const content = "Exploring >>chess<< today";
		const result = replaceBoth(content, "chess", "[[Chess]]", "Chess", "Summary text");
		expect(result).not.toBeNull();
		expect(result).toContain("Exploring [[Chess]] today\n\n> [!tangent]");
	});

	it("does not break when marker is at very end of file", () => {
		const content = "Topic: >>chess<<";
		const result = replaceBoth(content, "chess", "[[Chess]]", "Chess", "Summary");
		expect(result).not.toBeNull();
		expect(result).toContain("Topic: [[Chess]]");
		expect(result).toContain("> [!tangent]");
	});

	it("handles marker in a list item", () => {
		const content = "- Item one\n- Exploring >>chess<< here\n- Item three\n\nNext section.";
		const result = replaceBoth(content, "chess", "[[Chess]]", "Chess", "Summary");
		expect(result).not.toBeNull();
		// Wikilink should stay inline in the list
		expect(result).toContain("- Exploring [[Chess]] here");
	});
});

// =============================================================================
// Issue 5: Collision-adjusted title — extractTitleFromPath
// =============================================================================
describe("extractTitleFromPath — collision suffix", () => {
	it("extracts title from simple path", () => {
		expect(extractTitleFromPath("Tangents/Chess.md")).toBe("Chess");
	});

	it("extracts title with collision suffix", () => {
		expect(extractTitleFromPath("Tangents/Chess (1).md")).toBe("Chess (1)");
	});

	it("extracts title with nested folders", () => {
		expect(extractTitleFromPath("Notes/Research/Tangents/Chess.md")).toBe("Chess");
	});

	it("extracts title with collision suffix (2)", () => {
		expect(extractTitleFromPath("Tangents/My Topic (2).md")).toBe("My Topic (2)");
	});

	it("handles root-level path", () => {
		expect(extractTitleFromPath("Chess.md")).toBe("Chess");
	});
});

// =============================================================================
// Issue 6: Non-zero exit with partial output — shouldResolveAgent
// =============================================================================
describe("shouldResolveAgent — exit code handling", () => {
	it("resolves on exit 0 with result text", () => {
		const result = shouldResolveAgent(0, "# Full result", "");
		expect(result.resolve).toBe(true);
		if (result.resolve) expect(result.text).toBe("# Full result");
	});

	it("resolves on exit 0 with only latest text", () => {
		const result = shouldResolveAgent(0, "", "# Partial text");
		expect(result.resolve).toBe(true);
		if (result.resolve) expect(result.text).toBe("# Partial text");
	});

	it("rejects on exit 0 with no output", () => {
		const result = shouldResolveAgent(0, "", "");
		expect(result.resolve).toBe(false);
		if (!result.resolve) expect(result.error).toContain("no output");
	});

	it("rejects on non-zero exit even with partial output", () => {
		const result = shouldResolveAgent(1, "", "# Some partial text before crash");
		expect(result.resolve).toBe(false);
		if (!result.resolve) expect(result.error).toContain("code 1");
	});

	it("rejects on non-zero exit even with result text", () => {
		const result = shouldResolveAgent(1, "# Full result somehow", "");
		expect(result.resolve).toBe(false);
		if (!result.resolve) expect(result.error).toContain("code 1");
	});

	it("rejects on signal kill (null exit code treated as success)", () => {
		// null exit code means process was killed by signal — treated as success if output exists
		const result = shouldResolveAgent(null, "# Some output", "");
		expect(result.resolve).toBe(true);
	});

	it("rejects on null exit code with no output", () => {
		const result = shouldResolveAgent(null, "", "");
		expect(result.resolve).toBe(false);
	});

	it("prefers resultText over latestText", () => {
		const result = shouldResolveAgent(0, "# Clean result", "# Partial junk");
		expect(result.resolve).toBe(true);
		if (result.resolve) expect(result.text).toBe("# Clean result");
	});

	it("trims whitespace from output", () => {
		const result = shouldResolveAgent(0, "  # Result  \n", "");
		expect(result.resolve).toBe(true);
		if (result.resolve) expect(result.text).toBe("# Result");
	});
});
