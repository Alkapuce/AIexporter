import type { QueueState } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import {
  canRunAutomaticArtifactSync,
  isAutomaticArtifactSyncDue,
  type ArtifactSyncState,
} from "./artifact-sync-state";
import { SUPPORTED_PLATFORMS } from "./shared";

export interface AutomaticArtifactSyncDeps {
  loadQueueState: () => Promise<QueueState>;
  loadArtifactSyncState: () => Promise<ArtifactSyncState>;
  runArtifactSync: () => Promise<void>;
  requestPlatformTick: (platform: SourcePlatform) => void;
  writeBackgroundLog: (
    scope: string,
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: Record<string, unknown>,
  ) => Promise<void>;
}

export async function runPeriodicSchedulerWork(deps: AutomaticArtifactSyncDeps): Promise<"synced" | "ticked"> {
  try {
    const [queueState, syncState] = await Promise.all([deps.loadQueueState(), deps.loadArtifactSyncState()]);
    if (canRunAutomaticArtifactSync(queueState) && isAutomaticArtifactSyncDue(syncState.lastCompletedAt)) {
      await deps.writeBackgroundLog("background.artifact", "info", "Running weekly automatic artifact sync before scheduler ticks.", {
        code: "artifact.sync_auto_weekly",
        lastCompletedAt: syncState.lastCompletedAt,
      });
      await deps.runArtifactSync();
      return "synced";
    }
  } catch (error) {
    await deps.writeBackgroundLog("background.artifact", "warn", "Automatic artifact sync check failed; continuing with scheduler ticks.", {
      code: "artifact.sync_auto_failed",
      error: error instanceof Error ? error.message : "Automatic artifact sync check failed.",
    });
  }

  SUPPORTED_PLATFORMS.forEach((platform) => {
    deps.requestPlatformTick(platform);
  });
  return "ticked";
}
