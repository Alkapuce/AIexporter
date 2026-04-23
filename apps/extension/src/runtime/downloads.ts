function toDataUrl(content: string, mimeType: string): string {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
}

function toBase64DataUrl(contentBase64: string, mimeType: string): string {
  return `data:${mimeType};base64,${contentBase64}`;
}

import { pingNativeHost, relocateFileWithNativeHost } from "./native-host";

export interface DownloadedAsset {
  downloadId: number;
  filename: string;
}

interface DownloadTextAssetOptions {
  forceFresh?: boolean;
  requireRelocation?: boolean;
}

interface DownloadChangeDelta {
  id: number;
  error?: {
    current?: string;
  };
  state?: {
    current?: string;
  };
}

interface DownloadSearchResult {
  id?: number;
  state?: string;
  filename?: string;
  exists?: boolean;
  startTime?: string;
}

async function findExistingCompletedDownload(filename: string): Promise<DownloadedAsset | null> {
  const matches = (await browser.downloads.search({ state: "complete" } as browser.downloads.DownloadQuery)) as DownloadSearchResult[];
  const normalizedExpected = filename.replace(/\//g, "\\").toLowerCase();
  const existing = matches
    .filter(
      (item) =>
        typeof item.filename === "string" &&
        item.filename.replace(/\//g, "\\").toLowerCase().endsWith(normalizedExpected) &&
        item.state === "complete" &&
        item.exists === true &&
        typeof item.id === "number",
    )
    .sort((left, right) => Date.parse(right.startTime ?? "") - Date.parse(left.startTime ?? ""))[0];

  if (!existing || typeof existing.id !== "number" || !existing.filename) {
    return null;
  }

  return {
    downloadId: existing.id,
    filename: existing.filename,
  };
}

async function waitForDownloadCompletion(downloadId: number, timeoutMs = 30_000): Promise<void> {
  const initial = await browser.downloads.search({ id: downloadId });
  const state = initial[0]?.state;
  if (state === "complete") return;
  if (state === "interrupted") {
    throw new Error(`Download ${downloadId} was interrupted before completion.`);
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.downloads.onChanged.removeListener(listener);
      reject(new Error(`Timed out while waiting for download ${downloadId} to complete.`));
    }, timeoutMs);

    const listener = (delta: DownloadChangeDelta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;

      if (delta.state.current === "complete") {
        clearTimeout(timeout);
        browser.downloads.onChanged.removeListener(listener);
        resolve();
      }

      if (delta.state.current === "interrupted") {
        clearTimeout(timeout);
        browser.downloads.onChanged.removeListener(listener);
        const reason = delta.error?.current ? ` (${delta.error.current})` : "";
        reject(new Error(`Download ${downloadId} was interrupted${reason}.`));
      }
    };

    browser.downloads.onChanged.addListener(listener);
  });
}

async function getCompletedDownloadFilename(downloadId: number): Promise<string> {
  const matches = await browser.downloads.search({ id: downloadId });
  const filename = matches[0]?.filename;
  if (!filename) {
    throw new Error(`Download ${downloadId} completed but no filename was reported.`);
  }
  return filename;
}

export async function isDownloadedAssetPresent(downloadId: number | undefined, filename?: string): Promise<boolean> {
  if (typeof downloadId === "number") {
    const matches = (await browser.downloads.search({ id: downloadId })) as DownloadSearchResult[];
    const match = matches[0];
    if (match?.state === "complete" && match.exists === true) {
      return true;
    }
  }

  if (filename) {
    return (await findExistingCompletedDownload(filename)) !== null;
  }

  return false;
}

export async function applyDownloadUiPreference(enabled: boolean): Promise<void> {
  const downloadsApi = browser.downloads as typeof browser.downloads & {
    setUiOptions?: (options: { enabled: boolean }) => Promise<void>;
  };
  if (!downloadsApi.setUiOptions) {
    throw new Error("downloads.setUiOptions is not available in this browser.");
  }
  await downloadsApi.setUiOptions({ enabled });
}

async function downloadDataUrlAsset(
  dataUrl: string,
  filename: string,
  options: DownloadTextAssetOptions,
  rootPath?: string,
): Promise<DownloadedAsset> {
  const existing = options.forceFresh ? null : await findExistingCompletedDownload(filename);
  if (existing) {
    return existing;
  }

  const downloadId = await browser.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });

  if (typeof downloadId !== "number") {
    throw new Error(`Downloads API returned an invalid id for ${filename}.`);
  }

  await waitForDownloadCompletion(downloadId);
  const actualFilename = await getCompletedDownloadFilename(downloadId);
  let resolvedFilename = actualFilename;

  try {
    await pingNativeHost();
    const relocated = await relocateFileWithNativeHost(actualFilename, filename, rootPath);
    if (relocated.path) {
      resolvedFilename = relocated.path;
    }
  } catch {
    resolvedFilename = actualFilename;
  }

  return {
    downloadId,
    filename: resolvedFilename,
  };
}

export async function downloadTextAsset(
  filename: string,
  content: string,
  mimeType: string,
  options: DownloadTextAssetOptions = {},
  rootPath?: string,
): Promise<DownloadedAsset> {
  return downloadDataUrlAsset(toDataUrl(content, mimeType), filename, options, rootPath);
}

export async function downloadBinaryAsset(
  filename: string,
  contentBase64: string,
  mimeType: string,
  options: DownloadTextAssetOptions = {},
  rootPath?: string,
): Promise<DownloadedAsset> {
  return downloadDataUrlAsset(toBase64DataUrl(contentBase64, mimeType), filename, options, rootPath);
}

export async function downloadRemoteAsset(
  filename: string,
  url: string,
  options: DownloadTextAssetOptions = {},
  rootPath?: string,
): Promise<DownloadedAsset> {
  const existing =
    options.forceFresh || options.requireRelocation ? null : await findExistingCompletedDownload(filename);
  if (existing) {
    return existing;
  }

  const downloadId = await browser.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });

  if (typeof downloadId !== "number") {
    throw new Error(`Downloads API returned an invalid id for ${filename}.`);
  }

  await waitForDownloadCompletion(downloadId, 60_000);
  const actualFilename = await getCompletedDownloadFilename(downloadId);
  let resolvedFilename = actualFilename;

  try {
    await pingNativeHost();
    const relocated = await relocateFileWithNativeHost(actualFilename, filename, rootPath);
    if (relocated.path) {
      resolvedFilename = relocated.path;
    }
  } catch (err) {
    if (options.requireRelocation) {
      throw err;
    }
    resolvedFilename = actualFilename;
  }

  return {
    downloadId,
    filename: resolvedFilename,
  };
}

export async function showDownloadedAsset(downloadId: number | undefined): Promise<void> {
  if (typeof downloadId !== "number") {
    throw new Error("No download id was provided.");
  }
  await browser.downloads.show(downloadId);
}

export async function openDownloadedAsset(downloadId: number | undefined): Promise<void> {
  if (typeof downloadId !== "number") {
    throw new Error("No download id was provided.");
  }
  await browser.downloads.open(downloadId);
}

export async function removeDownloadedAsset(downloadId: number | undefined): Promise<void> {
  if (typeof downloadId !== "number") return;

  try {
    await browser.downloads.removeFile(downloadId);
  } catch {
    return;
  }
}
