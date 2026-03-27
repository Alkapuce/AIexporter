import { describe, expect, it } from "vitest";
import { DEFAULT_EXTENSION_SETTINGS } from "@aiexporter/adapter-sdk";
import {
  findExactArtifact,
  findLatestArtifactForConversation,
  findLatestOpenableArtifactForConversation,
  markLatestArtifacts,
  pruneOldArtifacts,
  shouldSkipPersist,
} from "./artifacts";

describe("artifact helpers", () => {
  const artifacts = [
    {
      platform: "deepseek" as const,
      sourceId: "conv-1",
      revision: "rev-3",
      exportedAt: "2026-03-25T12:03:00.000Z",
      markdownDownloadId: 103,
      localStatus: "present" as const,
    },
    {
      platform: "deepseek" as const,
      sourceId: "conv-1",
      revision: "rev-2",
      exportedAt: "2026-03-25T12:02:00.000Z",
      markdownDownloadId: 102,
      localStatus: "present" as const,
    },
    {
      platform: "deepseek" as const,
      sourceId: "conv-1",
      revision: "rev-1",
      exportedAt: "2026-03-25T12:01:00.000Z",
      markdownDownloadId: 101,
      localStatus: "present" as const,
    },
  ];

  it("finds the latest artifact for a conversation", () => {
    const latest = findLatestArtifactForConversation(artifacts, "deepseek", "conv-1");
    expect(latest?.revision).toBe("rev-3");
    expect(findExactArtifact(artifacts, "deepseek", "conv-1", "rev-2")?.markdownDownloadId).toBe(102);
  });

  it("skips persistence when latest local artifact already exists", () => {
    const latest = findLatestArtifactForConversation(artifacts, "deepseek", "conv-1");
    expect(
      shouldSkipPersist(latest, "rev-3", {
        ...DEFAULT_EXTENSION_SETTINGS,
        downloads: {
          ...DEFAULT_EXTENSION_SETTINGS.downloads,
          skipIfLatestExists: true,
        },
      }),
    ).toBe(true);
  });

  it("marks retained latest artifacts and prunes older revisions", () => {
    const marked = markLatestArtifacts(artifacts, "deepseek", "conv-1", 1);
    expect(marked.find((entry) => entry.revision === "rev-3")?.isLatestForConversation).toBe(true);
    expect(marked.find((entry) => entry.revision === "rev-2")?.isLatestForConversation).toBe(false);

    const pruneResult = pruneOldArtifacts(artifacts, "deepseek", "conv-1", 1);
    const retained = pruneResult.nextEntries.filter(
      (entry) => entry.platform === "deepseek" && entry.sourceId === "conv-1" && entry.localStatus !== "deleted",
    );

    expect(retained).toHaveLength(1);
    expect(retained[0]?.revision).toBe("rev-3");
    expect(pruneResult.pruned.map((entry) => entry.revision)).toEqual(["rev-2", "rev-1"]);
  });

  it("does not skip when latest-exists policy is disabled", () => {
    const latest = findLatestArtifactForConversation(artifacts, "deepseek", "conv-1");
    expect(
      shouldSkipPersist(latest, "rev-3", {
        ...DEFAULT_EXTENSION_SETTINGS,
        downloads: {
          ...DEFAULT_EXTENSION_SETTINGS.downloads,
          skipIfLatestExists: false,
        },
      }),
    ).toBe(false);
  });

  it("finds the latest retained artifact for completed or skipped items", () => {
    const marked = markLatestArtifacts(
      [
        ...artifacts,
        {
          platform: "deepseek" as const,
          sourceId: "conv-1",
          revision: "rev-4",
          exportedAt: "2026-03-25T12:04:00.000Z",
          markdownDownloadId: 104,
          localStatus: "skipped_existing" as const,
        },
      ],
      "deepseek",
      "conv-1",
      1,
    );

    const latest = findLatestArtifactForConversation(marked, "deepseek", "conv-1");
    expect(latest?.revision).toBe("rev-4");
    expect(latest?.localStatus).toBe("skipped_existing");
    expect(latest?.isLatestForConversation).toBe(true);
  });

  it("prefers the latest openable artifact with a download id", () => {
    const openable = findLatestOpenableArtifactForConversation(
      [
        {
          platform: "deepseek" as const,
          sourceId: "conv-2",
          revision: "rev-2",
          exportedAt: "2026-03-25T13:02:00.000Z",
          localStatus: "present" as const,
          isLatestForConversation: true,
        },
        {
          platform: "deepseek" as const,
          sourceId: "conv-2",
          revision: "rev-1",
          exportedAt: "2026-03-25T13:01:00.000Z",
          markdownDownloadId: 201,
          localStatus: "present" as const,
        },
      ],
      "deepseek",
      "conv-2",
    );

    expect(openable?.revision).toBe("rev-1");
    expect(openable?.markdownDownloadId).toBe(201);
  });
});
