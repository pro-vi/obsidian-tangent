import type { TangentSettings } from "../settings";

/**
 * Return the style-specific prompt lines for the given tangent style.
 */
export function getStylePrompt(style: TangentSettings["tangentStyle"], customPrompt?: string): string[] {
	switch (style) {
		case "research":
			return [
				`- Be thorough and detailed — around 800 words. Cover the topic comprehensively.`,
				`- Use multiple ## sections: Background, Key Concepts, Examples, Applications, etc.`,
				`- Include specific details, dates, names, and evidence where relevant.`,
			];
		case "template":
			return [
				`- Create a thinking template — around 300 words of scaffolding.`,
				`- Include a brief overview, then sections with HTML comments as prompts for the user to fill in.`,
				`- Use sections like: "## What I know", "## Open questions", "## Connections".`,
				`- Each section should have 1-2 starter bullets plus <!-- comment prompts --> for the user to add their own thinking.`,
				`- The goal is to help the user think, not to give them a finished product.`,
			];
		case "short":
			return [
				`- Keep it brief — around 200 words. Cover only the essentials.`,
				`- A summary paragraph, then a single "## Key points" section with a short bulleted list.`,
			];
		case "custom":
			return [customPrompt || "Write a note that captures the essence of this topic in your own style."].map(
				(line) => `- ${line}`,
			);
		default:
			// dynamic — let the agent decide
			return [
				`- Decide the appropriate depth based on the topic:`,
				`  - Simple factual concept → short note (~200 words, summary + key points)`,
				`  - Deep or nuanced question → comprehensive research (~800 words, multiple sections)`,
				`  - Exploratory or personal prompt → thinking template with prompts for the user to fill in`,
				`- Use your judgment about what would be most useful for this specific topic.`,
			];
	}
}
