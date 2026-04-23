import { useEffect, useState, type CSSProperties } from "react";
import type { ManualExportPreset, QueueState } from "@aiexporter/adapter-sdk";
import {
  getActiveConversationTarget,
  pickExportRoot,
  resolveDefaultDownloadsRoot,
  runManualExport,
  type ActiveConversationTarget,
} from "../../services/dashboard-api";
import { ActionButton } from "./ActionButton";
import {
  applyManualExportPreset,
  createDefaultManualExportOptions,
  describeManualExportPreset,
} from "../../manual-export/options";

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--aiexporter-border-color)",
  background: "var(--aiexporter-surface-muted-background)",
};

interface PopupQuickExportCardProps {
  queueState: QueueState;
  onRefresh: () => Promise<void>;
}

export function PopupQuickExportCard({ queueState, onRefresh }: PopupQuickExportCardProps) {
  const globalExportRoot = queueState.settings.downloads.exportRootPath ?? "";
  const [target, setTarget] = useState<ActiveConversationTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ revision: string; files: string[]; skipped: boolean } | null>(null);
  const [options, setOptions] = useState(() => createDefaultManualExportOptions(globalExportRoot));
  const selectedFormats = [
    options.includeMarkdown ? "Markdown" : null,
    options.includeBundleJson ? "bundle JSON" : null,
  ].filter((value): value is string => Boolean(value));

  const refreshActiveTarget = async () => {
    setError(null);
    const nextTarget = await getActiveConversationTarget();
    setTarget(nextTarget);
    return nextTarget;
  };

  useEffect(() => {
    void refreshActiveTarget().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "无法识别当前标签页。");
    });
    if (!globalExportRoot) {
      void resolveDefaultDownloadsRoot().then((response) => {
        if (response.path) {
          setOptions((current) => ({
            ...current,
            exportRootPath: current.exportRootPath || (response.path ?? ""),
          }));
        }
      });
    }
  }, []);

  useEffect(() => {
    setOptions((current) => {
      if ((current.exportRootPath ?? "") === globalExportRoot) {
        return current;
      }
      if ((current.exportRootPath ?? "") !== "") {
        return current;
      }
      return {
        ...current,
        exportRootPath: globalExportRoot,
      };
    });
  }, [globalExportRoot]);

  const onBrowse = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await pickExportRoot(options.exportRootPath || globalExportRoot || undefined);
      if (response.path) {
        setOptions((current) => ({
          ...current,
          exportRootPath: response.path ?? "",
        }));
      }
    } catch (browseError) {
      setError(browseError instanceof Error ? browseError.message : "选择目录失败。");
    } finally {
      setBusy(false);
    }
  };

  const useHomeDownloads = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await resolveDefaultDownloadsRoot();
      if (response.path) {
        setOptions((current) => ({
          ...current,
          exportRootPath: response.path ?? "",
        }));
      } else {
        setError("无法解析 ~/Downloads。");
      }
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "无法解析 ~/Downloads。");
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    if (!target?.supported || typeof target.tabId !== "number") {
      setError("当前标签页不是可导出的会话页。");
      return;
    }
    if (!options.includeMarkdown && !options.includeBundleJson) {
      setError("至少选择一种导出格式。");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await runManualExport(target.tabId, {
        ...options,
        exportRootPath: options.exportRootPath?.trim() || undefined,
      });
      setResult({
        revision: response.revision,
        files: response.files,
        skipped: response.skipped,
      });
      await onRefresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "导出失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...sectionStyle, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>当前页快捷导出</div>
          <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12, marginTop: 4 }}>
            从当前激活标签页直接导出，不再往网页里注入按钮。
          </div>
        </div>
        <ActionButton
          disabled={busy}
          style={{ background: "var(--aiexporter-button-secondary-background)", color: "var(--aiexporter-button-secondary-text)" }}
          onClick={() => void refreshActiveTarget().catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : "无法识别当前标签页。");
          })}
        >
          识别当前页
        </ActionButton>
      </div>

      <div style={{ ...sectionStyle, background: "var(--aiexporter-surface-background)", gap: 6 }}>
        <div><strong>平台：</strong>{target?.platform ? target.platform : "未识别"}</div>
        <div><strong>标题：</strong>{target?.title || "未识别"}</div>
        <div style={{ wordBreak: "break-all" }}><strong>URL：</strong>{target?.url || "未识别"}</div>
        {!target?.supported ? (
          <div style={{ color: "var(--aiexporter-danger-text-color)", fontSize: 12 }}>
            当前标签页必须是 ChatGPT、Gemini、AI Studio 或 DeepSeek 的会话页。
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>导出目录</div>
        <input
          style={{
            borderRadius: 10,
            border: "1px solid var(--aiexporter-input-border-color)",
            padding: "10px 12px",
            fontSize: 13,
            width: "100%",
            boxSizing: "border-box",
            background: "var(--aiexporter-input-background)",
            color: "var(--aiexporter-input-text-color)",
          }}
          value={options.exportRootPath ?? ""}
          onChange={(event) =>
            setOptions((current) => ({
              ...current,
              exportRootPath: event.target.value,
            }))
          }
          placeholder="默认复用全局导出目录"
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-secondary-background)", color: "var(--aiexporter-button-secondary-text)" }}
            onClick={() => void onBrowse()}
          >
            浏览目录
          </ActionButton>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-secondary-background)", color: "var(--aiexporter-button-secondary-text)" }}
            onClick={() => void useHomeDownloads()}
          >
            用 ~/Downloads
          </ActionButton>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-secondary-background)", color: "var(--aiexporter-button-secondary-text)" }}
            onClick={() =>
              setOptions((current) => ({
                ...current,
                exportRootPath: globalExportRoot,
              }))
            }
          >
            用全局默认
          </ActionButton>
        </div>
        <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
          全局默认目录：{globalExportRoot || "未设置，走浏览器默认下载目录"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>模板预设</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([
            ["complete", "完整"],
            ["standard", "标准"],
            ["share", "分享"],
          ] as const).map(([preset, label]) => (
            <ActionButton
              key={preset}
              disabled={busy}
              style={{
                background:
                  options.preset === preset
                    ? "var(--aiexporter-button-primary-background)"
                    : "var(--aiexporter-button-secondary-background)",
                color:
                  options.preset === preset
                    ? "var(--aiexporter-button-primary-text)"
                    : "var(--aiexporter-button-secondary-text)",
              }}
              onClick={() => setOptions((current) => applyManualExportPreset(current, preset as ManualExportPreset))}
            >
              {label}
            </ActionButton>
          ))}
        </div>
        <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
          {describeManualExportPreset(options.preset)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <div style={sectionStyle}>
          <div style={{ fontWeight: 700 }}>导出格式</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.includeMarkdown}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  includeMarkdown: event.target.checked,
                }))
              }
            />
            <span>Markdown</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.includeBundleJson}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  includeBundleJson: event.target.checked,
                }))
              }
            />
            <span>bundle JSON</span>
          </label>
        </div>

        <div style={sectionStyle}>
          <div style={{ fontWeight: 700 }}>Markdown 内容</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.markdownOptions.includeThinking}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  markdownOptions: {
                    ...current.markdownOptions,
                    includeThinking: event.target.checked,
                  },
                }))
              }
            />
            <span>thinking</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.markdownOptions.includeImages}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  markdownOptions: {
                    ...current.markdownOptions,
                    includeImages: event.target.checked,
                  },
                }))
              }
            />
            <span>图片</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.markdownOptions.includeAttachments}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  markdownOptions: {
                    ...current.markdownOptions,
                    includeAttachments: event.target.checked,
                  },
                }))
              }
            />
            <span>附件块</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.markdownOptions.includeMessageTimestamps}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  markdownOptions: {
                    ...current.markdownOptions,
                    includeMessageTimestamps: event.target.checked,
                  },
                }))
              }
            />
            <span>消息时间</span>
          </label>
        </div>
      </div>

      <div
        style={{
          padding: 10,
          borderRadius: 12,
          background:
            options.includeMarkdown && options.includeBundleJson
              ? "var(--aiexporter-surface-background)"
              : "color-mix(in srgb, var(--aiexporter-warning-background) 18%, transparent)",
          color:
            options.includeMarkdown && options.includeBundleJson
              ? "var(--aiexporter-text-color)"
              : "var(--aiexporter-warning-text-color)",
          fontSize: 12,
        }}
      >
        将导出 {selectedFormats.length > 0 ? selectedFormats.join(" + ") : "无"}
        {!options.includeMarkdown && options.includeBundleJson ? "。当前不会生成 `.md` 文件。" : ""}
        {options.flatOutput !== false ? "，直接保存到所选目录。" : "。"}
      </div>

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--aiexporter-danger-background) 16%, transparent)",
            color: "var(--aiexporter-danger-text-color)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--aiexporter-success-background) 18%, transparent)",
            color: "var(--aiexporter-success-text-color)",
            fontSize: 12,
            display: "grid",
            gap: 4,
          }}
        >
          <div>{result.skipped ? "已复用现有最新导出。" : "导出完成。"}</div>
          <div>Revision: {result.revision}</div>
          <div>文件数：{result.files.length}</div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          disabled={busy || !target?.supported}
          style={{ background: "var(--aiexporter-button-primary-background)" }}
          onClick={() => void onExport()}
        >
          {busy ? "导出中..." : "导出当前页"}
        </ActionButton>
      </div>
    </div>
  );
}
