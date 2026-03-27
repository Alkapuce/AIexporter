import { buildBundleRevision } from "@aiexporter/adapter-sdk";
import { serializeConversation } from "@aiexporter/core-markdown";
import {
  ConversationDetailsResponseSchema,
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  IngestConversationRequestSchema,
  IngestConversationResponseSchema,
  SourcePlatformSchema,
} from "@aiexporter/core-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthProvider } from "./auth";
import type { ArchiveDatabase } from "./db";
import type { ArchiveStorage } from "./storage";

const ParamsSchema = z.object({
  platform: SourcePlatformSchema,
  sourceId: z.string().min(1),
});

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: {
    authProvider: AuthProvider;
    db: ArchiveDatabase;
    storage: ArchiveStorage;
  },
): Promise<void> {
  app.get("/healthz", async () => ({ ok: true, timestamp: new Date().toISOString() }));

  app.post("/api/v1/ingest/conversations", async (request, reply) => {
    await dependencies.authProvider.authenticate(request);
    const payload = IngestConversationRequestSchema.parse(request.body);
    const revision = await buildBundleRevision(payload.bundle);
    const existing = dependencies.db.getConversation(payload.bundle.platform, payload.bundle.sourceId);

    if (dependencies.db.hasRevision(payload.bundle.platform, payload.bundle.sourceId, revision)) {
      const files = dependencies.storage.buildRelativePaths(payload.bundle, revision, Boolean(payload.rawCapture));
      return reply.send(
        IngestConversationResponseSchema.parse({
          status: "duplicate",
          conversationKey: `${payload.bundle.platform}:${payload.bundle.sourceId}`,
          revision,
          files,
        }),
      );
    }

    const markdown = serializeConversation(payload.bundle, { revision }).markdown;
    const files = await dependencies.storage.writeArchive({
      bundle: payload.bundle,
      revision,
      markdown,
      rawCapture: payload.rawCapture,
    });

    dependencies.db.saveRevision({
      bundle: payload.bundle,
      revision,
      files,
    });

    return reply.send(
      IngestConversationResponseSchema.parse({
        status: existing ? "updated" : "created",
        conversationKey: `${payload.bundle.platform}:${payload.bundle.sourceId}`,
        revision,
        files,
      }),
    );
  });

  app.get("/api/v1/conversations", async (request, reply) => {
    await dependencies.authProvider.authenticate(request);
    const query = ConversationListQuerySchema.parse(request.query);
    return reply.send(ConversationListResponseSchema.parse(dependencies.db.listConversations(query)));
  });

  app.get("/api/v1/conversations/:platform/:sourceId", async (request, reply) => {
    await dependencies.authProvider.authenticate(request);
    const params = ParamsSchema.parse(request.params);
    const response = dependencies.db.getConversationDetails(params.platform, params.sourceId);
    if (!response) {
      return reply.code(404).send({ message: "Conversation not found." });
    }
    return reply.send(ConversationDetailsResponseSchema.parse(response));
  });
}

