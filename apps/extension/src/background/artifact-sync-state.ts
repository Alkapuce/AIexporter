import type { QueueState } from "@aiexporter/adapter-sdk";

export const ARTIFACT_SYNC_STATE_KEY = "aiexporter.artifactSyncState";
export const AUTOMATIC_ARTIFACT_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ArtifactSyncState {
  lastCompletedAt?: string;
}

export function isAutomaticArtifactSyncDue(lastCompletedAt: string | undefined, nowMs = Date.now()): boolean {
  if (!lastCompletedAt) {
    return true;
  }

  const lastCompletedMs = Date.parse(lastCompletedAt);
  if (Number.isNaN(lastCompletedMs)) {
    return true;
  }

  return nowMs - lastCompletedMs >= AUTOMATIC_ARTIFACT_SYNC_INTERVAL_MS;
}

export function canRunAutomaticArtifactSync(queueState: QueueState): boolean {
  if (queueState.activeWorkers.length > 0) {
    return false;
  }

  return !queueState.items.some((item) => item.status === "pending" || item.status === "processing");
}

export async function loadArtifactSyncState(): Promise<ArtifactSyncState> {
  const raw = await browser.storage.local.get(ARTIFACT_SYNC_STATE_KEY);
  const candidate = raw[ARTIFACT_SYNC_STATE_KEY] as ArtifactSyncState | undefined;
  return {
    lastCompletedAt:
      typeof candidate?.lastCompletedAt === "string" && candidate.lastCompletedAt.trim().length > 0
        ? candidate.lastCompletedAt
        : undefined,
  };
}

export async function recordArtifactSyncCompleted(at = new Date().toISOString()): Promise<ArtifactSyncState> {
  const nextState: ArtifactSyncState = {
    lastCompletedAt: at,
  };
  await browser.storage.local.set({
    [ARTIFACT_SYNC_STATE_KEY]: nextState,
  });
  return nextState;
}
