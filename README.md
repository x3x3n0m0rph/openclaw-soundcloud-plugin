# OpenClaw SoundCloud Plugin

OpenClaw plugin that registers a `soundcloud` agent tool.

The tool downloads a SoundCloud URL with [`psylo-dev/soundcloud-dl`](https://github.com/psylo-dev/soundcloud-dl), then sends the resulting audio file to a selected Telegram user or chat through OpenClaw:

```powershell
openclaw message send --channel telegram --target <target> --media <file>
```

This means Telegram delivery happens from the configured OpenClaw Telegram channel, not from a separate bot in this plugin.

## Requirements

- Node.js 22 or newer.
- OpenClaw with Telegram configured.
- `openclaw` CLI available in `PATH`, unless `openclawCommand` is configured.
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
go install github.com/psylo-dev/soundcloud-dl@latest
```

On Windows, avoid configuring the command as bare `sc`: that usually resolves to `C:\Windows\system32\sc.exe`, the Service Control utility. Use `soundcloud-dl` or a full path to the downloaded binary.

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
        config: {
          telegramTarget: "@target_user"
        }
      }
    }
  }
}
```

With explicit commands and account:

```json5
{
  plugins: {
    entries: {
      soundcloud: {
        enabled: true,
        config: {
          telegramTarget: "123456789",
          telegramAccount: "default",
          downloaderCommand: "soundcloud-dl",
          downloadPathFlag: "--download-path",
          downloaderArgs: ["--best"],
          openclawCommand: "openclaw",
          tempRoot: "C:/Temp/openclaw-soundcloud",
          timeoutSeconds: 600,
          maxFileBytes: 52428800,
          keepDownloadedFiles: false
        }
      }
    }
  }
}
```

## Tool Parameters

`soundcloud` accepts:

- `url`: SoundCloud URL to download.
- `telegramTarget`: optional Telegram chat id or `@username`; overrides plugin config.
- `telegramAccount`: optional OpenClaw Telegram account id; overrides plugin config.
- `message`: optional caption/message sent with the file.
- `timeoutSeconds`: optional timeout for the download and send commands.

Example agent tool call payload:

```json
{
  "url": "https://soundcloud.com/artist/track",
  "telegramTarget": "@target_user",
  "message": "Track from SoundCloud"
}
```

## Downloader Command

By default the plugin runs:

```powershell
soundcloud-dl <url> --download-path <temp-media-dir> --best
```

`<temp-media-dir>` is a unique directory created for each tool call under `tempRoot`. If `tempRoot` is not configured, the plugin uses the OS temp directory and creates directories like:

```text
%TEMP%/openclaw-soundcloud/media-...
```

The plugin recursively scans that per-call directory and sends the newest completed file through OpenClaw Telegram media sending.

You can replace `downloaderArgs` in plugin config. Arguments are passed directly to the downloader process after URL and `--download-path`; no shell string is built.

## Security Notes

- The plugin only allows `soundcloud.com`, `on.soundcloud.com`, and `m.soundcloud.com` by default.
- Commands are launched with `spawn(..., { shell: false })`.
- Downloaded files are stored in an isolated per-call directory and removed after sending unless `keepDownloadedFiles` is true.
- Use Telegram allowlists and OpenClaw approval policies appropriate for your Gateway.

## Development

```powershell
npm install
npm run check
npm run pack:dry
```

## License

MIT
