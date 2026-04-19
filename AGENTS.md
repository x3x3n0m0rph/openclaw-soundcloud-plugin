# AGENTS.md

## Project

This repository contains an OpenClaw plugin that registers the `soundcloud` agent tool.

The tool downloads a SoundCloud URL through `x3x3n0m0rph/soundcloud-dl`, then sends the resulting file with:

```powershell
openclaw message send --channel telegram --target <target> --media <file>
```

## Development Rules

- Keep the plugin as a small TypeScript ESM package.
- Prefer OpenClaw public SDK imports such as `openclaw/plugin-sdk/plugin-entry`.
- Do not introduce shell command construction. Use OpenClaw runtime helpers for any required command execution.
- Treat user-provided URLs, Telegram targets, and downloader arguments as untrusted.
- Keep config documented in `openclaw.plugin.json` and `README.md`.
- Run `npm run check` before handing off changes.

## External Requirements

- Node.js 22 or newer.
- OpenClaw CLI available as `openclaw`, unless `openclawCommand` is configured.
- `x3x3n0m0rph/soundcloud-dl`, unless `downloaderCommand` is configured.
- Telegram channel configured in OpenClaw.
