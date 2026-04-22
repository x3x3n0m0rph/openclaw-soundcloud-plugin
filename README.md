# OpenClaw SoundCloud Plugin
![Sound Cloud](https://img.shields.io/badge/sound%20cloud-FF5500?style=for-the-badge&logo=soundcloud&logoColor=white)
[![AI Slop Inside](https://sladge.net/badge.svg)](https://sladge.net)

OpenClaw plugin that registers a `soundcloud` agent tool.

The tool downloads a SoundCloud URL with [`x3x3n0m0rph/soundcloud-dl`](https://github.com/x3x3n0m0rph/soundcloud-dl) and returns the path to the downloaded audio file.

## Requirements

- Node.js 22 or newer.
- `soundcloud-dl` available in `PATH`, unless `downloaderCommand` is configured.

The upstream README shows this CLI shape:

```powershell
<binary> <url> [flags]
```

and this download directory flag:

```powershell
<binary> <url> --download-path <dir>
```

Install from source:

```powershell
go install github.com/x3x3n0m0rph/soundcloud-dl@latest
```

## Install

From this repository:

```powershell
npm install
openclaw plugins install -l .
openclaw plugins enable soundcloud
```

Restart the OpenClaw Gateway after enabling or changing plugin config.

## Configure

Minimal config:

```json5
{
  plugins: {
    entries: {
      soundcloud: {
        enabled: true,
        config: {}
      }
    }
  }
}
```

With explicit downloader options:

```json5
{
  plugins: {
    entries: {
      soundcloud: {
        enabled: true,
        config: {
          downloaderCommand: "soundcloud-dl",
          downloadPathFlag: "--download-path",
          downloaderArgs: ["--best"],
          downloaderForce: false,
          downloaderSocksProxy: "",
          tempRoot: "/tmp/openclaw-soundcloud",
          timeoutSeconds: 600,
          maxFileBytes: 52428800
        }
      }
    }
  }
}
```

## Tool Parameters

`soundcloud` accepts:

- `url`: SoundCloud URL to download.
- `timeoutSeconds`: optional timeout for the download command.

Example agent tool call payload:

```json
{
  "url": "https://soundcloud.com/artist/track",
  "message": "Track from SoundCloud"
}
```

## Downloader Command

By default the plugin runs:

```powershell
soundcloud-dl <url> --download-path <temp-media-dir> [--force] [--socks-proxy <proxy>] --best
```

`<temp-media-dir>` is a unique directory created for each tool call under `tempRoot`. If `tempRoot` is not configured, the plugin uses the OS temp directory and creates directories like:

```text
%TEMP%/openclaw-soundcloud/media-...
```

The plugin recursively scans that per-call directory and returns the newest completed file path.

You can replace `downloaderArgs` in plugin config. Arguments are passed directly to the downloader process after URL and `--download-path`; no shell string is built.

`downloaderForce` and `downloaderSocksProxy` map directly to the corresponding CLI flags from your fork.

## Security Notes

- The plugin only allows `soundcloud.com`, `on.soundcloud.com`, and `m.soundcloud.com` by default.
- Commands are launched through the OpenClaw system runtime helper rather than direct process spawning.
- Downloaded files are stored in an isolated per-call directory under `tempRoot`.

## Development

```powershell
npm install
npm run check
npm run pack:dry
```

## License

MIT
