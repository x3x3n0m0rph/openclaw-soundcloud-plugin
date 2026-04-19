declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { TSchema } from "@sinclair/typebox";

  export type AgentToolTextContent = {
    type: "text";
    text: string;
  };

  export type AgentToolResult<TDetails = unknown> = {
    details: TDetails;
    content: AgentToolTextContent[];
  };

  export type AgentTool<TParams = unknown, TDetails = unknown> = {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute(
      toolCallId: string,
      params: TParams,
      signal?: AbortSignal,
      onUpdate?: unknown,
    ): Promise<AgentToolResult<TDetails>>;
  };

  export type PluginApi = {
    config?: unknown;
    runtime: {
      system: {
        runCommandWithTimeout(
          command: string,
          args: string[],
          opts: { timeoutMs: number },
        ): Promise<unknown>;
      };
    };
    registerTool(tool: AgentTool): void;
  };

  export type PluginEntry = {
    id: string;
    name: string;
    description: string;
    register(api: PluginApi): void;
  };

  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}
