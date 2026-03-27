FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV AIEXPORTER_HOST=0.0.0.0
ENV AIEXPORTER_PORT=8787
ENV AIEXPORTER_DATA_DIR=/app/data

EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]

