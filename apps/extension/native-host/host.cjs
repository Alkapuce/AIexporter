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
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });

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
  const resolvedPath = path.resolve(path.normalize(targetPath));
  const escapedTarget = escapePowerShellSingleQuoted(resolvedPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$targetPath = '${escapedTarget}'`,
    // Invoke-Item delegates to Windows ShellExecute, which is the canonical
    // way to open a file with the system's default handler — exactly as if
    // the user double-clicked the file in Explorer.
    "Invoke-Item -LiteralPath $targetPath",
    // Give the target application a moment to open its window, then try to
    // bring it to the foreground for a smoother UX.
    "Start-Sleep -Milliseconds 800",
    "$shell = New-Object -ComObject WScript.Shell",
    "if (-not ($shell.AppActivate([System.IO.Path]::GetFileNameWithoutExtension($targetPath)))) {",
    "  $shell.AppActivate([System.IO.Path]::GetFileName($targetPath)) | Out-Null",
    "}",
  ].join("; ");
}

function buildShowFolderPowerShell(targetPath) {
  const resolvedPath = path.resolve(path.normalize(targetPath));
  const escapedTarget = escapePowerShellSingleQuoted(resolvedPath);
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

function buildPickFolderPowerShell(initialPath) {
  const resolvedPath = initialPath ? path.resolve(path.normalize(initialPath)) : "";
  const escapedInitialPath = escapePowerShellSingleQuoted(resolvedPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select AIexporter export folder'",
    "$dialog.ShowNewFolderButton = $true",
    `$initialPath = '${escapedInitialPath}'`,
    "if ($initialPath -and (Test-Path -LiteralPath $initialPath)) { $dialog.SelectedPath = $initialPath }",
    "$result = $dialog.ShowDialog()",
    "if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $dialog.SelectedPath) { exit 3 }",
    "Write-Output $dialog.SelectedPath",
  ].join("; ");
}

function buildRecyclePathPowerShell(targetPath) {
  const resolvedPath = path.resolve(path.normalize(targetPath));
  const escapedTarget = escapePowerShellSingleQuoted(resolvedPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    `$targetPath = '${escapedTarget}'`,
    "if (-not (Test-Path -LiteralPath $targetPath)) { exit 0 }",
    "$attributes = Get-Item -LiteralPath $targetPath",
    "if ($attributes.PSIsContainer) {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($targetPath, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "} else {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($targetPath, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "}",
  ].join("; ");
}

function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("A valid path is required.");
  }

  return path.normalize(inputPath);
}

function readRegistryValue(keyPath, valueName) {
  const result = spawnSync("reg.exe", ["query", keyPath, "/v", valueName], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || !result.stdout) {
    return null;
  }

  const line = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(valueName));
  if (!line) {
    return null;
  }

  const parts = line.split(/\s{2,}/).filter(Boolean);
  return parts[2] || null;
}

function expandWindowsEnvPath(inputPath) {
  if (!inputPath) return inputPath;
  return inputPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
}

function getKnownFolderDownloadsDirectory() {
  const registryValue = readRegistryValue(
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
    "{374DE290-123F-4565-9164-39C4925E467B}",
  );
  if (!registryValue) {
    return null;
  }

  return path.normalize(expandWindowsEnvPath(registryValue));
}

function getDownloadsDirectory() {
  const candidates = [
    getKnownFolderDownloadsDirectory(),
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

function isPathWithinRoot(candidatePath, rootPath) {
  const normalizedCandidate = path.resolve(normalizePath(candidatePath));
  const normalizedRoot = path.resolve(normalizePath(rootPath));
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePathForComparison(inputPath) {
  const resolved = path.resolve(normalizePath(inputPath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSameOrNestedPath(candidatePath, rootPath) {
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  const normalizedRoot = normalizePathForComparison(rootPath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pruneEmptyParentDirectories(startPath, stopPath) {
  let currentPath = normalizePath(startPath);
  const normalizedStop = normalizePath(stopPath);

  while (currentPath !== normalizedStop && isPathWithinRoot(currentPath, normalizedStop)) {
    if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
      break;
    }

    if (fs.readdirSync(currentPath).length > 0) {
      break;
    }

    fs.rmdirSync(currentPath);
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
}

function cleanupRelocatedSourceDirectories(sourcePath) {
  const downloadsRoot = getDownloadsDirectory();
  const sourceDirectory = path.dirname(normalizePath(sourcePath));
  if (!fs.existsSync(downloadsRoot) || !isPathWithinRoot(sourceDirectory, downloadsRoot)) {
    return;
  }
  pruneEmptyParentDirectories(sourceDirectory, downloadsRoot);
}

function resolveExportRoot(rootPath) {
  const candidate =
    typeof rootPath === "string" && rootPath.trim() ? normalizePath(rootPath.trim()) : getDownloadsDirectory();
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function resolveTargetPath(relativePath, rootPath) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("A valid relativePath is required.");
  }

  const exportRoot = resolveExportRoot(rootPath);
  const normalizedRelative = relativePath.replace(/[\\/]+/g, path.sep);
  const targetPath = path.resolve(exportRoot, normalizedRelative);
  const normalizedRoot = path.resolve(exportRoot);
  const relativeToRoot = path.relative(normalizedRoot, targetPath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("relativePath escaped the configured export root.");
  }

  return targetPath;
}

function relocateFile(sourcePath, relativePath, rootPath) {
  const normalizedSource = normalizePath(sourcePath);
  const targetPath = resolveTargetPath(relativePath, rootPath);

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

  cleanupRelocatedSourceDirectories(normalizedSource);
  return targetPath;
}

function movePath(sourcePath, targetPath) {
  const normalizedSource = normalizePath(sourcePath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizePathForComparison(normalizedSource) === normalizePathForComparison(normalizedTarget)) {
    return normalizedTarget;
  }
  if (isSameOrNestedPath(normalizedTarget, normalizedSource)) {
    throw new Error("Refusing to move a path into itself or one of its children.");
  }
  if (isSameOrNestedPath(normalizedSource, normalizedTarget)) {
    throw new Error("Refusing to replace a parent directory with one of its children.");
  }
  ensureParentDirectory(normalizedTarget);

  if (!fs.existsSync(normalizedSource)) {
    throw new Error(`Path does not exist: ${normalizedSource}`);
  }

  if (fs.existsSync(normalizedTarget)) {
    fs.rmSync(normalizedTarget, { recursive: true, force: true });
  }

  fs.renameSync(normalizedSource, normalizedTarget);
  return normalizedTarget;
}

function writeFile(relativePath, content, encoding, rootPath) {
  const targetPath = resolveTargetPath(relativePath, rootPath);
  ensureParentDirectory(targetPath);
  if (encoding === "base64") {
    fs.writeFileSync(targetPath, Buffer.from(typeof content === "string" ? content : "", "base64"));
  } else {
    fs.writeFileSync(targetPath, typeof content === "string" ? content : "", "utf8");
  }
  return targetPath;
}

function listFiles(targetPath, pattern, recursive) {
  const normalizedRoot = normalizePath(targetPath);
  if (!fs.existsSync(normalizedRoot)) {
    return [];
  }

  const matcher = new RegExp(
    `^${String(pattern || "*")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );
  const results = [];
  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          walk(nextPath);
        }
        continue;
      }
      if (matcher.test(entry.name)) {
        results.push(nextPath);
      }
    }
  };

  walk(normalizedRoot);
  return results;
}

function readFileContent(targetPath, encoding) {
  const normalizedPath = normalizePath(targetPath);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Path does not exist: ${normalizedPath}`);
  }

  if (encoding === "base64") {
    return fs.readFileSync(normalizedPath).toString("base64");
  }

  return fs.readFileSync(normalizedPath, "utf8");
}

function pruneOldFiles(targetPath, pattern, recursive, olderThanDays) {
  const normalizedRoot = normalizePath(targetPath);
  if (!fs.existsSync(normalizedRoot)) {
    return [];
  }

  const thresholdMs = Math.max(1, Number(olderThanDays) || 0) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const pruned = [];
  const candidates = listFiles(normalizedRoot, pattern, recursive);

  for (const candidate of candidates) {
    const stats = fs.statSync(candidate);
    if (now - stats.mtimeMs < thresholdMs) {
      continue;
    }
    runPowerShell(buildRecyclePathPowerShell(candidate));
    pruned.push(candidate);
  }

  return pruned;
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
    const relocatedPath = relocateFile(sourcePath, message.relativePath, message.rootPath);
    return { ok: true, action: "relocate-file", path: relocatedPath };
  }

  if (message.action === "move-path") {
    const movedPath = movePath(message.sourcePath, message.path);
    return { ok: true, action: "move-path", path: movedPath };
  }

  if (message.action === "recycle-path") {
    const targetPath = normalizePath(message.path);
    runPowerShell(buildRecyclePathPowerShell(targetPath));
    return { ok: true, action: "recycle-path", path: targetPath };
  }

  if (message.action === "path-exists") {
    const targetPath = normalizePath(message.path);
    return {
      ok: true,
      action: "path-exists",
      path: fs.existsSync(targetPath) ? targetPath : undefined,
    };
  }

  if (message.action === "write-file") {
    const targetPath = writeFile(message.relativePath, message.content, message.encoding, message.rootPath);
    return {
      ok: true,
      action: "write-file",
      path: targetPath,
    };
  }

  if (message.action === "pick-folder") {
    const initialPath =
      typeof message.path === "string" && message.path.trim() ? normalizePath(message.path) : undefined;
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", buildPickFolderPowerShell(initialPath)],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status === 3) {
      return {
        ok: true,
        action: "pick-folder",
      };
    }

    if (typeof result.status === "number" && result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      throw new Error(detail || `PowerShell exited with status ${result.status}`);
    }

    const pickedPath = result.stdout?.trim();
    return {
      ok: true,
      action: "pick-folder",
      path: pickedPath || undefined,
    };
  }

  if (message.action === "list-files") {
    const paths = listFiles(message.path, message.pattern, message.recursive !== false);
    return {
      ok: true,
      action: "list-files",
      paths,
    };
  }

  if (message.action === "read-file") {
    return {
      ok: true,
      action: "read-file",
      content: readFileContent(message.path, message.encoding),
      path: normalizePath(message.path),
    };
  }

  if (message.action === "resolve-export-root") {
    return {
      ok: true,
      action: "resolve-export-root",
      path: resolveExportRoot(message.rootPath),
    };
  }

  if (message.action === "prune-old-files") {
    const paths = pruneOldFiles(message.path, message.pattern, message.recursive !== false, message.olderThanDays);
    return {
      ok: true,
      action: "prune-old-files",
      paths,
    };
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
