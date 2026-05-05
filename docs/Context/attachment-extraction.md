# 附件抓取路径

## DeepSeek

**来源**：API 响应 `files[]` 字段（主路径）+ API 响应 markdown URL（补充）+ DOM 附件卡片（兜底合并）

```
history.ts: fetchDeepSeekConversationViaPageWorld()
  ├─ API 响应 files[] → adapter.ts:buildFileAttachmentBlocks()
  │    └─ message.files[].{file_name, file_size} → > [attachment] name (size)
  │         不依赖 DOM，手动/自动导出结果一致
  ├─ API 响应 markdown URL → adapter.ts:57-89
  │    └─ 正则扫 https?://... URL，按扩展名分类图片/文档
  │         → 追加为 ![name](url) 或 > [attachment] [name](url)
  └─ DOM 卡片合并 → history.ts:mergeApiBundleWithDomAttachments()
       └─ 仅当消息 markdown 中尚无 [attachment] 时才合并
            （API 已有 files[] 时此步骤为 no-op）
```

- 存储：**文件名 + 大小**（无下载 URL，preview API 返回临时签名链接不持久化）
- 缺口：无法直接下载附件内容（需调 `/api/v0/file/preview` 获取临时 URL）

---

## Gemini

**来源**：`hNvQHb` RPC payload 递归遍历 + DOM 图片合并兜底

```
content-runtime.ts: fetchGeminiConversationViaPageWorld()
  ├─ RPC payload → adapter.ts:138-203
  │    ├─ 图片：匹配 lh3.googleusercontent.com/gg/ CDN URL
  │    ├─ 文档：按扩展名/MIME 过滤文档 URL
  │    └─ 继承过滤：跨 turn 去重，避免重复计入上一轮附件
  └─ DOM 合并 → content-runtime.ts:89-179
       └─ RPC 图片数 < DOM 图片数时，从 DOM 补充
```

- 存储：**远程 URL**（Google CDN），不嵌入
- 缺口：CDN 可访问性依赖，RPC 数组结构脆弱

---

## AI Studio

**来源**：`ResolveDriveResource` RPC payload 内联 base64 + Drive 链接 + DOM 图片合并

```
content-runtime.ts: fetchAiStudioResolvedPromptPayload()
  ├─ 内联附件 → aistudio-response.ts:154-173
  │    ├─ image/*：嵌为 data URI → ![id.ext](data:image/png;base64,...)
  │    └─ text/*：base64 解码 → fenced code block
  ├─ Drive 资源 → aistudio-response.ts:139-152
  │    └─ 提取 Drive ID → > [attachment] [Google Drive resource {id}](drive.google.com/open?id={id})
  │         同时写入 meta.linkedAttachments[]
  └─ DOM 合并 → content-runtime.ts:172-226
       └─ Drive 链接存在但图片数不足时从 DOM 补图（上限 12 张/消息）
```

- 存储：内联图片 **base64 嵌入**（离线可用），Drive 资源为**链接**（需权限）
- 缺口：大图 base64 膨胀 bundle JSON，Drive 链接依赖权限

---

## 对比

| | DeepSeek | Gemini | AI Studio |
|---|---|---|---|
| 图片存储 | 远程 URL | 远程 URL (CDN) | base64 嵌入 |
| 文档存储 | 远程 URL | 远程 URL | Drive 链接 |
| DOM 合并触发 | 总是合并卡片 | 图片数不足时 | 图片数不足时 |
| linkedAttachments | 无 | 无 | Drive 资源有 |
| 离线可用性 | 差 | 差 | 图片完整，文档需权限 |
