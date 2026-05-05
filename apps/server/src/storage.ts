import fs from "node:fs/promises";
import path from "node:path";
import type { ArchiveFilePaths, ConversationBundle } from "@aiexporter/core-schema";
import { sanitizePathSegment } from "./utils";

export class ArchiveStorage {
  constructor(private readonly rootDir: string) {}

  buildRelativePaths(bundle: ConversationBundle, revision: string, includeRawCapture: boolean): ArchiveFilePaths {
    const base = path.posix.join(
      sanitizePathSegment(bundle.platform),
      sanitizePathSegment(bundle.sourceId),
      sanitizePathSegment(revision),
    );
    return {
      bundleJson: path.posix.join(base, "bundle.json"),
      markdown: path.posix.join(base, "conversation.md"),
      rawCapture: includeRawCapture ? path.posix.join(base, "raw-capture.json") : undefined,
    };
  }

  async writeArchive(options: {
    bundle: ConversationBundle;
    revision: string;
    markdown: string;
    rawCapture?: Record<string, unknown>;
  }): Promise<ArchiveFilePaths> {
    const files = this.buildRelativePaths(options.bundle, options.revision, Boolean(options.rawCapture));
    const bundlePath = path.join(this.rootDir, files.bundleJson);
    await fs.mkdir(path.dirname(bundlePath), { recursive: true });
    await fs.writeFile(bundlePath, JSON.stringify(options.bundle, null, 2), "utf8");
    await fs.writeFile(path.join(this.rootDir, files.markdown), options.markdown, "utf8");

    if (options.rawCapture && files.rawCapture) {
      await fs.writeFile(
        path.join(this.rootDir, files.rawCapture),
        JSON.stringify(options.rawCapture, null, 2),
        "utf8",
      );
    }

    return files;
  }
}
