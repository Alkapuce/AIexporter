import type { DebugLogInput, DebugLogLevel, RuntimeMessage } from "@aiexporter/adapter-sdk";
import { appendDebugLog } from "./storage";

function normalizeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  try {
    return JSON.parse(JSON.stringify(details)) as Record<string, unknown>;
  } catch {
    return {
      note: "Failed to serialize log details.",
    };
  }
}

function pickLogMetadata(details: Record<string, unknown> | undefined): Pick<
  DebugLogInput,
  "platform" | "sourceId" | "workerId" | "traceId" | "code"
> {
  return {
    platform: typeof details?.platform === "string" ? (details.platform as DebugLogInput["platform"]) : undefined,
    sourceId: typeof details?.sourceId === "string" ? details.sourceId : undefined,
    workerId: typeof details?.workerId === "string" ? details.workerId : undefined,
    traceId: typeof details?.traceId === "string" ? details.traceId : undefined,
    code: typeof details?.code === "string" ? details.code : undefined,
  };
}

export async function writeBackgroundLog(
  scope: string,
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await appendDebugLog({
    level,
    scope,
    ...pickLogMetadata(details),
    message,
    details: normalizeDetails(details),
  });
}

export async function writeBackgroundError(
  scope: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await appendDebugLog({
    level: "error",
    scope,
    code,
    message,
    ...pickLogMetadata(details),
    details: normalizeDetails(details),
  });
}

export function createTraceLogger(
  scope: string,
  traceContext: Record<string, unknown>,
) {
  return async (level: DebugLogLevel, message: string, details?: Record<string, unknown>): Promise<void> => {
    await writeBackgroundLog(scope, level, message, {
      ...traceContext,
      ...(details ?? {}),
    });
  };
}

export function createRuntimeLogger(scope: string) {
  return async (level: DebugLogLevel, message: string, details?: Record<string, unknown>): Promise<void> => {
    try {
      await browser.runtime.sendMessage({
        type: "debug-log",
        entry: {
          level,
          scope,
          ...pickLogMetadata(details),
          message,
          details: normalizeDetails(details),
        } satisfies DebugLogInput,
      } satisfies RuntimeMessage);
    } catch {
      return;
    }
  };
}
