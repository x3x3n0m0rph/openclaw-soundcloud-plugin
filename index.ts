import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

type PluginConfig = {
  telegramTarget?: string;
  telegramAccount?: string;
  downloaderCommand?: string;
  downloaderArgs?: string[];
  downloadPathFlag?: string;
  downloaderForce?: boolean;
  downloaderSocksProxy?: string;
  openclawCommand?: string;
  timeoutSeconds?: number;
  maxFileBytes?: number;
  keepDownloadedFiles?: boolean;
  tempRoot?: string;
  allowedHosts?: string[];
};

type SoundCloudParams = {
  url: string;
  telegramTarget?: string;
  telegramAccount?: string;
  message?: string;
  timeoutSeconds?: number;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type DownloadedFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

const defaultConfig = {
  downloaderCommand: "soundcloud-dl",
  downloaderArgs: ["--best"],
  downloadPathFlag: "--download-path",
  downloaderForce: false,
  downloaderSocksProxy: "",
  openclawCommand: "openclaw",
  timeoutSeconds: 600,
  maxFileBytes: 50 * 1024 * 1024,
  keepDownloadedFiles: false,
  tempRoot: join(tmpdir(), "openclaw-soundcloud"),
  allowedHosts: ["soundcloud.com", "on.soundcloud.com", "m.soundcloud.com"],
} satisfies Required<
  Pick<
    PluginConfig,
    | "downloaderCommand"
    | "downloaderArgs"
    | "downloadPathFlag"
    | "downloaderForce"
    | "downloaderSocksProxy"
    | "openclawCommand"
    | "timeoutSeconds"
    | "maxFileBytes"
    | "keepDownloadedFiles"
    | "tempRoot"
    | "allowedHosts"
  >
>;

const transientExtensions = [
  ".part",
  ".ytdl",
  ".tmp",
  ".temp",
  ".download",
];

export default definePluginEntry({
  id: "soundcloud",
  name: "SoundCloud",
  description:
    "Downloads a SoundCloud track through a configured CLI command and sends it to Telegram from OpenClaw.",
  register(api) {
    const pluginConfig = {
      ...defaultConfig,
      ...((api as { config?: PluginConfig }).config ?? {}),
    };

    api.registerTool({
      name: "soundcloud",
      label: "SoundCloud",
      description:
        "Download a SoundCloud URL and send the resulting audio file to a selected Telegram user or chat through OpenClaw.",
      parameters: Type.Object({
        url: Type.String({
          description: "SoundCloud track URL, for example https://soundcloud.com/artist/track.",
        }),
        telegramTarget: Type.Optional(
          Type.String({
            description:
              "Telegram target chat id or @username. Defaults to plugin config telegramTarget.",
          }),
        ),
        telegramAccount: Type.Optional(
          Type.String({
            description:
              "Optional OpenClaw Telegram account id. Defaults to plugin config telegramAccount.",
          }),
        ),
        message: Type.Optional(
          Type.String({
            description: "Optional caption/message sent with the file.",
          }),
        ),
        timeoutSeconds: Type.Optional(
          Type.Integer({
            minimum: 10,
            maximum: 7200,
            description: "Optional per-call timeout for download and send commands.",
          }),
        ),
      }),
      async execute(_id: string, params: SoundCloudParams) {
        const target = params.telegramTarget ?? pluginConfig.telegramTarget;
        if (!target) {
          throw new Error(
            "telegramTarget is required either in tool parameters or plugin config.",
          );
        }

        const account = params.telegramAccount ?? pluginConfig.telegramAccount;
        const timeoutSeconds =
          params.timeoutSeconds ?? pluginConfig.timeoutSeconds;
        validateSoundCloudUrl(params.url, pluginConfig.allowedHosts);

        const tempDir = await createMediaTempDir(pluginConfig.tempRoot);
        let downloaded: DownloadedFile | undefined;

        try {
          const downloadResult = await runCommand(
            pluginConfig.downloaderCommand,
            buildDownloaderArgs({
              url: params.url,
              downloadPathFlag: pluginConfig.downloadPathFlag,
              downloadPath: tempDir,
              force: pluginConfig.downloaderForce,
              socksProxy: pluginConfig.downloaderSocksProxy,
              extraArgs: pluginConfig.downloaderArgs,
            }),
            {
              timeoutMs: timeoutSeconds * 1000,
              label: "downloader",
            },
          );

          downloaded = await findDownloadedFile(tempDir, downloadResult);
          if (downloaded.size > pluginConfig.maxFileBytes) {
            throw new Error(
              `Downloaded file is ${downloaded.size} bytes, above configured maxFileBytes=${pluginConfig.maxFileBytes}.`,
            );
          }

          await sendToTelegram({
            openclawCommand: pluginConfig.openclawCommand,
            target,
            account,
            filePath: downloaded.path,
            message: params.message,
            timeoutMs: timeoutSeconds * 1000,
          });

          const keepNote = pluginConfig.keepDownloadedFiles
            ? `\nDownloaded file kept at: ${downloaded.path}`
            : "";

          return {
            details: {
              telegramTarget: target,
              downloadedFile: pluginConfig.keepDownloadedFiles
                ? downloaded.path
                : undefined,
            },
            content: [
              {
                type: "text",
                text: `Sent SoundCloud media to Telegram target ${target}.${keepNote}`,
              },
            ],
          };
        } finally {
          if (!pluginConfig.keepDownloadedFiles) {
            await rm(tempDir, { recursive: true, force: true });
          }
        }
      },
    });
  },
});

async function createMediaTempDir(tempRoot: string): Promise<string> {
  const root = resolve(tempRoot);
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "media-"));
}

function buildDownloaderArgs(options: {
  url: string;
  downloadPathFlag: string;
  downloadPath: string;
  force: boolean;
  socksProxy: string;
  extraArgs: string[];
}): string[] {
  const args = [
    options.url,
    options.downloadPathFlag,
    options.downloadPath,
  ];

  if (options.force) {
    args.push("--force");
  }

  if (options.socksProxy.trim()) {
    args.push("--socks-proxy", options.socksProxy.trim());
  }

  args.push(...options.extraArgs);
  return args;
}

function validateSoundCloudUrl(urlValue: string, allowedHosts: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error("url must be an absolute SoundCloud URL.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = allowedHosts.some((host) => {
    const normalizedHost = host.toLowerCase();
    return (
      hostname === normalizedHost || hostname.endsWith(`.${normalizedHost}`)
    );
  });

  if (!isAllowed) {
    throw new Error(
      `url host "${parsed.hostname}" is not allowed. Allowed hosts: ${allowedHosts.join(", ")}.`,
    );
  }
}

async function sendToTelegram(options: {
  openclawCommand: string;
  target: string;
  account?: string;
  filePath: string;
  message?: string;
  timeoutMs: number;
}): Promise<void> {
  const args = [
    "message",
    "send",
    "--channel",
    "telegram",
    "--target",
    options.target,
    "--media",
    options.filePath,
  ];

  if (options.account) {
    args.push("--account", options.account);
  }

  if (options.message) {
    args.push("--message", options.message);
  }

  await runCommand(options.openclawCommand, args, {
    timeoutMs: options.timeoutMs,
    label: "openclaw message send",
  });
}

async function findDownloadedFile(
  root: string,
  commandResult?: CommandResult,
): Promise<DownloadedFile> {
  const files = await collectFiles(root);
  const candidates = files.filter((file) => {
    const lowerPath = file.path.toLowerCase();
    return !transientExtensions.some((extension) =>
      lowerPath.endsWith(extension),
    );
  });

  if (candidates.length === 0) {
    throw new Error(
      [
        `Downloader finished but no output file was found in ${root}.`,
        "This can happen with soundcloud-dl when it exits successfully after an interactive prompt abort or after a failed --best stream download.",
        commandResult ? `stdout:\n${commandResult.stdout}` : undefined,
        commandResult ? `stderr:\n${commandResult.stderr}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0];
}

async function collectFiles(directory: string): Promise<DownloadedFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: DownloadedFile[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const info = await stat(entryPath);
    result.push({
      path: entryPath,
      size: info.size,
      mtimeMs: info.mtimeMs,
    });
  }

  return result;
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs: number;
    label: string;
  },
): Promise<CommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `${options.label} timed out after ${Math.ceil(options.timeoutMs / 1000)} seconds.`,
        ),
      );
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += truncateChunk(chunk, stdout.length);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += truncateChunk(chunk, stderr.length);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(`${options.label} failed to start: ${error.message}`),
      );
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }

      const suffix = signal
        ? `signal ${signal}`
        : `exit code ${String(code)}`;
      reject(
        new Error(
          `${options.label} failed with ${suffix}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

function truncateChunk(chunk: string, currentLength: number): string {
  const maxOutputLength = 12_000;
  if (currentLength >= maxOutputLength) {
    return "";
  }

  return chunk.slice(0, maxOutputLength - currentLength);
}
