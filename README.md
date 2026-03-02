# Tangent

An Obsidian plugin for AI-assisted research. Type `>>quantum entanglement<<` in any note and a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agent reads your vault, searches the web, and writes a structured note — with live progress while it works.

<!-- TODO: hero screenshot or GIF -->
<!-- ![Tangent in action](docs/demo.gif) -->

## Philosophy

Your vault is yours. Tangent keeps it that way — your notes stay human-centric, your writing flow uninterrupted. When you hit a concept worth exploring, mark it and keep writing. The AI dives deeper in the background: researching, building connections with your existing notes, producing structured output — all without breaking your thought stream.

AI tangents live in their own corner of the vault, easily managed via a dedicated folder, customizable frontmatter, tags, and prompts. They contribute to your vault without taking over.

## Usage

Type `>>your topic here<<` anywhere in a note. The marker lights up, and when triggered, an agent:

1. Creates a placeholder note with live status (which files it's reading, which pages it's fetching)
2. Streams the finished note as it's written — headings, summary, wikilinks to existing vault notes
3. Replaces the `>>marker<<` in your source note with a `[[wikilink]]` to the result

| Trigger | How |
|---------|-----|
| **Auto** | Fires when you type the closing `<<` (on by default) |
| **Command** | `Process all >>tangent<< markers in current note` |
| **Right-click** | Context menu on markers or selected text |
| **Quick tangent** | Command palette modal — type a topic directly |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Claude CLI path** | auto-detect | Path to the `claude` binary. Leave empty to detect from shell. |
| **Tangent folder** | `Tangents` | Folder where generated notes are created |
| **Model** | Sonnet | Claude model (Sonnet, Opus, Haiku) |
| **Auto-trigger** | On | Fire the agent when `<<` is typed |
| **Web research** | On | Allow the agent to search the web |
| **Tangent style** | Dynamic | Research, Template, Short, Dynamic, or Custom |
| **Custom prompt** | *(visible when Custom)* | Your own instructions for the agent |
| **Note title** | When long | Generate concise titles for prompts over 60 characters |
| **Title prefix** | *(empty)* | Prefix added to all generated note titles |
| **Source replacement** | Link only | `[[wikilink]]` only, or wikilink + callout summary |
| **Wikilinks in notes** | Existing only | Link to existing vault notes, allow new links, or none |
| **Frontmatter** | On | Add metadata (source file, prompt, date) |
| **Tags** | On | Configurable tags (default: `tangent`, `ai-generated`) |

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Obsidian desktop (the plugin spawns local processes — no mobile support)

## Installation

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/pro-vi/obsidian-tangent/releases)
2. Create `your-vault/.obsidian/plugins/obsidian-tangent/`
3. Copy the three files into that folder
4. Enable **Tangent** in Settings → Community plugins

### From source

```bash
git clone https://github.com/pro-vi/obsidian-tangent
cd obsidian-tangent
pnpm install
pnpm run build
```

Copy `main.js`, `styles.css`, and `manifest.json` to your vault's plugin directory.

## Development

```bash
pnpm run dev      # watch mode
pnpm run build    # typecheck + minify
pnpm lint         # eslint
pnpm format       # prettier
```

## License

[MIT](LICENSE)
