import { mkdir, mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

type PluginConfig = {
  downloaderCommand?: string;
  downloaderArgs?: string[];
  downloadPathFlag?: string;
  downloaderForce?: boolean;
  downloaderSocksProxy?: string;
  timeoutSeconds?: number;
  maxFileBytes?: number;
  tempRoot?: string;
  allowedHosts?: string[];
};

type SoundCloudParams = {
  url: string;
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
  timeoutSeconds: 600,
  maxFileBytes: 50 * 1024 * 1024,
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
    | "timeoutSeconds"
    | "maxFileBytes"
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
    "Downloads a SoundCloud track through a configured CLI command and returns the downloaded file path.",
  register(api) {
    const pluginConfig = {
      ...defaultConfig,
      ...((api as { config?: PluginConfig }).config ?? {}),
    };

    api.registerTool({
      name: "soundcloud",
      label: "SoundCloud",
      description:
        "Download a SoundCloud URL and return the resulting audio file path.",
      parameters: Type.Object({
        url: Type.String({
          description: "SoundCloud track URL, for example https://soundcloud.com/artist/track.",
        }),
        timeoutSeconds: Type.Optional(
          Type.Integer({
            minimum: 10,
            maximum: 7200,
            description: "Optional per-call timeout for the download command.",
          }),
        ),
      }),
      async execute(_id: string, params: SoundCloudParams) {
        const timeoutSeconds =
          params.timeoutSeconds ?? pluginConfig.timeoutSeconds;
        validateSoundCloudUrl(params.url, pluginConfig.allowedHosts);

        const tempDir = await createMediaTempDir(pluginConfig.tempRoot);
        let downloaded: DownloadedFile | undefined;

        const downloadResult = await runCommandWithRuntime(
          api.runtime.system,
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

        return {
          details: {
            downloadedFile: downloaded.path,
            sizeBytes: downloaded.size,
          },
          content: [
            {
              type: "text",
              text: `Downloaded SoundCloud media to: ${downloaded.path}`,
            },
          ],
        };
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

type SystemRuntime = {
  runCommandWithTimeout: (
    command: string,
    args: string[],
    opts: { timeoutMs: number },
  ) => Promise<unknown>;
};

async function runCommandWithRuntime(
  system: SystemRuntime,
  command: string,
  args: string[],
  options: {
    timeoutMs: number;
    label: string;
  },
): Promise<CommandResult> {
  let output: unknown;
  try {
    output = await system.runCommandWithTimeout(command, args, {
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    throw new Error(
      `${options.label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return normalizeCommandResult(output);
}

function normalizeCommandResult(output: unknown): CommandResult {
  if (typeof output === "string") {
    return { stdout: output, stderr: "" };
  }

  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const stdout = stringifyOutput(record.stdout ?? record.output ?? record.text);
    const stderr = stringifyOutput(record.stderr ?? record.error ?? record.errors);
    return { stdout, stderr };
  }

  return { stdout: "", stderr: "" };
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyOutput(item))
      .filter(Boolean)
      .join("\n");
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return value == null ? "" : String(value);
}
