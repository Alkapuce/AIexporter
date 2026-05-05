export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function encodeCursor(payload: { updatedAt: string; platform: string; sourceId: string }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor?: string): { updatedAt: string; platform: string; sourceId: string } | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      updatedAt: string;
      platform: string;
      sourceId: string;
    };
  } catch {
    return null;
  }
}
