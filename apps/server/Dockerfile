FROM node:22-bookworm-slim

WORKDIR /app

# Pin pnpm version to match package.json → "packageManager"
# When upgrading pnpm, update both this line and package.json.
RUN corepack prepare pnpm@10.11.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV AIEXPORTER_HOST=0.0.0.0
ENV AIEXPORTER_PORT=8787
ENV AIEXPORTER_DATA_DIR=/app/data

EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]

