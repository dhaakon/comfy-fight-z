# Agent harness: Claude Code and Codex

Comfy Fighter Z was built with coding agents driving ComfyUI, and the repository is laid out so that an agent can keep doing that unattended. The harness is four layers; both Claude Code and OpenAI Codex read all four.

| Layer | What it is | Who reads it |
| --- | --- | --- |
| `AGENTS.md` | The contract: folder layout, fictional-cast and spending rules, the engine's frame data, every pipeline decision with its date | Codex natively; Claude Code when the project loads it as instructions (or link it from `CLAUDE.md`, see below) |
| `HANDOFF.md`, `gameplay-audit.md`, `comfyui/docs/new-game-runbook.md`, `comfyui/docs/explainer-video.md` | History, the fight audit and the step-by-step runbooks an agent follows verbatim | Both, on demand |
| Project skill `comfy-fighter-z` | A one-page map of the commands, in `.agents/skills/comfy-fighter-z/SKILL.md` (Codex) and `.claude/skills/comfy-fighter-z/SKILL.md` (Claude Code); the two files are identical | Both, automatically when the task matches its description |
| The `comfy` skill family and the `comfy-mcp` server | ComfyUI know-how (CLI surface, debugging, relaying media) and a tool server for the local or cloud ComfyUI | Both, after `comfy skills install` and an MCP entry |

Every tool an agent calls is a plain Node command that writes files, so a run can be resumed from disk: `plan.json` holds the estimate, `pipeline.json` what ran, `review/` the contact sheets and flags. The only commands that spend money take `--approve-usd` and refuse below their estimate.

## Set up Claude Code

1. Install the comfy CLI and sign in to a workspace: `pip install comfy-cli`, then `comfy cloud login`.
2. Install the comfy skills into Claude Code and `AGENTS.md`-aware tools: `comfy skills install` (lists: `comfy`, `comfy-debug`, `comfy-relay`, `comfy-director`, `comfy-build`, `comfy-deploy`, `comfy-custom-nodes`). They land in `~/.claude/skills/`.
3. Add the MCP server: copy `.mcp.example.json` to `.mcp.json` (ignored by Git) or run `claude mcp add comfy-mcp -- comfy-mcp`. The server drives the ComfyUI at `127.0.0.1:8188` by default.
4. If your Claude Code does not pick up `AGENTS.md` as project instructions, create a `CLAUDE.md` containing `@AGENTS.md`.
5. The project skill in `.claude/skills/comfy-fighter-z/` is picked up from the checkout; nothing to install.

## Set up Codex

1. Steps 1 and 2 above; `comfy skills install` also writes the skills to `~/.agents/skills/`.
2. Codex reads `AGENTS.md` from the repository root and the project skill from `.agents/skills/comfy-fighter-z/`.
3. Add the MCP server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.comfy-mcp]
   command = "comfy-mcp"
   ```

## What an agent needs on the machine

- Node 22 and `npm ci` (Chromium for the strict export: `npx playwright install chromium`, or `PLAYWRIGHT_EXECUTABLE_PATH`).
- A running ComfyUI with the project node pack: `node comfyui/tools/install-comfy-nodes.cjs --base-directory <ComfyUI base>` then restart. An agent that cannot drive the Desktop app starts the same server headless; the exact command is in the runbook's prerequisites.
- A spending cap from the person who pays. The agent reports the estimate and waits for a yes before any `run`, `reroll` or add-on.
- Credentials stay in ignored files (`.env`, `*.pem`, `.mcp.json`); the teaser tool reads the ComfyUI API key from `.env` and never prints it.

## Typical agent sessions

- **A new game**: write a cast file → `new-game.cjs prepare` → approve → `run` → `review` (read the contact sheets) → `reroll` the flagged nodes → `export` → `install --slot`. Runbook: `comfyui/docs/new-game-runbook.md`.
- **A fight change**: edit `engine.js`, run `node build/tools/gameplay-probe.cjs` and `npm test`, compare with the targets in `build/test/gameplay-metrics.test.cjs`, then `npm run build`.
- **A video**: edit `comfyui/config/teaser.json`, price the narration, record with `capture-teaser.cjs`, cut with `compose-explainer.cjs`, publish with `build/tools/publish-release-video.cjs` (it borrows the git credential at run time).
- **The public site**: `build/deploy/README.md`; only the fictional games ship.

## Keeping the harness current

When a command, flag or rule changes, update `AGENTS.md` in the same commit, and the runbook or the project skill if the change is one an agent would type. Both copies of `SKILL.md` must stay identical; `npm test` checks that.
