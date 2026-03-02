/**
 * Track >>topic<< markers by occurrence per topic, so:
 * - First scan is initialization (nothing is "new")
 * - Duplicate topics are tracked independently
 * - Offset shifts from typing don't cause false positives
 */

interface MarkerOccurrence {
	topic: string;
	offset: number;
}

export class MarkerTracker {
	/** Per-file list of known marker occurrences */
	private known = new Map<string, MarkerOccurrence[]>();

	/**
	 * Update the tracker with current markers for a file.
	 * Returns only genuinely new markers (not previously known).
	 * On the first call for a file, returns [] (initialization).
	 */
	update(filePath: string, markers: MarkerOccurrence[]): MarkerOccurrence[] {
		const previousMarkers = this.known.get(filePath);
		const isFirstScan = previousMarkers === undefined;
		this.remember(filePath, markers);

		if (isFirstScan) return [];

		const newMarkers: MarkerOccurrence[] = [];
		const previousByTopic = this.groupByTopic(previousMarkers);
		const currentByTopic = this.groupByTopic(markers);

		for (const [topic, currentOccurrences] of currentByTopic) {
			const previousOccurrences = previousByTopic.get(topic) ?? [];
			if (previousOccurrences.length === 0) {
				newMarkers.push(...currentOccurrences);
				continue;
			}
			if (currentOccurrences.length <= previousOccurrences.length) {
				continue;
			}

			const matchedCurrent = this.matchCurrentIndices(previousOccurrences, currentOccurrences);
			for (let i = 0; i < currentOccurrences.length; i++) {
				if (!matchedCurrent.has(i)) {
					newMarkers.push(currentOccurrences[i]!);
				}
			}
		}

		return newMarkers;
	}

	/** Replace the known state for a file with the current marker scan. */
	remember(filePath: string, markers: MarkerOccurrence[]): void {
		this.known.set(
			filePath,
			markers.map((marker) => ({ ...marker })),
		);
	}

	private groupByTopic(markers: MarkerOccurrence[]): Map<string, MarkerOccurrence[]> {
		const grouped = new Map<string, MarkerOccurrence[]>();
		for (const marker of markers) {
			const group = grouped.get(marker.topic);
			if (group) {
				group.push(marker);
			} else {
				grouped.set(marker.topic, [marker]);
			}
		}
		return grouped;
	}

	/**
	 * Match previous occurrences to the best-aligned current occurrences.
	 * Unmatched current indices are genuinely new markers.
	 */
	private matchCurrentIndices(previous: MarkerOccurrence[], current: MarkerOccurrence[]): Set<number> {
		const prevOffsets = previous.map((marker) => marker.offset);
		const currOffsets = current.map((marker) => marker.offset);
		const rows = prevOffsets.length + 1;
		const cols = currOffsets.length + 1;
		const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(Number.POSITIVE_INFINITY));
		const choice = Array.from({ length: rows }, () => Array<"skip" | "match" | null>(cols).fill(null));

		for (let col = 0; col < cols; col++) {
			dp[0]![col] = 0;
		}

		for (let row = 1; row < rows; row++) {
			for (let col = 1; col < cols; col++) {
				const skipCost = dp[row]![col - 1]!;
				const matchCost = dp[row - 1]![col - 1]! + Math.abs(prevOffsets[row - 1]! - currOffsets[col - 1]!);

				if (matchCost <= skipCost) {
					dp[row]![col] = matchCost;
					choice[row]![col] = "match";
				} else {
					dp[row]![col] = skipCost;
					choice[row]![col] = "skip";
				}
			}
		}

		const matchedCurrent = new Set<number>();
		let row = rows - 1;
		let col = cols - 1;

		while (row > 0 && col > 0) {
			const decision = choice[row]![col];
			if (decision === "match") {
				matchedCurrent.add(col - 1);
				row--;
				col--;
			} else {
				col--;
			}
		}

		return matchedCurrent;
	}
}
