import type { RuntimeMessage } from "@aiexporter/adapter-sdk";
import type { DiscoveryEvent, SourcePlatform } from "@aiexporter/core-schema";

export interface DiscoveryBatchFlushContext {
  reason: "timer" | "threshold" | "manual";
  events: DiscoveryEvent[];
}

export interface DiscoveryBatchSenderOptions {
  platform: SourcePlatform;
  flushDelayMs?: number;
  maxBatchSize?: number;
  onFlush?: (context: DiscoveryBatchFlushContext) => Promise<void> | void;
}

export interface DiscoveryBatchSender {
  enqueue(event: DiscoveryEvent): Promise<void>;
  flush(reason?: DiscoveryBatchFlushContext["reason"]): Promise<void>;
}

export function createDiscoveryBatchSender(options: DiscoveryBatchSenderOptions): DiscoveryBatchSender {
  const flushDelayMs = options.flushDelayMs ?? 250;
  const maxBatchSize = options.maxBatchSize ?? 20;
  const bufferedEvents = new Map<string, DiscoveryEvent>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushChain = Promise.resolve();

  const flushInternal = async (reason: DiscoveryBatchFlushContext["reason"]) => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (bufferedEvents.size === 0) {
      return;
    }

    const events = Array.from(bufferedEvents.values());
    bufferedEvents.clear();
    const payload: RuntimeMessage = {
      type: "queue-discovery-batch",
      events,
    };
    await browser.runtime.sendMessage(payload);
    await options.onFlush?.({
      reason,
      events,
    });
  };

  const flush = async (reason: DiscoveryBatchFlushContext["reason"] = "manual") => {
    flushChain = flushChain.then(() => flushInternal(reason), () => flushInternal(reason));
    return flushChain;
  };

  return {
    async enqueue(event) {
      bufferedEvents.set(`${options.platform}:${event.sourceId}`, event);
      if (bufferedEvents.size >= maxBatchSize) {
        await flush("threshold");
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void flush("timer");
      }, flushDelayMs);
    },
    flush,
  };
}
