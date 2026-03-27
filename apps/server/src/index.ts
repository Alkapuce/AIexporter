import { createApp } from "./app";

const { app, config } = await createApp();

await app.listen({
  host: config.host,
  port: config.port,
});

