import { describe, it, expect } from "vitest";
import { MarkerTracker } from "../core/marker-tracking";

describe("MarkerTracker", () => {
	describe("P1: occurrence-based tracking", () => {
		it("treats first scan as initialization — no markers are new", () => {
			const tracker = new MarkerTracker();
			const markers = [
				{ topic: "foo", offset: 10 },
				{ topic: "bar", offset: 50 },
			];
			const newMarkers = tracker.update("note.md", markers);
			expect(newMarkers).toEqual([]);
		});

		it("detects a genuinely new marker on subsequent scan", () => {
			const tracker = new MarkerTracker();
			tracker.update("note.md", [{ topic: "foo", offset: 10 }]);

			const newMarkers = tracker.update("note.md", [
				{ topic: "foo", offset: 10 },
				{ topic: "bar", offset: 50 },
			]);
			expect(newMarkers).toEqual([{ topic: "bar", offset: 50 }]);
		});

		it("detects a second >>foo<< as new when one already exists", () => {
			const tracker = new MarkerTracker();
			tracker.update("note.md", [{ topic: "foo", offset: 10 }]);

			const newMarkers = tracker.update("note.md", [
				{ topic: "foo", offset: 10 },
				{ topic: "foo", offset: 80 },
			]);
			expect(newMarkers).toEqual([{ topic: "foo", offset: 80 }]);
		});

		it("detects a duplicate marker inserted before an existing occurrence", () => {
			const tracker = new MarkerTracker();
			tracker.update("note.md", [{ topic: "foo", offset: 100 }]);

			const newMarkers = tracker.update("note.md", [
				{ topic: "foo", offset: 50 },
				{ topic: "foo", offset: 108 },
			]);
			expect(newMarkers).toEqual([{ topic: "foo", offset: 50 }]);
		});

		it("handles offset shifts from typing before existing markers", () => {
			const tracker = new MarkerTracker();
			tracker.update("note.md", [{ topic: "foo", offset: 10 }]);

			// User typed 5 chars before it, shifting offset to 15 — this is NOT new
			const newMarkers = tracker.update("note.md", [{ topic: "foo", offset: 15 }]);
			expect(newMarkers).toEqual([]);
		});

		it("tracks files independently", () => {
			const tracker = new MarkerTracker();
			tracker.update("a.md", [{ topic: "foo", offset: 10 }]);
			tracker.update("b.md", [{ topic: "bar", offset: 10 }]);

			const newA = tracker.update("a.md", [
				{ topic: "foo", offset: 10 },
				{ topic: "baz", offset: 50 },
			]);
			expect(newA).toEqual([{ topic: "baz", offset: 50 }]);

			const newB = tracker.update("b.md", [{ topic: "bar", offset: 10 }]);
			expect(newB).toEqual([]);
		});

		it("can seed the tracker with the full current file state", () => {
			const tracker = new MarkerTracker();
			tracker.remember("note.md", [
				{ topic: "foo", offset: 10 },
				{ topic: "bar", offset: 40 },
			]);

			const newMarkers = tracker.update("note.md", [
				{ topic: "foo", offset: 10 },
				{ topic: "bar", offset: 40 },
				{ topic: "baz", offset: 90 },
			]);
			expect(newMarkers).toEqual([{ topic: "baz", offset: 90 }]);
		});
	});
});
