/**
 * Pure string replacement of a >>topic<< marker at a specific offset.
 * Returns the new content string, or null if the offset doesn't match.
 */
export function replaceMarkerByOffset(
	content: string,
	topic: string,
	offset: number,
	wikilink: string,
	mode: "link" | "both",
	summary?: string,
	calloutLink: string = wikilink,
): string | null {
	const markerText = `>>${topic}<<`;

	// Verify the marker actually exists at this offset
	if (content.slice(offset, offset + markerText.length) !== markerText) {
		return null;
	}

	if (mode === "link") {
		return content.slice(0, offset) + wikilink + content.slice(offset + markerText.length);
	}

	// "both" — replace marker inline, then insert callout after the paragraph
	const summaryText = (summary || "").replace(/\s*\^summary\s*$/, "");
	const summaryLines = summaryText
		.split(/\n/)
		.map((l: string) => `> ${l}`)
		.join("\n");
	const block = `\n\n> [!tangent] ${calloutLink}\n${summaryLines}`;

	const inlined = content.slice(0, offset) + wikilink + content.slice(offset + markerText.length);

	// Find end of the paragraph containing the marker
	const afterMarker = offset + wikilink.length;
	const blankLineIdx = inlined.indexOf("\n\n", afterMarker);
	const insertPos = blankLineIdx >= 0 ? blankLineIdx : inlined.length;

	return inlined.slice(0, insertPos) + block + inlined.slice(insertPos);
}
