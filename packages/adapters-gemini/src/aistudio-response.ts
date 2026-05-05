import type { ConversationBundle, LinkedAttachmentDescriptor, Message } from "@aiexporter/core-schema";

type AiStudioRole = "user" | "model";
type JsonRecord = Record<string, unknown>;

function getRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNestedArray(root: unknown, path: number[]): unknown[] {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || index >= current.length) return [];
    current = current[index];
  }
  return getArray(current);
}

function getNestedString(root: unknown, path: number[]): string | undefined {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || index >= current.length) return undefined;
    current = current[index];
  }
  return getString(current);
}

function normalizeTimestamp(seconds: unknown, nanos: unknown): string | undefined {
  const secondsValue = Number(seconds);
  if (!Number.isFinite(secondsValue)) return undefined;
  const nanosValue = Number.isFinite(Number(nanos)) ? Number(nanos) : 0;
  const millis = secondsValue * 1_000 + Math.floor(nanosValue / 1_000_000);
  const timestamp = new Date(millis);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function isLikelyUnixSeconds(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 1_000_000_000 && numeric < 20_000_000_000;
}

function collectTimestampCandidates(node: unknown, collector: string[]): void {
  if (!Array.isArray(node)) return;

  if (node.length >= 2 && isLikelyUnixSeconds(node[0])) {
    const normalized = normalizeTimestamp(node[0], node[1]);
    if (normalized) {
      collector.push(normalized);
    }
  }

  node.forEach((child) => collectTimestampCandidates(child, collector));
}

function findBestTurnTimestamp(turn: unknown[]): string | undefined {
  const candidates: string[] = [];
  collectTimestampCandidates(turn, candidates);
  return candidates.sort().at(-1);
}

function decodeBase64Text(base64Payload: string): string {
  if (typeof atob === "function") {
    return atob(base64Payload);
  }
  return Buffer.from(base64Payload, "base64").toString("utf8");
}

function buildSafeFencedBlock(content: string, language = ""): string {
  const tildeRuns = content.match(/~+/g) ?? [];
  const longestTildeRun = tildeRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "~".repeat(Math.max(3, longestTildeRun + 1));
  const infoString = language.trim();
  return `${fence}${infoString ? language : ""}\n${content}\n${fence}`;
}

function normalizeAiStudioApiText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/(\*\*[^*\n]+\*\*)[ \t]+(?=\S)/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isAiStudioRole(value: unknown): value is AiStudioRole {
  return value === "user" || value === "model";
}

function collectAiStudioTurns(root: unknown): unknown[][] {
  const collected: unknown[][] = [];
  const seen = new Set<unknown[]>();

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      if (node.length > 8 && isAiStudioRole(node[8])) {
        if (!seen.has(node)) {
          seen.add(node);
          collected.push(node);
        }
      }
      node.forEach((child) => walk(child));
      return;
    }

    const record = getRecord(node);
    if (!record) return;
    Object.values(record).forEach((child) => walk(child));
  }

  walk(root);
  return collected;
}

function isThoughtTurn(turn: unknown[]): boolean {
  if (turn[8] !== "model") return false;
  if (turn[25] === -1) return true;
  const sections = getArray(turn[29]);
  return sections.length > 0 && sections.every((section) => Array.isArray(section) && section[12] === 1);
}

function collectStringArrays(root: unknown, collector: string[][]): void {
  if (!Array.isArray(root)) return;
  if (root.length > 0 && root.every((entry) => typeof entry === "string")) {
    collector.push(root as string[]);
    return;
  }
  root.forEach((child) => collectStringArrays(child, collector));
}

function collectAiStudioDriveIds(turn: unknown[]): string[] {
  const collected: string[] = [];
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.every((entry) => typeof entry === "string")) {
      const values = node.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      collected.push(...values);
      return;
    }
    node.forEach(visit);
  };
  [turn[1], turn[3]].forEach(visit);
  return Array.from(new Set(collected));
}

function collectAiStudioInlineAttachments(turn: unknown[]): Array<{ mimeType: string; payload: string }> {
  const candidates: string[][] = [];
  [turn[12], turn[23], turn].forEach((node) => collectStringArrays(node, candidates));
  const attachments = candidates
    .map((candidate) => ({
      mimeType: candidate[0],
      payload: candidate[1],
    }))
    .filter(
      (candidate): candidate is { mimeType: string; payload: string } =>
        typeof candidate.mimeType === "string" &&
        typeof candidate.payload === "string" &&
        (/^image\//i.test(candidate.mimeType) || /^text\//i.test(candidate.mimeType)),
    );
  const deduped = new Map<string, { mimeType: string; payload: string }>();
  attachments.forEach((attachment) => {
    deduped.set(`${attachment.mimeType}:${attachment.payload.slice(0, 32)}`, attachment);
  });
  return Array.from(deduped.values());
}

function buildAttachmentMarkdown(turn: unknown[], messageId: string): string[] {
  const blocks: string[] = [];
  const driveIds = collectAiStudioDriveIds(turn);
  const inlineAttachments = collectAiStudioInlineAttachments(turn);

  for (const attachment of inlineAttachments) {
    const { mimeType, payload: base64Payload } = attachment;
    if (mimeType.startsWith("image/")) {
      const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9.+-]/gi, "") || "png";
      blocks.push(`![${messageId}.${extension}](data:${mimeType};base64,${base64Payload})`);
    } else if (mimeType.startsWith("text/")) {
      try {
        const decoded = decodeBase64Text(base64Payload);
        const normalized = normalizeAiStudioApiText(decoded);
        blocks.push(`> [attachment] ${mimeType}`);
        if (normalized) {
          blocks.push(buildSafeFencedBlock(normalized, "text"));
        }
      } catch {
        blocks.push(`> [attachment] ${mimeType}`);
      }
    } else {
      blocks.push(`> [attachment] ${mimeType}`);
    }
  }

  for (const driveId of driveIds) {
    blocks.push(`> [attachment] [Google Drive resource ${driveId}](https://drive.google.com/open?id=${driveId})`);
  }

  return blocks;
}

function collectLinkedAttachmentsForTurn(turn: unknown[], messageId: string): LinkedAttachmentDescriptor[] {
  return collectAiStudioDriveIds(turn).map((driveId) => ({
    messageId,
    kind: "resource",
    title: `Google Drive resource ${driveId}`,
    sourceUrl: `https://drive.google.com/open?id=${driveId}`,
    resourceId: driveId,
  }));
}

function buildTurnMarkdown(turn: unknown[], index: number): string {
  const role = turn[8] === "user" ? "user" : "assistant";
  const messageId = `${role}-${index + 1}`;
  const parts: string[] = [];
  const text = normalizeAiStudioApiText(getString(turn[0]) ?? "");

  parts.push(...buildAttachmentMarkdown(turn, messageId));

  if (text) {
    if (isThoughtTurn(turn)) {
      const quotedThought = ["> [thinking]"]
        .concat(text.split("\n").map((line) => (line.trim().length > 0 ? `> ${line}` : ">")))
        .join("\n");
      parts.push(quotedThought);
    } else {
      parts.push(text);
    }
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

function buildParticipants(messages: Message[]) {
  const participants = new Map<string, ConversationBundle["participants"][number]>();
  for (const message of messages) {
    if (message.role === "user" && !participants.has("user")) {
      participants.set("user", { id: "user", role: "user", name: "User" });
    }
    if (message.role === "assistant" && !participants.has("assistant")) {
      participants.set("assistant", { id: "assistant", role: "assistant", name: "Google AI Studio" });
    }
  }

  if (participants.size === 0) {
    participants.set("assistant", { id: "assistant", role: "assistant", name: "Google AI Studio" });
  }

  return Array.from(participants.values());
}

function extractMetadata(root: unknown): {
  title?: string;
  model?: string;
  sourceUpdatedAt?: string;
  sourceUpdatedLabel?: string;
  promptType?: string;
  hasImages?: boolean;
} {
  const rootArray = getArray(root);
  const title = getNestedString(root, [0, 4, 0]);
  const model = getNestedString(root, [0, 3, 2]);
  const updatedAtPair = getNestedArray(root, [0, 4, 4, 0]);
  const attributes = getNestedArray(root, [0, 4, 10]).filter(
    (entry): entry is [string, unknown] => Array.isArray(entry) && typeof entry[0] === "string",
  );
  const attributeMap = Object.fromEntries(attributes);

  return {
    title,
    model,
    sourceUpdatedAt: normalizeTimestamp(updatedAtPair[0], updatedAtPair[1]),
    sourceUpdatedLabel: undefined,
    promptType: getString(attributeMap.promptType),
    hasImages: attributeMap.hasImages === "true",
  };
}

export function extractAiStudioConversationFromResolvedPromptPayload(
  payload: unknown,
  url: string,
  sourceId: string,
): ConversationBundle {
  const turns = collectAiStudioTurns(payload);
  const linkedAttachments: LinkedAttachmentDescriptor[] = [];
  const messages: Message[] = turns.flatMap((turn, index) => {
    const role = turn[8] === "user" ? "user" : "assistant";
    const markdown = buildTurnMarkdown(turn, index);
    if (!markdown) return [];
    const messageId = `${role}-${index + 1}`;
    linkedAttachments.push(...collectLinkedAttachmentsForTurn(turn, messageId));

    return [
      {
        id: messageId,
        role,
        markdown,
        createdAt: findBestTurnTimestamp(turn),
      } satisfies Message,
    ];
  });

  const metadata = extractMetadata(payload);

  if (messages.length === 0) {
    throw new Error("AI Studio resolved prompt payload did not contain any exportable messages.");
  }

  return {
    platform: "aistudio",
    sourceId,
    url,
    title: metadata.title,
    extractedAt: new Date().toISOString(),
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    participants: buildParticipants(messages),
    messages,
    meta: {
      sourceHost: "aistudio.google.com",
      model: metadata.model,
      sourceUpdatedLabel: metadata.sourceUpdatedLabel,
      promptType: metadata.promptType,
      hasImages: metadata.hasImages,
      turnCount: messages.length,
      linkedAttachments,
    },
  };
}
