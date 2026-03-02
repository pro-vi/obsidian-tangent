import { describe, it, expect } from "vitest";
import { replaceMarkerByOffset } from "../core/replace-marker";

describe("replaceMarkerByOffset", () => {
	describe("P2: replace the correct occurrence", () => {
		it("replaces the marker at the given offset, not the first match", () => {
			const content = "First >>foo<< and second >>foo<< here.";
			const secondIdx = content.indexOf(">>foo<<", content.indexOf(">>foo<<") + 1);

			const result = replaceMarkerByOffset(content, "foo", secondIdx, "[[foo]]", "link");
			expect(result).toBe("First >>foo<< and second [[foo]] here.");
		});

		it("replaces the first occurrence when offset points to it", () => {
			const content = "First >>foo<< and second >>foo<< here.";
			const firstIdx = content.indexOf(">>foo<<");

			const result = replaceMarkerByOffset(content, "foo", firstIdx, "[[foo]]", "link");
			expect(result).toBe("First [[foo]] and second >>foo<< here.");
		});

		it("returns null when offset doesn't match a marker", () => {
			const content = "No marker here.";
			const result = replaceMarkerByOffset(content, "foo", 5, "[[foo]]", "link");
			expect(result).toBeNull();
		});

		it("in 'both' mode, inserts callout after the correct paragraph", () => {
			const content = "Para one >>foo<< end.\n\nPara two >>foo<< end.\n\nPara three.";
			const secondIdx = content.indexOf(">>foo<<", content.indexOf(">>foo<<") + 1);

			const result = replaceMarkerByOffset(
				content,
				"foo",
				secondIdx,
				"[[foo]]",
				"both",
				"A summary.",
			);
			// The callout should appear after para two, not after para one
			expect(result).toContain("Para one >>foo<< end.");
			expect(result).toContain("Para two [[foo]] end.");
			expect(result).toContain("> [!tangent]");
			// Callout should be between para two and para three
			const calloutIdx = result!.indexOf("> [!tangent]");
			const paraThreeIdx = result!.indexOf("Para three.");
			expect(calloutIdx).toBeLessThan(paraThreeIdx);
		});
	});
});
