const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const os = require("node:os");

const stdin = process.stdin;
stdin.resume();

let buffer = Buffer.alloc(0);

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length, 0);
  process.stdout.write(length);
  process.stdout.write(payload);
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function runPowerShell(command) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || `PowerShell exited with status ${result.status}`);
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function buildOpenFilePowerShell(targetPath) {
  const escapedTarget = escapePowerShellSingleQuoted(targetPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$targetPath = '${escapedTarget}'`,
    "$extension = [System.IO.Path]::GetExtension($targetPath)",
    "$progId = (Get-ItemProperty \"HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$extension\\UserChoice\" -ErrorAction SilentlyContinue).ProgId",
    "if (-not $progId) { $progId = (Get-ItemProperty \"Registry::HKEY_CLASSES_ROOT\\$extension\" -ErrorAction SilentlyContinue).'(default)' }",
    "$command = $null",
    "if ($progId) {",
    "  $command = (Get-ItemProperty \"Registry::HKEY_CLASSES_ROOT\\$progId\\shell\\open\\command\" -ErrorAction SilentlyContinue).'(default)'",
    "}",
    "if ($progId -eq 'Antigravity.md') {",
    "  $proc = Start-Process -FilePath 'notepad.exe' -ArgumentList ('\"' + $targetPath + '\"') -PassThru",
    "  Start-Sleep -Milliseconds 800",
    "  $shell = New-Object -ComObject WScript.Shell",
    "  $shell.AppActivate($proc.Id) | Out-Null",
    "  exit 0",
    "}",
    "if ($command) {",
    "  if ($command -match '^\"([^\"]+)\"\\s*(.*)$') {",
    "    $exe = $Matches[1]",
    "    $rest = $Matches[2]",
    "  } else {",
    "    $parts = $command -split '\\s+', 2",
    "    $exe = $parts[0]",
    "    $rest = if ($parts.Length -gt 1) { $parts[1] } else { '' }",
    "  }",
    "  $argumentString = $rest.Replace('%1', ('\"' + $targetPath + '\"')).Replace('%L', ('\"' + $targetPath + '\"')).Replace('%*', ('\"' + $targetPath + '\"'))",
    "  $proc = Start-Process -FilePath $exe -ArgumentList $argumentString -PassThru",
    "  Start-Sleep -Milliseconds 1200",
    "  $shell = New-Object -ComObject WScript.Shell",
    "  if (-not ($shell.AppActivate($proc.Id))) {",
    "    $shell.AppActivate([System.IO.Path]::GetFileNameWithoutExtension($exe)) | Out-Null",
    "  }",
    "  exit 0",
    "}",
    "Start-Process -LiteralPath $targetPath",
    "Start-Sleep -Milliseconds 1200",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shell.AppActivate([System.IO.Path]::GetFileNameWithoutExtension($targetPath)) | Out-Null",
  ].join("; ");
}

function buildShowFolderPowerShell(targetPath) {
  const escapedTarget = escapePowerShellSingleQuoted(targetPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$targetPath = '${escapedTarget}'`,
    "$proc = Start-Process -FilePath 'explorer.exe' -ArgumentList '/select,', $targetPath -PassThru",
    "Start-Sleep -Milliseconds 1200",
    "$shell = New-Object -ComObject WScript.Shell",
    "if (-not ($shell.AppActivate($proc.Id))) {",
    "  $shell.AppActivate('文件资源管理器') | Out-Null",
    "}",
  ].join("; ");
}

function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("A valid path is required.");
  }

  return path.normalize(inputPath);
}

function getDownloadsDirectory() {
  const candidates = [
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : null,
    path.join(os.homedir(), "Downloads"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || os.tmpdir();
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function relocateFile(sourcePath, relativePath) {
  const normalizedSource = normalizePath(sourcePath);
  const normalizedRelative = relativePath.replace(/[\\/]+/g, path.sep);
  const targetPath = path.join(getDownloadsDirectory(), normalizedRelative);

  ensureParentDirectory(targetPath);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }

  try {
    fs.renameSync(normalizedSource, targetPath);
  } catch {
    fs.copyFileSync(normalizedSource, targetPath);
    fs.rmSync(normalizedSource, { force: true });
  }

  return targetPath;
}

function handleMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message payload.");
  }

  if (message.action === "ping") {
    return { ok: true, action: "ping" };
  }

  if (message.action === "open-file") {
    const targetPath = normalizePath(message.path);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    runPowerShell(buildOpenFilePowerShell(targetPath));
    return { ok: true, action: "open-file", path: targetPath };
  }

  if (message.action === "show-folder") {
    const targetPath = normalizePath(message.path);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    const folderPath = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
    const selectTarget = fs.statSync(targetPath).isDirectory() ? folderPath : targetPath;
    runPowerShell(buildShowFolderPowerShell(selectTarget));
    return { ok: true, action: "show-folder", path: folderPath };
  }

  if (message.action === "relocate-file") {
    const sourcePath = normalizePath(message.sourcePath);
    if (!message.relativePath || typeof message.relativePath !== "string") {
      throw new Error("A valid relativePath is required.");
    }
    const relocatedPath = relocateFile(sourcePath, message.relativePath);
    return { ok: true, action: "relocate-file", path: relocatedPath };
  }

  throw new Error(`Unsupported action: ${message.action}`);
}

function consumeBuffer() {
  while (buffer.length >= 4) {
    const messageLength = buffer.readUInt32LE(0);
    if (buffer.length < 4 + messageLength) {
      return;
    }

    const payload = buffer.subarray(4, 4 + messageLength).toString("utf8");
    buffer = buffer.subarray(4 + messageLength);

    try {
      const message = JSON.parse(payload);
      writeMessage(handleMessage(message));
    } catch (error) {
      writeMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consumeBuffer();
});
