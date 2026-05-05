import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversationIndexEntry,
  ExtensionSettings,
  ExportArtifactEntry,
  QueueState,
} from "@aiexporter/adapter-sdk";
import { fetchDashboardState, requestDebugState } from "../services/dashboard-api";
import { areDashboardSettingsEqual, cloneDashboardSettings } from "./controllers";

export type DashboardMode = "popup" | "options" | "dashboard";

export function useDashboardSnapshot(mode: DashboardMode) {
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [debugState, setDebugState] = useState<Awaited<ReturnType<typeof requestDebugState>> | null>(null);
  const [artifactIndex, setArtifactIndex] = useState<ExportArtifactEntry[]>([]);
  const [conversationIndex, setConversationIndex] = useState<ConversationIndexEntry[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<ExtensionSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const committedSettingsRef = useRef<ExtensionSettings | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchDashboardState();
      const nextCommittedSettings = cloneDashboardSettings(snapshot.queueState.settings);
      setQueueState(snapshot.queueState);
      setDebugState(snapshot.debugState);
      setArtifactIndex(snapshot.artifactIndex);
      setConversationIndex(snapshot.conversationIndex);
      setLoadError(null);
      setSettingsDraft((current) => {
        const previousCommitted = committedSettingsRef.current;
        committedSettingsRef.current = nextCommittedSettings;

        if (!current) {
          return nextCommittedSettings;
        }

        if (previousCommitted && !areDashboardSettingsEqual(current, previousCommitted)) {
          return current;
        }

        return areDashboardSettingsEqual(current, nextCommittedSettings) ? current : nextCommittedSettings;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load dashboard state.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(
      () => {
        void refresh();
      },
      mode === "popup" ? 3_000 : 4_000,
    );
    return () => window.clearInterval(interval);
  }, [mode, refresh]);

  return {
    queueState,
    debugState,
    artifactIndex,
    conversationIndex,
    settingsDraft,
    setSettingsDraft,
    loadError,
    refresh,
  };
}
