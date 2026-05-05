import Database from "better-sqlite3";
import type {
  ArchiveFilePaths,
  ConversationArchiveRecord,
  ConversationBundle,
  ConversationDetailsResponse,
  ConversationListQuery,
  ConversationListResponse,
} from "@aiexporter/core-schema";
import { decodeCursor, encodeCursor } from "./utils";

type ConversationRow = {
  platform: string;
  source_id: string;
  title: string | null;
  url: string;
  latest_revision: string;
  latest_source_updated_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  file_bundle_json: string;
  file_markdown: string;
  file_raw_capture: string | null;
};

export class ArchiveDatabase {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        platform TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT,
        url TEXT NOT NULL,
        latest_revision TEXT NOT NULL,
        latest_source_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        file_bundle_json TEXT NOT NULL,
        file_markdown TEXT NOT NULL,
        file_raw_capture TEXT,
        PRIMARY KEY (platform, source_id)
      );

      CREATE TABLE IF NOT EXISTS revisions (
        platform TEXT NOT NULL,
        source_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        extracted_at TEXT NOT NULL,
        source_updated_at TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (platform, source_id, revision)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  getConversation(platform: string, sourceId: string): ConversationArchiveRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT * FROM conversations
          WHERE platform = ? AND source_id = ?
        `,
      )
      .get(platform, sourceId) as ConversationRow | undefined;

    return row ? this.mapConversationRow(row) : null;
  }

  hasRevision(platform: string, sourceId: string, revision: string): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1
          FROM revisions
          WHERE platform = ? AND source_id = ? AND revision = ?
        `,
      )
      .get(platform, sourceId, revision);
    return Boolean(row);
  }

  saveRevision(options: {
    bundle: ConversationBundle;
    revision: string;
    files: ArchiveFilePaths;
  }): ConversationArchiveRecord {
    const now = new Date().toISOString();
    const existing = this.getConversation(options.bundle.platform, options.bundle.sourceId);

    this.db
      .prepare(
        `
          INSERT INTO revisions (platform, source_id, revision, extracted_at, source_updated_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform, source_id, revision) DO NOTHING
        `,
      )
      .run(
        options.bundle.platform,
        options.bundle.sourceId,
        options.revision,
        options.bundle.extractedAt,
        options.bundle.sourceUpdatedAt ?? null,
        now,
      );

    this.db
      .prepare(
        `
          INSERT INTO conversations (
            platform,
            source_id,
            title,
            url,
            latest_revision,
            latest_source_updated_at,
            created_at,
            updated_at,
            message_count,
            file_bundle_json,
            file_markdown,
            file_raw_capture
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform, source_id)
          DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            latest_revision = excluded.latest_revision,
            latest_source_updated_at = excluded.latest_source_updated_at,
            updated_at = excluded.updated_at,
            message_count = excluded.message_count,
            file_bundle_json = excluded.file_bundle_json,
            file_markdown = excluded.file_markdown,
            file_raw_capture = excluded.file_raw_capture
        `,
      )
      .run(
        options.bundle.platform,
        options.bundle.sourceId,
        options.bundle.title ?? null,
        options.bundle.url,
        options.revision,
        options.bundle.sourceUpdatedAt ?? null,
        existing?.createdAt ?? now,
        now,
        options.bundle.messages.length,
        options.files.bundleJson,
        options.files.markdown,
        options.files.rawCapture ?? null,
      );

    return this.getConversation(options.bundle.platform, options.bundle.sourceId)!;
  }

  listConversations(query: ConversationListQuery): ConversationListResponse {
    const params: Array<string | number> = [];
    const whereClauses: string[] = [];

    if (query.platform) {
      whereClauses.push("platform = ?");
      params.push(query.platform);
    }

    if (query.q) {
      whereClauses.push("(source_id LIKE ? OR title LIKE ?)");
      params.push(`%${query.q}%`, `%${query.q}%`);
    }

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      whereClauses.push("(updated_at < ? OR (updated_at = ? AND (platform > ? OR (platform = ? AND source_id > ?))))");
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.platform, cursor.platform, cursor.sourceId);
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM conversations
          ${where}
          ORDER BY updated_at DESC, platform ASC, source_id ASC
          LIMIT ?
        `,
      )
      .all(...params, query.limit) as ConversationRow[];

    const items = rows.map((row) => this.mapConversationRow(row));
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        items.length === query.limit && last
          ? encodeCursor({
              updatedAt: last.updatedAt,
              platform: last.platform,
              sourceId: last.sourceId,
            })
          : undefined,
    };
  }

  getConversationDetails(platform: string, sourceId: string): ConversationDetailsResponse | null {
    const record = this.getConversation(platform, sourceId);
    if (!record) return null;

    const revisions = this.db
      .prepare(
        `
          SELECT revision
          FROM revisions
          WHERE platform = ? AND source_id = ?
          ORDER BY created_at DESC
        `,
      )
      .all(platform, sourceId) as Array<{ revision: string }>;

    return {
      record,
      revisions: revisions.map((row) => row.revision),
    };
  }

  private mapConversationRow(row: ConversationRow): ConversationArchiveRecord {
    return {
      platform: row.platform as ConversationArchiveRecord["platform"],
      sourceId: row.source_id,
      title: row.title ?? undefined,
      url: row.url,
      latestRevision: row.latest_revision,
      latestSourceUpdatedAt: row.latest_source_updated_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      files: {
        bundleJson: row.file_bundle_json,
        markdown: row.file_markdown,
        rawCapture: row.file_raw_capture ?? undefined,
      },
    };
  }
}
