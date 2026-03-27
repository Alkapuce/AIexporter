import type { ConversationBundle, Message, Participant } from "@aiexporter/core-schema";

export type ConversationFormat = "full" | "user-only" | "assistant-only" | "code-only" | "compact";

const chatRoleLabels: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

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
  const body = message.markdown.trim();
  if (!body) return null;

  switch (format) {
    case "user-only":
      return message.role === "user" ? body : null;
    case "assistant-only":
      return message.role === "assistant" ? body : null;
    case "code-only": {
      const codeBlocks = extractCodeBlocks(body);
      return codeBlocks.length > 0 ? codeBlocks.join("\n\n") : null;
    }
    case "compact":
      return compactMarkdown(body) || null;
    case "full":
    default:
      return body;
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
        parts.push(`> ${message.createdAt}`);
      }
      parts.push(body);
      return parts.join("\n\n");
    })
    .filter((section): section is string => Boolean(section));
}
