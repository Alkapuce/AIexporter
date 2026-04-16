import type { ConversationBundle, Message, Participant } from "@aiexporter/core-schema";

export type ConversationFormat = "full" | "user-only" | "assistant-only" | "code-only" | "compact";

const chatRoleLabels: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

function wrapBareUrls(markdown: string): string {
  const cjkPattern = /[\u3400-\u9fff]/;
  const alphaNumericPattern = /[A-Za-z0-9]/;
  const urlPattern = /https?:\/\/[^\s<>()\u3400-\u9fff]+/g;

  return markdown.replace(urlPattern, (url, offset, input) => {
    const source = input as string;
    const index = Number(offset);
    const previous = index > 0 ? source[index - 1] ?? "" : "";
    const next = source[index + url.length] ?? "";
    const previousPair = index >= 2 ? `${source[index - 2] ?? ""}${previous}` : previous;
    const insideMarkdownLink = previous === "(" && previousPair.endsWith("](");
    const insideAutoLink = previous === "<" || next === ">";

    if (insideMarkdownLink || insideAutoLink) {
      return url;
    }

    const needsWrap =
      cjkPattern.test(previous) ||
      cjkPattern.test(next) ||
      (alphaNumericPattern.test(previous) && previous !== "/") ||
      alphaNumericPattern.test(next);

    return needsWrap ? `<${url}>` : url;
  });
}

function convertThinkingBlocksToDetails(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^>\s*\[thinking\]\s*$/i.test(line.trim())) {
      output.push(line);
      continue;
    }

    const contentLines: string[] = [];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (/^>\s?/.test(candidate)) {
        contentLines.push(candidate.replace(/^>\s?/, ""));
        index += 1;
        continue;
      }
      if (!candidate.trim()) {
        contentLines.push("");
        index += 1;
        continue;
      }
      break;
    }
    index -= 1;

    const detailsBody = contentLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    output.push("<details>");
    output.push("<summary>Thinking</summary>");
    output.push("");
    if (detailsBody) {
      output.push(detailsBody);
      output.push("");
    }
    output.push("</details>");
  }

  return output.join("\n");
}

function normalizeMessageSpacing(markdown: string): string {
  return markdown
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/(<\/details>)\n(?!\n)/g, "$1\n\n")
    .replace(/(?<!\n)\n(<details>)/g, "\n\n$1")
    .trim();
}

function formatMessageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (input: number) => String(input).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainder = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day} ${hour}:${minute}:${second} (UTC${offsetSign}${offsetHours}:${offsetRemainder})`;
}

function buildParticipantMap(participants: Participant[]): Map<string, Participant> {
  return new Map(participants.map((participant) => [participant.role, participant]));
}

function normalizeRoleLabel(role: string, participants: Map<string, Participant>): string {
  const normalizedRole = role.toLowerCase();
  const defaultLabel = chatRoleLabels[normalizedRole];
  if (defaultLabel) return defaultLabel;

  const participant = participants.get(normalizedRole);
  if (participant?.name) return participant.name;

  return role.charAt(0).toUpperCase() + role.slice(1);
}

function extractCodeBlocks(markdown: string): string[] {
  return markdown.match(/```[\s\S]*?```/g) ?? [];
}

function compactMarkdown(markdown: string): string {
  const withoutCommentOnlyLines = markdown.replace(
    /(```[\w-]*\n)([\s\S]*?)(```)/g,
    (_match, open: string, code: string, close: string) => {
      const cleaned = code
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed !== "" &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("/*") &&
            !trimmed.startsWith("*") &&
            !trimmed.startsWith("*/")
          );
        })
        .join("\n");

      return cleaned ? `${open}${cleaned}\n${close}` : "";
    },
  );

  return withoutCommentOnlyLines
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMessageBody(message: Message, format: ConversationFormat): string | null {
  const body = wrapBareUrls(message.markdown.trim());
  if (!body) return null;

  switch (format) {
    case "user-only":
      return message.role === "user" ? normalizeMessageSpacing(convertThinkingBlocksToDetails(body)) || null : null;
    case "assistant-only":
      return message.role === "assistant" ? normalizeMessageSpacing(convertThinkingBlocksToDetails(body)) || null : null;
    case "code-only": {
      const codeBlocks = extractCodeBlocks(body);
      return codeBlocks.length > 0 ? codeBlocks.join("\n\n") : null;
    }
    case "compact":
      return normalizeMessageSpacing(convertThinkingBlocksToDetails(compactMarkdown(body))) || null;
    case "full":
    default:
      return normalizeMessageSpacing(convertThinkingBlocksToDetails(body)) || null;
  }
}

export function formatConversationMessages(
  bundle: ConversationBundle,
  format: ConversationFormat,
  includeMessageTimestamps: boolean,
): string[] {
  const participants = buildParticipantMap(bundle.participants);

  return bundle.messages
    .map((message) => {
      const body = formatMessageBody(message, format);
      if (!body) return null;

      const parts = [`## ${normalizeRoleLabel(message.role, participants)}`];
      if (includeMessageTimestamps && message.createdAt) {
        parts.push(`> ${formatMessageTimestamp(message.createdAt)}`);
      }
      parts.push(body);
      return parts.join("\n\n");
    })
    .filter((section): section is string => Boolean(section));
}
