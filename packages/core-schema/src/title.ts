import type { ConversationBundle } from "./conversation";

const FALLBACK_PROMPT_TITLE_MAX_LENGTH = 48;

const GENERIC_TITLE_PATTERNS = [
  /^google gemini$/i,
  /^gemini$/i,
  /^google ai studio$/i,
  /^ai studio$/i,
  /^deepseek$/i,
  /^chatgpt$/i,
  /^new chat$/i,
  /^untitled/i,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeOpaqueIdentifier(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (/^[a-f0-9]{8,}$/i.test(normalized)) return true;
  if (/^[a-z0-9_-]{8,}$/i.test(normalized) && !/[^\da-f]/i.test(normalized)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(normalized)) return true;
  return false;
}

export function isGenericConversationTitle(
  title: string | undefined,
  sourceId?: string,
): boolean {
  const normalized = normalizeWhitespace(title ?? "");
  if (!normalized) return true;
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (sourceId && normalized.toLowerCase() === sourceId.trim().toLowerCase()) return true;
  return looksLikeOpaqueIdentifier(normalized);
}

export function normalizeConversationTitle(
  title: string | undefined,
  sourceId?: string,
): string | undefined {
  const normalized = normalizeWhitespace(title ?? "");
  if (!normalized) return undefined;
  if (isGenericConversationTitle(normalized, sourceId)) return undefined;
  return normalized;
}

function stripMarkdownDecorators(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[(?:attachment|thinking)]/gi, " ")
      .replace(/^>\s*/gm, "")
      .replace(/[`*_#>-]+/g, " "),
  );
}

export function extractFirstUserPromptTitle(bundle: ConversationBundle): string | undefined {
  const firstUserMessage = bundle.messages.find((message) => message.role === "user");
  if (!firstUserMessage) return undefined;
  const firstParagraph = stripMarkdownDecorators(firstUserMessage.markdown)
    .split(/\n{2,}|\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstParagraph) return undefined;
  const sliced = firstParagraph.slice(0, FALLBACK_PROMPT_TITLE_MAX_LENGTH).trim();
  return normalizeConversationTitle(sliced, bundle.sourceId);
}

export function resolveBundleTitle(bundle: ConversationBundle, preferredTitle?: string): {
  title: string;
  usedFallback: boolean;
  unresolved: boolean;
} {
  const fallbackPromptTitle = extractFirstUserPromptTitle(bundle);
  const normalizedPreferredTitle = normalizeConversationTitle(preferredTitle, bundle.sourceId);
  const normalizedBundleTitle = normalizeConversationTitle(bundle.title, bundle.sourceId);
  const bundleLooksLikePromptFallback =
    Boolean(normalizedBundleTitle) &&
    Boolean(fallbackPromptTitle) &&
    normalizedBundleTitle === fallbackPromptTitle;

  if (normalizedPreferredTitle && (!normalizedBundleTitle || bundleLooksLikePromptFallback)) {
    return {
      title: normalizedPreferredTitle,
      usedFallback: false,
      unresolved: false,
    };
  }

  if (normalizedBundleTitle) {
    return {
      title: normalizedBundleTitle,
      usedFallback: false,
      unresolved: false,
    };
  }

  if (fallbackPromptTitle) {
    return {
      title: fallbackPromptTitle,
      usedFallback: true,
      unresolved: false,
    };
  }

  return {
    title: bundle.sourceId,
    usedFallback: false,
    unresolved: true,
  };
}
