# AGENTS.md

## Project

This repository contains an OpenClaw plugin that registers the `soundcloud` agent tool.

The tool downloads a SoundCloud URL through `x3x3n0m0rph/soundcloud-dl` and returns the path to the downloaded file.

## Development Rules

- Keep the plugin as a small TypeScript ESM package.
- Prefer OpenClaw public SDK imports such as `openclaw/plugin-sdk/plugin-entry`.
- Do not introduce shell command construction. Use OpenClaw runtime helpers for any required command execution.
- Treat user-provided URLs and downloader arguments as untrusted.
- Keep config documented in `openclaw.plugin.json` and `README.md`.
- Run `npm run check` before handing off changes.

## External Requirements

- Node.js 22 or newer.
- `x3x3n0m0rph/soundcloud-dl`, unless `downloaderCommand` is configured.
