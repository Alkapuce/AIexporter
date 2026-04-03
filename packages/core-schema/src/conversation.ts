import { z } from "zod";

export const SourcePlatformSchema = z.enum(["chatgpt", "gemini", "aistudio", "deepseek"]);
export type SourcePlatform = z.infer<typeof SourcePlatformSchema>;

export const ParticipantRoleSchema = z.enum(["user", "assistant", "system"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  role: ParticipantRoleSchema,
  name: z.string().min(1),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  markdown: z.string(),
  createdAt: z.string().datetime().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationBundleSchema = z.object({
  platform: SourcePlatformSchema,
  sourceId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1).optional(),
  extractedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().datetime().optional(),
  participants: z.array(ParticipantSchema).min(1),
  messages: z.array(MessageSchema),
  meta: z.record(z.unknown()).optional(),
});
export type ConversationBundle = z.infer<typeof ConversationBundleSchema>;

export const ArchiveFilePathsSchema = z.object({
  bundleJson: z.string(),
  markdown: z.string(),
  rawCapture: z.string().optional(),
});
export type ArchiveFilePaths = z.infer<typeof ArchiveFilePathsSchema>;

export const ConversationArchiveRecordSchema = z.object({
  platform: SourcePlatformSchema,
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url(),
  latestRevision: z.string().min(1),
  latestSourceUpdatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  files: ArchiveFilePathsSchema,
});
export type ConversationArchiveRecord = z.infer<typeof ConversationArchiveRecordSchema>;
