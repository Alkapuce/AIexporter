# Browser Live Testing

本文档记录 AIexporter 在本机做真实浏览器/CDP 联调时的完整流程。

## 环境信息

| 项目 | 值 |
|------|-----|
| 浏览器 | Microsoft Edge |
| 可执行文件 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| CDP 端口 | `9445` |
| 用户数据目录 | `%LOCALAPPDATA%\Microsoft\Edge\User Data` |
| Profile | `Default` |
| 扩展 ID | 在 `edge://extensions` 页面查看 |

> 扩展 ID 可在 `edge://extensions` 页面查看，或通过 CDP 动态获取（见下文）。

---

## 1. 启动 Edge（CDP 模式）

先彻底关闭已开的 Edge，否则 `--remote-debugging-port` 不会生效。

```powershell
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$userDataDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'

Start-Process $edge -ArgumentList @(
  '--remote-debugging-port=9445',
  "--user-data-dir=$userDataDir",
  '--profile-directory=Default'
)
Start-Sleep -Seconds 5
```

验证 CDP 是否就绪：

```powershell
Invoke-RestMethod 'http://127.0.0.1:9445/json/version' | ConvertTo-Json -Compress
```

成功时返回：

```json
{"Browser":"Edg/146.0.3856.97","webSocketDebuggerUrl":"ws://127.0.0.1:9445/devtools/browser/..."}
```

---

## 2. 构建并重载扩展

如果修改了 workspace 包，需要按依赖顺序重新构建：

```powershell
# 修改了 packages/ 下的包时
corepack pnpm --filter @aiexporter/core-schema build
corepack pnpm --filter @aiexporter/adapter-sdk build
corepack pnpm --filter @aiexporter/adapters-gemini build

# 始终需要重新构建 extension
corepack pnpm --filter @aiexporter/extension build
```

构建完成后，通过 CDP 重载扩展 runtime：

```powershell
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('chrome-extension://<your-extension-id>/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => chrome.runtime.reload());
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"
```

---

## 3. 动态获取扩展 ID

当扩展 ID 不确定时，从 CDP targets 中解析：

```powershell
node -e "
const http = require('http');
http.get('http://127.0.0.1:9445/json/list', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const targets = JSON.parse(data);
    const worker = targets.find(t => t.type === 'service_worker' && t.url.includes('chrome-extension://'));
    if (worker) {
      const id = worker.url.match(/chrome-extension:\/\/([^\/]+)/)?.[1];
      console.log('Extension ID:', id);
    } else {
      console.log('Service worker not found. Is the extension loaded?');
    }
  });
}).on('error', e => console.error(e));
"
```

---

## 4. 常用检查

### 查看当前所有页面

```powershell
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const pages = browser.contexts().flatMap(ctx => ctx.pages()).map(p => p.url());
  console.log(JSON.stringify(pages, null, 2));
  await browser.close();
})();
"
```

### 查询队列状态

```powershell
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('chrome-extension://<your-extension-id>/dashboard.html', { waitUntil: 'load' });
  const state = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'queue-state-request' }));
  console.log(JSON.stringify(state.services, null, 2));
  await page.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"
```

### 直接访问 Service Worker

MV3 扩展的 background 可通过 CDP targets 直接访问，无需绕道 dashboard：

```powershell
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const ctx = browser.contexts()[0];
  const worker = ctx.serviceWorkers().find(w => w.url().includes('<your-extension-id>'));
  if (!worker) { console.error('Service worker not found'); process.exit(1); }
  const state = await worker.evaluate(async () => chrome.runtime.sendMessage({ type: 'queue-state-request' }));
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"
```

---

## 5. 验证 Dashboard 文件操作（Native Host）

`apps/extension/scripts/verify-dashboard-file-actions.cjs` 是一个完整的集成验证脚本，用于验证：

- Dashboard 加载的是最新构建的 bundle
- 点击"打开最新 Markdown"和"显示导出目录"按钮后，native host 被正确调用
- Notepad 打开了对应的 `.md` 文件
- Explorer 打开了对应的导出目录

**前置条件：**
- Edge 已以 CDP 模式启动（默认端口 `9222`，可通过环境变量覆盖）
- 扩展已构建并加载
- Dashboard 中至少有一条已完成的导出记录

**运行：**

```powershell
# 使用默认端口 9222
node apps/extension/scripts/verify-dashboard-file-actions.cjs

# 指定端口和扩展 ID
$env:AIEXPORTER_EDGE_DEBUG_PORT = '9445'
$env:AIEXPORTER_EXTENSION_ID = '<your-extension-id>'
node apps/extension/scripts/verify-dashboard-file-actions.cjs
```

成功时输出：

```json
{
  "ok": true,
  "extensionId": "<your-extension-id>",
  "openFilePath": "C:\\Users\\<user>\\Downloads\\AIexporter\\chatgpt\\...",
  "notepadState": { "Id": 12345, "MainWindowTitle": "example.md - Notepad" },
  "showFolderDirExists": true
}
```

> 注意：该脚本默认使用端口 `9222`，而本文档的 CDP 启动命令使用 `9445`。运行前需设置 `AIEXPORTER_EDGE_DEBUG_PORT=9445`。

---

## 6. Google 平台注意事项

`gemini.google.com` 和 `aistudio.google.com` 风控较严，测试时建议：

- 单 worker 模式运行
- 手动触发一次 discover，观察结果后再继续
- 测试完毕后及时暂停服务，避免后台持续扫描

AI Studio 历史页入口：`https://aistudio.google.com/library`

Gemini discover 需先展开左上角菜单，再滚动外层历史容器。

---

## 7. 测试结束后暂停服务

```powershell
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('chrome-extension://<your-extension-id>/dashboard.html', { waitUntil: 'load' });
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'service-pause', platform: 'gemini' });
    await chrome.runtime.sendMessage({ type: 'service-pause', platform: 'aistudio' });
  });
  await page.close();
  await browser.close();
})();
"
```

---

## 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| CDP 连接失败 | Edge 未以调试模式启动，或端口被占用 | 重新执行第 1 节的启动命令 |
| Service worker not found | 扩展未加载或 ID 有误 | 检查 `edge://extensions`，用第 3 节动态获取 ID |
| Dashboard 加载旧 bundle | 构建后未重载扩展 | 执行第 2 节的重载命令 |
| verify 脚本找不到按钮 | 队列中没有已完成的导出记录 | 先手动触发一次导出 |
