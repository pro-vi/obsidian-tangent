import { ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * Regex to match >>topic<< syntax.
 * Requires at least one non-whitespace char before >> to avoid blockquote conflict.
 * Also matches >> at position 0 only if preceded by nothing (handled by shouldSkip).
 */
const TANGENT_RE = />>([^<>]+)<</g;

/**
 * Check if a match should be skipped:
 * - >> at column 0 (blockquote conflict)
 * - inside inline backtick code spans
 */
function shouldSkipMatch(lineText: string, matchIndex: number): boolean {
	// Skip >> at the very start of a line (conflicts with > > blockquote)
	if (matchIndex === 0) return true;

	// Skip if only whitespace before >> (indented blockquote)
	const before = lineText.slice(0, matchIndex);
	if (/^\s*$/.test(before)) return true;

	// Skip if inside inline backtick code span
	// Count unescaped backticks before the match position
	let inCode = false;
	for (let i = 0; i < matchIndex; i++) {
		if (lineText[i] === "`") {
			inCode = !inCode;
		}
	}
	if (inCode) return true;

	return false;
}

/**
 * Check if a position is inside a code block by scanning for ``` fences.
 */
function isInsideCodeBlock(
	doc: { line(n: number): { text: string }; lineAt(pos: number): { number: number } },
	pos: number,
): boolean {
	const lineNum = doc.lineAt(pos).number;
	let inCode = false;
	for (let i = 1; i < lineNum; i++) {
		if (doc.line(i).text.trimStart().startsWith("```")) {
			inCode = !inCode;
		}
	}
	return inCode;
}

/**
 * Decoration plugin that highlights >>topic<< markers in the editor.
 * Only scans visible viewport ranges for performance.
 */
export const tangentDecorationPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();
			const doc = view.state.doc;

			for (const { from, to } of view.visibleRanges) {
				const startLine = doc.lineAt(from).number;
				const endLine = doc.lineAt(to).number;

				for (let i = startLine; i <= endLine; i++) {
					const line = doc.line(i);

					if (isInsideCodeBlock(doc, line.from)) continue;
					if (line.text.trimStart().startsWith("```")) continue;

					let match;
					TANGENT_RE.lastIndex = 0;

					while ((match = TANGENT_RE.exec(line.text)) !== null) {
						if (shouldSkipMatch(line.text, match.index)) continue;

						const mFrom = line.from + match.index;
						const mTo = line.from + match.index + match[0].length;

						builder.add(mFrom, mTo, Decoration.mark({ class: "tangent-syntax" }));
					}
				}
			}

			return builder.finish();
		}
	},
	{
		decorations: (v: { decorations: DecorationSet }) => v.decorations,
	},
);

/**
 * Find all >>topic<< markers in a document string.
 * Skips code blocks, inline code, and line-start >> (blockquote conflict).
 */
export function findTangentMarkers(text: string): Array<{ topic: string; from: number; to: number }> {
	const results: Array<{ topic: string; from: number; to: number }> = [];
	let match;

	const lines = text.split("\n");
	let inCode = false;
	let offset = 0;

	for (const line of lines) {
		if (line.trimStart().startsWith("```")) {
			inCode = !inCode;
		}

		if (!inCode) {
			TANGENT_RE.lastIndex = 0;
			while ((match = TANGENT_RE.exec(line)) !== null) {
				if (shouldSkipMatch(line, match.index)) continue;
				results.push({
					topic: match[1]!,
					from: offset + match.index,
					to: offset + match.index + match[0].length,
				});
			}
		}

		offset += line.length + 1;
	}

	return results;
}
