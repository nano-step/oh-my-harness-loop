import { existsSync, readFileSync } from "node:fs";
import {
  BacklogSchema,
  HarnessConfigError,
  type Backlog,
  type EpicConfig,
} from "./types.js";

export interface BacklogAdapter {
  load(): Promise<Backlog>;
}

export class FileBacklogAdapter implements BacklogAdapter {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Backlog> {
    if (!existsSync(this.filePath)) {
      throw new HarnessConfigError(
        `Epic backlog file not found: ${this.filePath}`
      );
    }
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch (e) {
      throw new HarnessConfigError(
        `Could not read backlog file ${this.filePath}: ${(e as Error).message}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new HarnessConfigError(
        `Backlog file is not valid JSON (${this.filePath}): ${(e as Error).message}`
      );
    }
    const result = BacklogSchema.safeParse(parsed);
    if (!result.success) {
      throw new HarnessConfigError(
        `Backlog file schema validation failed: ${result.error.message}`,
        result.error
      );
    }
    const ids = new Set<string>();
    for (const s of result.data.stories) {
      if (ids.has(s.id)) {
        throw new HarnessConfigError(
          `Duplicate story id "${s.id}" in backlog ${this.filePath}`
        );
      }
      ids.add(s.id);
    }
    return result.data;
  }
}

export function createBacklogAdapter(config: EpicConfig): BacklogAdapter {
  switch (config.backlog_source) {
    case "file":
      return new FileBacklogAdapter(config.backlog_file);
    default:
      throw new HarnessConfigError(
        `Unknown backlog source: ${config.backlog_source as string}`
      );
  }
}
