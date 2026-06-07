import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import { stateExists, getStatePath, readState } from "./storage.js";
import {
  handleSessionIdle,
  handleSessionError,
  handleSessionDeleted,
  type PluginContext,
} from "./harness-loop-event-handler.js";
import {
  handleHarnessOn,
  type HarnessOnContext,
} from "./commands/harness-on.js";
import { handleHarnessOff, type HarnessOffContext } from "./commands/harness-off.js";
import { handleHarnessInit, type HarnessInitContext } from "./commands/harness-init.js";
import { handleHarnessCheck, type HarnessCheckContext } from "./commands/harness-check.js";
import { handleHarnessTeam, type HarnessTeamContext } from "./commands/harness-team.js";
import type { HarnessLoopState } from "./types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_VERSION = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
).version as string;
let versionLogged = false;

async function fetchMessages(
  input: PluginInput,
  sessionID: string
): Promise<Array<{ role: string; content: string }>> {
  const result = await input.client.session.messages({ path: { id: sessionID } });
  const data = result.data;
  if (!data) return [];
  return data.map((m) => ({
    role: m.info.role,
    content: m.parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? (p as { text: string }).text : ""))
      .join(""),
  }));
}

function buildPluginContext(
  input: PluginInput,
  sessionID: string,
  messages: Array<{ role: string; content: string }>
): PluginContext {
  return {
    sessionId: sessionID,
    projectRoot: input.directory,
    getMessages: () => messages,
    injectMessage: async (text: string) => {
      await input.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      });
    },
    showToast: (message: string, variant: "info" | "warning" | "error") => {
      const duration = variant === "error" ? 10000 : variant === "warning" ? 6000 : undefined;
      void input.client.tui.showToast({
        body: { message, variant, ...(duration !== undefined && { duration }) },
      });
    },
    hasActiveBackgroundTasks: () => false,
    latestUserMessageTimestamp: () => 0,
  };
}

function buildHarnessOnContext(
  input: PluginInput,
  sessionID: string,
  messages: Array<{ role: string; content: string }>
): HarnessOnContext {
  return {
    projectRoot: input.directory,
    sessionId: sessionID,
    getMessageCount: () => messages.length,
    injectMessage: async (text: string) => {
      await input.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      });
    },
    showToast: (message: string, variant: "info" | "warning" | "error") => {
      const duration = variant === "error" ? 10000 : variant === "warning" ? 6000 : undefined;
      void input.client.tui.showToast({
        body: { message, variant, ...(duration !== undefined && { duration }) },
      });
    },
  };
}

function buildHarnessOffContext(
  input: PluginInput
): HarnessOffContext {
  return {
    projectRoot: input.directory,
    showToast: (message: string, variant: "info" | "warning" | "error") => {
      const duration = variant === "error" ? 10000 : variant === "warning" ? 6000 : undefined;
      void input.client.tui.showToast({
        body: { message, variant, ...(duration !== undefined && { duration }) },
      });
    },
  };
}

function buildHarnessInitContext(
  input: PluginInput,
  sessionID: string
): HarnessInitContext {
  return {
    projectRoot: input.directory,
    showToast: (message: string, variant: "info" | "warning" | "error") => {
      const duration = variant === "error" ? 10000 : variant === "warning" ? 6000 : undefined;
      void input.client.tui.showToast({
        body: { message, variant, ...(duration !== undefined && { duration }) },
      });
    },
    injectMessage: async (text: string) => {
      await input.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      });
    },
  };
}

function buildHarnessCheckContext(
  input: PluginInput,
  sessionID: string
): HarnessCheckContext {
  return {
    projectRoot: input.directory,
    showToast: (message: string, variant: "info" | "warning" | "error") => {
      const duration = variant === "error" ? 10000 : variant === "warning" ? 6000 : undefined;
      void input.client.tui.showToast({
        body: { message, variant, ...(duration !== undefined && { duration }) },
      });
    },
    injectMessage: async (text: string) => {
      await input.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      });
    },
  };
}

const HarnessLoopPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  if (!versionLogged) {
    console.log(`[harness-loop] Plugin loaded v${PLUGIN_VERSION}`);
    versionLogged = true;
  }

  return {
    async event({ event }) {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        const statePath = getStatePath(input.directory);
        if (!stateExists(statePath)) return;
        const state = readState(statePath) as HarnessLoopState | null;
        if (!state?.loop.active) return;

        const messages = await fetchMessages(input, sessionID);
        const ctx = buildPluginContext(input, sessionID, messages);
        await handleSessionIdle(ctx);
        return;
      }

      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID ?? "";
        if (!sessionID) return;
        const statePath = getStatePath(input.directory);
        if (!stateExists(statePath)) return;
        const state = readState(statePath) as HarnessLoopState | null;
        if (!state?.loop.active) return;

        const messages = await fetchMessages(input, sessionID);
        const ctx = buildPluginContext(input, sessionID, messages);
        const rawError = event.properties.error;
        const err = new Error(
          rawError && "message" in rawError ? String(rawError.message) : "session error"
        );
        await handleSessionError(ctx, err);
        return;
      }

      if (event.type === "session.deleted") {
        const deletedID = event.properties.info.id;
        const statePath = getStatePath(input.directory);
        if (!stateExists(statePath)) return;
        const ctx = buildPluginContext(input, deletedID, []);
        await handleSessionDeleted(ctx, deletedID);
      }
    },

    async "command.execute.before"(cmdInput, _output) {
      const { command, sessionID, arguments: argsStr } = cmdInput;

      if (command === "harness-on") {
        const args = argsStr ? argsStr.trim().split(/\s+/) : [];
        const messages = await fetchMessages(input, sessionID);
        const ctx = buildHarnessOnContext(input, sessionID, messages);
        await handleHarnessOn(ctx, args);
        return;
      }

      if (command === "harness-off") {
        const args = argsStr ? argsStr.trim().split(/\s+/) : [];
        const ctx = buildHarnessOffContext(input);
        await handleHarnessOff(ctx, args);
        return;
      }

      if (command === "harness-init") {
        const ctx = buildHarnessInitContext(input, sessionID);
        await handleHarnessInit(ctx);
        return;
      }

      if (command === "harness-check") {
        const args = argsStr ? argsStr.trim().split(/\s+/) : [];
        const ctx = buildHarnessCheckContext(input, sessionID);
        await handleHarnessCheck(ctx, args);
        return;
      }

      if (command === "harness-team") {
        const args = argsStr ? argsStr.trim().split(/\s+/) : [];
        const teamCtx: HarnessTeamContext = {
          projectRoot: input.directory,
          showToast: (message, variant) => {
            void input.client.tui.showToast({
              body: { message, variant },
            });
          },
          injectMessage: async (text) => {
            await input.client.session.prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text }] },
            });
          },
        };
        await handleHarnessTeam(teamCtx, args);
        return;
      }
    },
  };
};

export default HarnessLoopPlugin;
