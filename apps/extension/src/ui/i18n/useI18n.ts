import type { UiLocale } from "@aiexporter/adapter-sdk";
import { enMessages } from "./messages/en";
import { zhCNMessages } from "./messages/zh-CN";

const messageCatalog = {
  "zh-CN": zhCNMessages,
  en: enMessages,
} as const;

export type MessageKey = keyof typeof zhCNMessages;

export function useI18n(locale: UiLocale) {
  const bundle = messageCatalog[locale] ?? zhCNMessages;

  return {
    locale,
    t(key: MessageKey): string {
      return bundle[key] ?? zhCNMessages[key];
    },
  };
}
