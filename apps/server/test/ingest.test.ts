import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("ingest API", () => {
  it("stores bundles idempotently", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aiexporter-test-"));
    const { app } = await createApp({ dataDir, host: "127.0.0.1", port: 8787 });

    const payload = {
      bundle: {
        platform: "chatgpt",
        sourceId: "conv-1",
        url: "https://chatgpt.com/c/conv-1",
        title: "Test conversation",
        extractedAt: "2026-03-18T08:00:00.000Z",
        sourceUpdatedAt: "2026-03-18T08:00:00.000Z",
        participants: [
          { id: "user", role: "user", name: "User" },
          { id: "assistant", role: "assistant", name: "ChatGPT" },
        ],
        messages: [
          { id: "m1", role: "user", markdown: "Hello" },
          { id: "m2", role: "assistant", markdown: "Hi" },
        ],
      },
      client: {
        extensionVersion: "0.1.0",
        browser: "edge",
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/conversations",
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("created");

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/conversations",
      payload,
    });
    expect(second.json().status).toBe("duplicate");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/conversations?platform=chatgpt&limit=10",
    });
    expect(list.json().items).toHaveLength(1);

    const markdownPath = path.join(dataDir, first.json().files.markdown);
    const markdown = await fs.readFile(markdownPath, "utf8");
    expect(markdown).toContain("## Assistant");

    await app.close();
  });
});
