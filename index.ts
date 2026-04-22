import { mkdir, mkdtemp, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

type PluginConfig = {
  downloadFolder?: string;
  force?: boolean;
  socksProxy?: string | null;
  timeoutSeconds?: number;
  allowedHosts?: string[];
};

type SoundCloudParams = {
  url: string;
  downloadFolder?: string;
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

const DOWNLOADER_COMMAND = "soundcloud-dl";

const defaultConfig = {
  downloadFolder: "/tmp/openclaw/plugins/openclaw-soundcloud-plugin",
  force: false,
  socksProxy: null as string | null,
  timeoutSeconds: 600,
  allowedHosts: ["soundcloud.com", "on.soundcloud.com", "m.soundcloud.com"],
} satisfies Required<
  Pick<
    PluginConfig,
    | "downloadFolder"
    | "force"
    | "socksProxy"
    | "timeoutSeconds"
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
  id: "openclaw-soundcloud-plugin",
  name: "SoundCloud download plugin",
  description: "Registers a soundcloud tool that downloads a SoundCloud URL with soundcloud-dl and returns the downloaded file path.",
  register(api) {
    const pluginConfig = {
      ...defaultConfig,
      ...((api as { config?: Partial<PluginConfig> }).config ?? {}),
    };

    api.registerTool({
      name: "soundcloud",
      label: "SoundCloud download tool",
      description: "Download a SoundCloud track or playlist URL and return the resulting audio file path. No shell command is required; pass the URL only.",
      parameters: Type.Object({
        url: Type.String({
            description:
              "SoundCloud track or playlist URL. Should be in domain or subdomain soundcloud.com",
          }),
        downloadFolder: Type.Optional(
          Type.String({ 
            description: "Flag used by soundcloud-dl to choose where media files are stored.",
          }),
        ),
      }),
      async execute(_id: string, params: SoundCloudParams) {
        const timeoutSeconds = pluginConfig.timeoutSeconds;
        const targetUrl = params.url.trim();
        if (!targetUrl) {
          throw new Error(
            "url is required: set tool parameter `url` or plugin config `url`.",
          );
        }
        validateSoundCloudUrl(targetUrl, pluginConfig.allowedHosts);

        const downloadRoot = resolve(pluginConfig.downloadFolder);
        await mkdir(downloadRoot, { recursive: true });

        const sessionDir = await mkdtemp(join(downloadRoot, "dl-"));

        const downloadResult = await runDownloader(
          api.runtime.system,
          buildDownloaderArgs({
            url: targetUrl,
            downloadPath: sessionDir,
            force: pluginConfig.force,
            socksProxy: pluginConfig.socksProxy,
          }),
          {
            timeoutMs: timeoutSeconds * 1000,
          },
        );

        const downloaded = await findDownloadedFile(sessionDir, downloadResult);

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

function buildDownloaderArgs(options: {
  url: string;
  downloadPath: string;
  force: boolean;
  socksProxy: string | null | undefined;
}): string[] {
  const args = [options.url, "--download-path", options.downloadPath];

  if (options.force) {
    args.push("--force");
  }

  const proxy =
    typeof options.socksProxy === "string" ? options.socksProxy.trim() : "";
  if (proxy) {
    args.push("--socks-proxy", proxy);
  }

  args.push("--best");
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

async function runDownloader(
  system: SystemRuntime,
  args: string[],
  options: { timeoutMs: number },
): Promise<CommandResult> {
  const output = await system.runCommandWithTimeout(
    DOWNLOADER_COMMAND,
    args,
    { timeoutMs: options.timeoutMs },
  );
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
