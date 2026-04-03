# Browser Live Testing

本文档记录 AIexporter 在本机做真实浏览器/CDP/Playwright 联调时的最小流程。

## Environment

- Browser: `Microsoft Edge`
- Executable: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- CDP port: `9445`
- Logged-in profile:
  `C:\Users\qpj\AppData\Local\Microsoft\Edge\User Data`
  `Default`
- Repo root:
  `c:\Users\qpj\project\Workspaces\AIexporter`

## Start Edge With CDP

先彻底关闭已开的 Edge，否则新的 `--remote-debugging-port` 往往不会生效。

```powershell
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$userDataDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
$args = @(
  '--remote-debugging-port=9445',
  "--user-data-dir=$userDataDir",
  '--profile-directory=Default'
)

Start-Process $edge -ArgumentList $args
Start-Sleep -Seconds 5
Invoke-RestMethod 'http://127.0.0.1:9445/json/version' | ConvertTo-Json -Compress
```

成功时应返回类似：

```json
{"Browser":"Edg/146.0.3856.97", "...":"...", "webSocketDebuggerUrl":"ws://127.0.0.1:9445/devtools/browser/..."}
```

## Rebuild And Reload Extension

如果改了 workspace 包，例如 `packages/adapters-gemini`、`packages/adapter-sdk`、`packages/core-schema`，先 build 包，再 build extension。

```powershell
corepack pnpm --filter @aiexporter/core-schema build
corepack pnpm --filter @aiexporter/adapter-sdk build
corepack pnpm --filter @aiexporter/adapters-gemini build
corepack pnpm --filter @aiexporter/extension build
```

然后用 CDP 打开 dashboard 并执行 `chrome.runtime.reload()`：

```powershell
@'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('chrome-extension://mllibebijafamehilmldnodfkkimmpdf/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => chrome.runtime.reload());
  await new Promise(resolve => setTimeout(resolve, 3000));
  await browser.close();
})();
'@ | node -
```

当前扩展 id 记录为：

`mllibebijafamehilmldnodfkkimmpdf`

## Basic Playwright/CDP Template

```powershell
@'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  await page.goto('chrome-extension://mllibebijafamehilmldnodfkkimmpdf/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const queue = await page.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'queue-state-request' });
  });

  console.log(JSON.stringify(queue.services, null, 2));
  await browser.close();
})();
'@ | node -
```

## Common Checks

### 1. Confirm CDP is alive

```powershell
Invoke-RestMethod 'http://127.0.0.1:9445/json/version' | ConvertTo-Json -Compress
```

### 2. Check current Edge pages

```powershell
@'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const pages = browser.contexts().flatMap(ctx => ctx.pages()).map(page => page.url());
  console.log(JSON.stringify(pages, null, 2));
  await browser.close();
})();
'@ | node -
```

### 3. Check extension runtime state

```powershell
@'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('chrome-extension://mllibebijafamehilmldnodfkkimmpdf/dashboard.html', { waitUntil: 'load' });
  const state = await page.evaluate(async () => await chrome.runtime.sendMessage({ type: 'queue-state-request' }));
  console.log(JSON.stringify(state.services, null, 2));
  await page.close();
  await browser.close();
})();
'@ | node -
```

## Google Platform Notes

- `gemini.google.com` 和 `aistudio.google.com` 风控更严，测试时优先：
  - 单 worker
  - 手动触发一次 discover
  - 验证后及时 `service-pause`
- AI Studio 历史页入口：
  `https://aistudio.google.com/library`
- Gemini 历史 discover 要先展开左上角菜单，再滚外层历史容器。

## Finish Cleanly

实测后建议暂停相关平台，避免后台继续扫站点：

```powershell
@'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9445');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('chrome-extension://mllibebijafamehilmldnodfkkimmpdf/dashboard.html', { waitUntil: 'load' });
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'service-pause', platform: 'gemini' });
    await chrome.runtime.sendMessage({ type: 'service-pause', platform: 'aistudio' });
  });
  await page.close();
  await browser.close();
})();
'@ | node -
```
