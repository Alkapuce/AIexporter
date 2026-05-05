const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const DEBUG_PORT = process.env.AIEXPORTER_EDGE_DEBUG_PORT ?? "9222";
const EXTENSION_ID = process.env.AIEXPORTER_EXTENSION_ID ?? "your-extension-id-here";
const DASHBOARD_URL = `chrome-extension://${EXTENSION_ID}/dashboard.html`;
const BACKGROUND_URL = `chrome-extension://${EXTENSION_ID}/background.js`;
const NATIVE_HOST_NAME = "com.aiexporter.shell";

function httpJson(method, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: DEBUG_PORT,
        path: requestPath,
        method,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse ${requestPath}: ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }
      resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws?.close();
  }
}

function readExpectedDashboardScript() {
  const htmlPath = path.resolve(__dirname, "../.output/chrome-mv3/dashboard.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/src="(\/?chunks\/dashboard-[^"]+\.js)"/i);
  if (!match) {
    throw new Error(`Unable to find dashboard bundle in ${htmlPath}`);
  }
  return match[1].replace(/^\//, "");
}

function getPowerShellJson(script) {
  const output = execFileSync("pwsh", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();

  return output ? JSON.parse(output) : null;
}

async function waitFor(check, timeoutMs = 10000, intervalMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = check();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function getTargets() {
  return httpJson("GET", "/json/list");
}

async function main() {
  const expectedScript = readExpectedDashboardScript();
  const targets = await getTargets();
  const dashboardTarget = targets.find((target) => target.type === "page" && target.url === DASHBOARD_URL);
  const workerTarget = targets.find((target) => target.type === "service_worker" && target.url === BACKGROUND_URL);

  if (!dashboardTarget) {
    throw new Error(`Dashboard target not found for ${DASHBOARD_URL}`);
  }
  if (!workerTarget) {
    throw new Error(`Background worker target not found for ${BACKGROUND_URL}`);
  }

  const dashboardClient = new CdpClient(dashboardTarget.webSocketDebuggerUrl);
  const workerClient = new CdpClient(workerTarget.webSocketDebuggerUrl);
  await dashboardClient.connect();
  await workerClient.connect();

  await dashboardClient.send("Runtime.enable");
  await dashboardClient.send("Page.enable");
  await workerClient.send("Runtime.enable");

  const loaded = await dashboardClient.send("Runtime.evaluate", {
    expression: `(() => ({ scripts: Array.from(document.scripts).map((script) => script.src).filter(Boolean) }))()`,
    returnByValue: true,
    awaitPromise: true,
  });
  const loadedScript = loaded.result.value.scripts.find(
    (value) => typeof value === "string" && value.includes("/chunks/dashboard-"),
  );
  if (!loadedScript || !loadedScript.endsWith(expectedScript)) {
    throw new Error(
      `Dashboard is not using the latest bundle. loaded=${loadedScript ?? "none"} expected=${expectedScript}. Reload the extension first.`,
    );
  }

  await workerClient.send("Runtime.evaluate", {
    expression: `(() => {
      self.__nativeProbe = { calls: [], errors: [] };
      const originalSendNativeMessage = chrome.runtime.sendNativeMessage.bind(chrome.runtime);
      chrome.runtime.sendNativeMessage = function(application, message, callback) {
        self.__nativeProbe.calls.push({ application, message });
        return originalSendNativeMessage(application, message, function(response) {
          if (chrome.runtime.lastError?.message) {
            self.__nativeProbe.errors.push(chrome.runtime.lastError.message);
          }
          callback?.(response);
        });
      };
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  await dashboardClient.send("Runtime.evaluate", {
    expression: `(() => {
      const queueTab = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "队列");
      queueTab?.click();
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 400));

  const coords = await dashboardClient.send("Runtime.evaluate", {
    expression: `(() => {
      const openButton = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "打开最新 Markdown" && !button.disabled)[0];
      const showButton = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "显示导出目录" && !button.disabled)[0];
      if (!(openButton instanceof HTMLElement) || !(showButton instanceof HTMLElement)) {
        return { ok: false };
      }
      openButton.scrollIntoView({ block: "center" });
      showButton.scrollIntoView({ block: "center" });
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return { ok: true, open: rectOf(openButton), show: rectOf(showButton) };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  if (!coords.result.value.ok) {
    throw new Error("No enabled file action buttons were found in the queue.");
  }

  for (const point of [coords.result.value.open, coords.result.value.show]) {
    await dashboardClient.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      clickCount: 0,
    });
    await dashboardClient.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await dashboardClient.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const probe = await workerClient.send("Runtime.evaluate", {
    expression: "self.__nativeProbe",
    returnByValue: true,
    awaitPromise: true,
  });

  dashboardClient.close();
  workerClient.close();

  const calls = probe.result.value.calls ?? [];
  const hostErrors = probe.result.value.errors ?? [];
  const openCall = calls.find(
    (call) =>
      call.application === NATIVE_HOST_NAME &&
      call.message?.action === "open-file" &&
      typeof call.message?.path === "string",
  );
  const showCall = calls.find(
    (call) =>
      call.application === NATIVE_HOST_NAME &&
      call.message?.action === "show-folder" &&
      typeof call.message?.path === "string",
  );

  if (!openCall || !showCall) {
    throw new Error(`Native host was not invoked correctly: ${JSON.stringify(probe.result.value)}`);
  }

  if (!String(openCall.message.path).toLowerCase().endsWith(".md")) {
    throw new Error(`Open-file path is not a markdown file: ${openCall.message.path}`);
  }

  if (!String(openCall.message.path).includes(`${path.sep}AIexporter${path.sep}`)) {
    throw new Error(`Open-file path is not under AIexporter export root: ${openCall.message.path}`);
  }

  if (hostErrors.length > 0) {
    throw new Error(`Native host reported errors: ${JSON.stringify(hostErrors)}`);
  }

  const openFilePath = String(openCall.message.path);
  const showFolderPath = String(showCall.message.path);
  const openFileName = path.basename(openFilePath);
  const showFolderDir = path.dirname(showFolderPath);

  const notepadState = await waitFor(() =>
    getPowerShellJson(`
      $match = Get-Process notepad -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like "*${openFileName}*" } |
        Select-Object -First 1 Id,MainWindowTitle,Path
      $match | ConvertTo-Json -Compress
    `),
  );
  if (!notepadState) {
    throw new Error(`Open-file did not surface a Notepad window for ${openFileName}`);
  }

  const explorerState = await waitFor(
    () =>
      getPowerShellJson(`
      $shell = New-Object -ComObject Shell.Application
      $windows = @($shell.Windows())
      $match = foreach ($window in $windows) {
        try {
          if ($window.Document.Folder.Self.Path -like ${JSON.stringify(`*${showFolderDir}*`)}) {
            [pscustomobject]@{ Path = $window.Document.Folder.Self.Path; Location = $window.LocationURL }
          }
        } catch {}
      }
      @($match) | Select-Object -First 1 | ConvertTo-Json -Compress
    `),
    15000,
    750,
  );
  const showFolderDirExists = fs.existsSync(showFolderDir);
  if (!showFolderDirExists) {
    throw new Error(`Show-folder target directory does not exist: ${showFolderDir}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        extensionId: EXTENSION_ID,
        expectedScript,
        loadedScript,
        openFilePath,
        showFolderPath,
        notepadState,
        explorerState,
        showFolderDirExists,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
