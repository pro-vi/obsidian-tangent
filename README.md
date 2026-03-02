# Tangent

An Obsidian plugin that sends [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents on research missions — without leaving your note.

Type `>>quantum entanglement<<` inline, keep writing. In the background, an agent reads your vault, searches the web, and writes a structured note with live progress. When it's done, the marker becomes a `[[wikilink]]`.

<!-- TODO: hero screenshot or GIF -->
<!-- ![Tangent in action](docs/demo.gif) -->

## How it works

```
You write:     "I've been thinking about >>emergent behavior in ant colonies<< lately."

Agent runs:    reads vault → searches web → writes note → generates concise title

You get:       "I've been thinking about [[Emergent Ant Colony Behavior|emergent behavior in ant colonies]] lately."
                                         └─ new note in Tangents/ folder
```

The agent creates a structured markdown note with headings, a summary, and wikilinks to your existing notes. Your source note gets a clean link (and optionally a callout with the summary).

## Triggers

| Method | How |
|--------|-----|
| **Auto** | Fires when you type the closing `<<` (default: on) |
| **Command** | `Process all >>tangent<< markers in current note` |
| **Selection** | Select text → right-click → *Create tangent from selection* |
| **Quick tangent** | Command palette → type a topic directly |

## Smart titles

Short prompts like `>>chess<<` become `[[chess]]` — no rename needed.

Long prompts like `>>what is the relationship between quantum mechanics and consciousness<<` get a concise agent-generated title: `[[Quantum Mechanics and Consciousness|what is the relationship...]]`. The alias preserves your original inline text.

Configurable: *always* generate titles, only *when long* (default), or *never*.

## Settings

### Agent behavior

| Setting | Default | |
|---------|---------|---|
| Claude CLI path | auto-detect | Path to `claude` binary |
| Model | Sonnet | Sonnet, Opus, Haiku |
| Permission mode | Default | Default, Accept edits, or Bypass |
| Auto-trigger | On | Fire agent when `<<` is typed |
| Web research | On | Allow web search/fetch |
| Tangent style | Dynamic | Research, Template, Short, Dynamic, or Custom |

### Note titles

| Setting | Default | |
|---------|---------|---|
| Title mode | When long | Always / when-long / never generate titles |
| Title prefix | *(empty)* | Prefix for all note titles (e.g. `AI:`) |

### Source note

| Setting | Default | |
|---------|---------|---|
| Replacement mode | Link only | `[[link]]` only, or link + callout summary |

### Generated notes

| Setting | Default | |
|---------|---------|---|
| Tangent folder | `Tangents` | Where notes are created |
| Wikilinks | Existing only | Link to existing notes, create new, or none |
| Frontmatter | On | Source, prompt, date metadata |
| Tags | On | Default: `tangent`, `ai-generated` |

## Philosophy

Your vault is yours. Tangent keeps it that way.

When you hit a concept worth exploring, mark it and keep writing. The agent researches in the background — reading your existing notes, optionally searching the web, producing structured output. Your writing flow stays unbroken.

AI-generated notes live in their own folder with clear attribution (frontmatter, tags). They contribute to your vault without taking it over.

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` in your PATH)
- Obsidian desktop (the plugin spawns local processes — no mobile support)

## Install

### BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) if you haven't
2. Add beta plugin: `pro-vi/obsidian-tangent`
3. Enable **Tangent** in Settings → Community plugins

### Manual

1. Download `main.js`, `styles.css`, `manifest.json` from the [latest release](https://github.com/pro-vi/obsidian-tangent/releases)
2. Create `your-vault/.obsidian/plugins/obsidian-tangent/`
3. Copy the three files in
4. Enable **Tangent** in Settings → Community plugins

### From source

```bash
git clone https://github.com/pro-vi/obsidian-tangent
cd obsidian-tangent
pnpm install
pnpm run build
```

Copy `main.js`, `styles.css`, `manifest.json` to your vault's plugin directory.

## Development

```bash
pnpm run dev      # watch mode
pnpm run build    # typecheck + production build
pnpm test         # vitest (42 unit tests)
pnpm lint         # eslint
pnpm format       # prettier
```

## License

[MIT](LICENSE)
