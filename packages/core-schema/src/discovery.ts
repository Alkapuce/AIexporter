import { z } from "zod";
import { SourcePlatformSchema } from "./conversation";

export const DiscoveryEventSchema = z.object({
  platform: SourcePlatformSchema,
  sourceId: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional(),
  sourceUpdatedAt: z.string().datetime().optional(),
  sourceUpdatedLabel: z.string().optional(),
  revisionFingerprint: z.string().min(8),
});

export type DiscoveryEvent = z.infer<typeof DiscoveryEventSchema>;
