import path from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().positive().default(8787),
  dataDir: z.string().default(path.resolve(process.cwd(), "data")),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): ServerConfig {
  return ConfigSchema.parse({
    host: process.env.AIEXPORTER_HOST,
    port: process.env.AIEXPORTER_PORT,
    dataDir: process.env.AIEXPORTER_DATA_DIR,
  });
}

