import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { NoopAuthProvider } from "./auth";
import { loadConfig, type ServerConfig } from "./config";
import { ArchiveDatabase } from "./db";
import { registerRoutes } from "./routes";
import { ArchiveStorage } from "./storage";

export async function createApp(configOverrides?: Partial<ServerConfig>) {
  const config = { ...loadConfig(), ...configOverrides };
  await fs.mkdir(config.dataDir, { recursive: true });

  const db = new ArchiveDatabase(path.join(config.dataDir, "aiexporter.sqlite"));
  db.initialize();

  const app = Fastify({ logger: false });
  const storage = new ArchiveStorage(config.dataDir);

  await registerRoutes(app, {
    authProvider: new NoopAuthProvider(),
    db,
    storage,
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  return {
    app,
    config,
  };
}
