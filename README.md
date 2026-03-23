<p align="center">
  <img src="logo.png" alt="Obsidian Tangent" width="480">
</p>

<p align="center">
  An Obsidian plugin that sends Claude Code agents on thinking/writing/research tangents without leaving your flow.
</p>

---

- **Inline** — trigger lives in your sentence, not a sidebar or modal
- **Background** — the agent researches while you keep typing
- **Vault-aware** — reads your existing notes and links back to them
- **Invisible when done** — `>>marker<<` disappears into a clean `[[wikilink]]`
- **Your garden, your rules** — AI notes live in their own folder with clear attribution

## Install

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated. Desktop only.

### BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) if you haven't
2. Add beta plugin: `pro-vi/obsidian-tangent`
3. Enable **Tangent** in Settings → Community plugins

### Manual

1. Download `main.js`, `styles.css`, `manifest.json` from the [latest release](https://github.com/pro-vi/obsidian-tangent/releases)
2. Copy to `your-vault/.obsidian/plugins/obsidian-tangent/`
3. Enable **Tangent** in Settings → Community plugins

## How it works

```
You write:     "I've been thinking about >>emergent behavior in ant colonies<< lately."

Agent runs:    reads vault → searches web → generates content → plugin writes note

You get:       "I've been thinking about [[Emergent Ant Colony Behavior|emergent behavior in ant colonies]] lately."
                                         └─ new note in Tangents/ folder
```

## Security

Claude can **read** your vault but never **write** to it. The agent runs with a strict tool whitelist (`Read`, `Glob`, `Grep`, and optionally `WebSearch`/`WebFetch`) — all read-only. Note creation and file edits go through Obsidian's vault API on the plugin side, not through Claude.

## Triggers

| Method | How |
|--------|-----|
| **Auto** | Fires when you type the closing `<<` (default: on) |
| **Command** | `Process all >>tangent<< markers in current note` |
| **Selection** | Select text → right-click → *Create tangent from selection* |
| **Quick tangent** | Command palette → type a topic directly |

## Development

```bash
pnpm run dev      # watch mode
pnpm run build    # typecheck + production build
pnpm test         # vitest
pnpm lint         # eslint
pnpm format       # prettier
```

## License

[MIT](LICENSE)
