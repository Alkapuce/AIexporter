import { z } from "zod";
import {
  ArchiveFilePathsSchema,
  ConversationArchiveRecordSchema,
  ConversationBundleSchema,
  SourcePlatformSchema,
} from "./conversation";

export const IngestClientSchema = z.object({
  extensionVersion: z.string().min(1),
  browser: z.string().min(1),
});

export const IngestConversationRequestSchema = z.object({
  bundle: ConversationBundleSchema,
  rawCapture: z.record(z.unknown()).optional(),
  client: IngestClientSchema,
});
export type IngestConversationRequest = z.infer<typeof IngestConversationRequestSchema>;

export const IngestConversationResponseSchema = z.object({
  status: z.enum(["created", "updated", "duplicate"]),
  conversationKey: z.string().min(1),
  revision: z.string().min(1),
  files: ArchiveFilePathsSchema,
});
export type IngestConversationResponse = z.infer<typeof IngestConversationResponseSchema>;

export const ConversationListQuerySchema = z.object({
  platform: SourcePlatformSchema.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationArchiveRecordSchema),
  nextCursor: z.string().optional(),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const ConversationDetailsResponseSchema = z.object({
  record: ConversationArchiveRecordSchema,
  revisions: z.array(z.string()),
});
export type ConversationDetailsResponse = z.infer<typeof ConversationDetailsResponseSchema>;

