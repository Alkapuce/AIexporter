import type { DebugLogInput, DebugLogLevel, RuntimeMessage } from "@aiexporter/adapter-sdk";
import { appendDebugLog, appendDebugLogs } from "./storage";

const BACKGROUND_LOG_BUFFER_FLUSH_MS = 400;
const BACKGROUND_LOG_BUFFER_MAX_ENTRIES = 20;

let bufferedBackgroundLogs: DebugLogInput[] = [];
let bufferedBackgroundLogTimer: ReturnType<typeof setTimeout> | undefined;

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

function pickLogMetadata(
  details: Record<string, unknown> | undefined,
): Pick<DebugLogInput, "platform" | "sourceId" | "workerId" | "traceId" | "code"> {
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
  const entry: DebugLogInput = {
    level,
    scope,
    ...pickLogMetadata(details),
    message,
    details: normalizeDetails(details),
  };

  if (level === "warn" || level === "error") {
    await flushBufferedBackgroundLogs();
    await appendDebugLog(entry);
    return;
  }

  bufferedBackgroundLogs.push(entry);
  if (bufferedBackgroundLogs.length >= BACKGROUND_LOG_BUFFER_MAX_ENTRIES) {
    await flushBufferedBackgroundLogs("threshold");
    return;
  }

  scheduleBufferedBackgroundLogFlush();
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

function scheduleBufferedBackgroundLogFlush(): void {
  if (bufferedBackgroundLogTimer) {
    return;
  }

  bufferedBackgroundLogTimer = setTimeout(() => {
    bufferedBackgroundLogTimer = undefined;
    void flushBufferedBackgroundLogs("timer");
  }, BACKGROUND_LOG_BUFFER_FLUSH_MS);
}

export async function flushBufferedBackgroundLogs(reason: "timer" | "threshold" | "manual" = "manual"): Promise<void> {
  if (bufferedBackgroundLogTimer) {
    clearTimeout(bufferedBackgroundLogTimer);
    bufferedBackgroundLogTimer = undefined;
  }
  if (bufferedBackgroundLogs.length === 0) {
    return;
  }

  const pending = bufferedBackgroundLogs;
  bufferedBackgroundLogs = [];
  await appendDebugLogs([
    ...pending,
    {
      level: "debug",
      scope: "background.log-buffer",
      message: "Flushed buffered background logs.",
      code: "debug.log_buffer_flushed",
      details: {
        batchSize: pending.length,
        reason,
      },
    },
  ]);
}

export function createTraceLogger(scope: string, traceContext: Record<string, unknown>) {
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
