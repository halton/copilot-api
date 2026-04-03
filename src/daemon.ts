/* eslint-disable */
import { execSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { defineCommand } from "citty"

const APP_DIR = path.join(os.homedir(), ".local", "share", "copilot-api")
const LOG_FILE = path.join(APP_DIR, "copilot-api.log")
const ERR_FILE = path.join(APP_DIR, "copilot-api.err")

// ---------------------------------------------------------------------------
// Naming / paths
// ---------------------------------------------------------------------------

const LAUNCHD_LABEL = "com.xc-copilot-api"
const SYSTEMD_UNIT = "xc-copilot-api.service"
const WINDOWS_TASK_NAME = "XcCopilotApi"

function plistPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LAUNCHD_LABEL}.plist`,
  )
}

function systemdUnitPath(): string {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    SYSTEMD_UNIT,
  )
}

function launcherPath(): string {
  return path.join(APP_DIR, "launcher.sh")
}

// ---------------------------------------------------------------------------
// Build start command
// ---------------------------------------------------------------------------

function buildStartArgs(args: DaemonInstallArgs): string[] {
  const cmd = ["xc-copilot-api", "start"]
  if (args.port) cmd.push("--port", args.port)
  if (args.verbose) cmd.push("--verbose")
  if (args.accountType && args.accountType !== "individual")
    cmd.push("--account-type", args.accountType)
  if (args.githubToken) cmd.push("--github-token", args.githubToken)
  if (args.proxyEnv) cmd.push("--proxy-env")
  return cmd
}

function buildNpxCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  // npx always fetches latest → auto-update on restart
  return ["npx", ...startArgs].map(shellQuote).join(" ")
}

function buildDirectCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  return startArgs.map(shellQuote).join(" ")
}

function shellQuote(s: string): string {
  if (/^[\w./:@=-]+$/.test(s)) return s
  return `'${s.replace(/'/g, "'\\''")}'`
}

// ---------------------------------------------------------------------------
// macOS (launchd)
// ---------------------------------------------------------------------------

function installMacOS(args: DaemonInstallArgs): void {
  const plist = plistPath()
  const launcher = launcherPath()

  fs.mkdirSync(APP_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(plist), { recursive: true })

  const execCmd = args.npx
    ? buildNpxCommand(args)
    : buildDirectCommand(args)

  // Launcher script sources login shell so PATH includes nvm, homebrew, etc.
  fs.writeFileSync(
    launcher,
    [
      "#!/bin/zsh -l",
      '[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"',
      `exec ${execCmd}`,
      "",
    ].join("\n"),
  )
  fs.chmodSync(launcher, 0o755)

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${launcher}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${os.homedir()}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${ERR_FILE}</string>
</dict>
</plist>
`
  fs.writeFileSync(plist, plistContent)

  console.log(`Installed LaunchAgent '${LAUNCHD_LABEL}'`)
  console.log(`  Plist:    ${plist}`)
  console.log(`  Launcher: ${launcher}`)
  console.log(`  Log:      ${LOG_FILE}`)
  console.log(`  Mode:     ${args.npx ? "npx (auto-update)" : "direct"}`)
  console.log(`  Start:    xc-copilot-api-daemon restart`)
}

function uninstallMacOS(): void {
  stopMacOS()
  const plist = plistPath()
  if (fs.existsSync(plist)) {
    fs.unlinkSync(plist)
    console.log(`Removed LaunchAgent plist: ${plist}`)
  }
  const launcher = launcherPath()
  if (fs.existsSync(launcher)) {
    fs.unlinkSync(launcher)
    console.log(`Removed launcher: ${launcher}`)
  }
  console.log(`Uninstalled daemon '${LAUNCHD_LABEL}'`)
}

function stopMacOS(): boolean {
  const domain = `gui/${process.getuid?.() ?? 501}`
  const job = `${domain}/${LAUNCHD_LABEL}`
  const result = spawnSync("launchctl", ["bootout", job], {
    encoding: "utf-8",
    timeout: 15000,
  })
  if (result.status === 0) {
    console.log(`Stopped LaunchAgent '${LAUNCHD_LABEL}'`)
    return true
  }
  const detail = (result.stderr || result.stdout || "").toLowerCase()
  if (detail.includes("not find") || detail.includes("no such")) {
    return true // not running
  }
  return false
}

function startMacOS(): boolean {
  const plist = plistPath()
  if (!fs.existsSync(plist)) {
    console.error(`LaunchAgent plist not found: ${plist}`)
    console.error("Run 'xc-copilot-api-daemon install' first.")
    return false
  }

  const domain = `gui/${process.getuid?.() ?? 501}`
  const job = `${domain}/${LAUNCHD_LABEL}`

  // Bootstrap (load) the daemon
  const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plist], {
    encoding: "utf-8",
    timeout: 10000,
  })
  if (bootstrap.status !== 0) {
    const detail = (bootstrap.stderr || bootstrap.stdout || "").toLowerCase()
    if (!detail.includes("already")) {
      console.error(`launchctl bootstrap failed: ${detail.trim()}`)
      return false
    }
  }

  // Kickstart -k kills existing instance and restarts
  const kick = spawnSync("launchctl", ["kickstart", "-k", job], {
    encoding: "utf-8",
    timeout: 15000,
  })
  if (kick.status !== 0) {
    console.error(
      `launchctl kickstart failed: ${(kick.stderr || kick.stdout || "").trim()}`,
    )
    return false
  }

  console.log(`Started LaunchAgent '${LAUNCHD_LABEL}'`)
  return true
}

function statusMacOS(): void {
  const plist = plistPath()
  if (!fs.existsSync(plist)) {
    console.log("Daemon: not installed")
    return
  }

  console.log(`Daemon: installed`)
  console.log(`  Plist: ${plist}`)

  const launcher = launcherPath()
  if (fs.existsSync(launcher)) {
    const content = fs.readFileSync(launcher, "utf-8")
    const execLine = content
      .split("\n")
      .find((l) => l.startsWith("exec "))
    if (execLine) {
      console.log(`  Command: ${execLine.replace("exec ", "")}`)
    }
  }

  // Check if running via launchctl
  const result = spawnSync("launchctl", ["list", LAUNCHD_LABEL], {
    encoding: "utf-8",
    timeout: 5000,
  })
  if (result.status === 0) {
    const output = result.stdout.trim()
    // Parse PID and status from launchctl list output
    const pidLine = output
      .split("\n")
      .find((l) => l.includes("PID") || l.match(/^\s*"PID"/))
    const lastExitLine = output
      .split("\n")
      .find((l) => l.includes("LastExitStatus"))

    // launchctl list <label> outputs key-value pairs
    const pidMatch = output.match(/"PID"\s*=\s*(\d+)/)
    const exitMatch = output.match(/"LastExitStatus"\s*=\s*(\d+)/)

    if (pidMatch) {
      console.log(`  Status: running (PID ${pidMatch[1]})`)
    } else {
      console.log(`  Status: not running`)
    }
    if (exitMatch) {
      console.log(`  Last exit: ${exitMatch[1]}`)
    }
    if (pidLine) void pidLine // suppress unused
    if (lastExitLine) void lastExitLine // suppress unused
  } else {
    console.log("  Status: not loaded")
  }

  // Show recent log
  if (fs.existsSync(LOG_FILE)) {
    const stat = fs.statSync(LOG_FILE)
    console.log(
      `  Log: ${LOG_FILE} (${(stat.size / 1024).toFixed(1)} KB)`,
    )
  }
}

// ---------------------------------------------------------------------------
// Linux (systemd)
// ---------------------------------------------------------------------------

function installLinux(args: DaemonInstallArgs): void {
  const unitPath = systemdUnitPath()
  const launcher = launcherPath()

  fs.mkdirSync(APP_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(unitPath), { recursive: true })

  const execCmd = args.npx
    ? buildNpxCommand(args)
    : buildDirectCommand(args)

  // Launcher script sources login shell
  fs.writeFileSync(
    launcher,
    [
      "#!/bin/bash -l",
      '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"',
      `exec ${execCmd}`,
      "",
    ].join("\n"),
  )
  fs.chmodSync(launcher, 0o755)

  const unitContent = `[Unit]
Description=xc-copilot-api - GitHub Copilot OpenAI Compatible API
After=network.target

[Service]
Type=simple
ExecStart=${launcher}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${ERR_FILE}

[Install]
WantedBy=default.target
`
  fs.writeFileSync(unitPath, unitContent)

  spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf-8" })
  spawnSync("systemctl", ["--user", "enable", SYSTEMD_UNIT], {
    encoding: "utf-8",
  })

  console.log(`Installed systemd unit '${SYSTEMD_UNIT}'`)
  console.log(`  Unit:     ${unitPath}`)
  console.log(`  Launcher: ${launcher}`)
  console.log(`  Log:      ${LOG_FILE}`)
  console.log(`  Mode:     ${args.npx ? "npx (auto-update)" : "direct"}`)
  console.log(`  Start:    xc-copilot-api-daemon restart`)
}

function uninstallLinux(): void {
  spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT], {
    encoding: "utf-8",
  })
  spawnSync("systemctl", ["--user", "disable", SYSTEMD_UNIT], {
    encoding: "utf-8",
  })
  const unitPath = systemdUnitPath()
  if (fs.existsSync(unitPath)) {
    fs.unlinkSync(unitPath)
    spawnSync("systemctl", ["--user", "daemon-reload"], {
      encoding: "utf-8",
    })
  }
  const launcher = launcherPath()
  if (fs.existsSync(launcher)) {
    fs.unlinkSync(launcher)
  }
  console.log(`Uninstalled systemd unit '${SYSTEMD_UNIT}'`)
}

function startLinux(): boolean {
  const result = spawnSync(
    "systemctl",
    ["--user", "start", SYSTEMD_UNIT],
    { encoding: "utf-8", timeout: 10000 },
  )
  if (result.status !== 0) {
    console.error(
      `systemd start failed: ${(result.stderr || result.stdout || "").trim()}`,
    )
    return false
  }
  console.log(`Started systemd unit '${SYSTEMD_UNIT}'`)
  return true
}

function stopLinux(): boolean {
  const result = spawnSync(
    "systemctl",
    ["--user", "stop", SYSTEMD_UNIT],
    { encoding: "utf-8", timeout: 15000 },
  )
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim()
    if (!detail.includes("not loaded")) {
      console.error(`systemd stop failed: ${detail}`)
      return false
    }
  }
  console.log(`Stopped systemd unit '${SYSTEMD_UNIT}'`)
  return true
}

function statusLinux(): void {
  const unitPath = systemdUnitPath()
  if (!fs.existsSync(unitPath)) {
    console.log("Daemon: not installed")
    return
  }

  console.log("Daemon: installed")
  console.log(`  Unit: ${unitPath}`)

  const launcher = launcherPath()
  if (fs.existsSync(launcher)) {
    const content = fs.readFileSync(launcher, "utf-8")
    const execLine = content
      .split("\n")
      .find((l) => l.startsWith("exec "))
    if (execLine) {
      console.log(`  Command: ${execLine.replace("exec ", "")}`)
    }
  }

  const result = spawnSync(
    "systemctl",
    ["--user", "status", SYSTEMD_UNIT, "--no-pager"],
    { encoding: "utf-8", timeout: 5000 },
  )
  // systemctl status returns non-zero if daemon is not running, that's ok
  console.log(result.stdout.trim())
}

// ---------------------------------------------------------------------------
// Windows (Task Scheduler)
// ---------------------------------------------------------------------------

function windowsAppDir(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return path.join(localAppData, "copilot-api")
}

function windowsLauncherCmdPath(): string {
  return path.join(windowsAppDir(), "launcher.cmd")
}

function windowsLogFile(): string {
  return path.join(windowsAppDir(), "copilot-api.log")
}

function buildWindowsCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  const parts = args.npx ? ["npx", ...startArgs] : startArgs
  return parts.map((s) => (s.includes(" ") ? `"${s}"` : s)).join(" ")
}

function installWindows(args: DaemonInstallArgs): void {
  const appDir = windowsAppDir()
  const logFile = windowsLogFile()
  const errFile = path.join(appDir, "copilot-api.err")
  const launcherCmd = windowsLauncherCmdPath()

  fs.mkdirSync(appDir, { recursive: true })

  const execCmd = buildWindowsCommand(args)

  // CMD launcher script with log redirection
  const cmdContent = [
    "@echo off",
    `cd /d "%USERPROFILE%"`,
    `${execCmd} >> "${logFile}" 2>> "${errFile}"`,
    "",
  ].join("\r\n")
  fs.writeFileSync(launcherCmd, cmdContent)

  // Register as a scheduled task (on-logon trigger, no admin needed)
  const psCmd = [
    `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c "${launcherCmd}"'`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)`,
    `Register-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -Action $action -Trigger $trigger -Settings $settings -Force`,
  ].join("; ")
  const result = spawnSync("powershell", [
    "-NoProfile", "-Command", psCmd,
  ], { encoding: "utf-8", timeout: 15000 })

  if (result.status !== 0) {
    console.error(`Failed to create scheduled task: ${(result.stderr || "").trim()}`)
    process.exit(1)
  }

  console.log(`Installed scheduled task '${WINDOWS_TASK_NAME}'`)
  console.log(`  Launcher: ${launcherCmd}`)
  console.log(`  Log:      ${logFile}`)
  console.log(`  Mode:     ${args.npx ? "npx (auto-update)" : "direct"}`)
  console.log(`  Start:    xc-copilot-api-daemon restart`)
}

function uninstallWindows(): void {
  stopWindows()

  // Remove scheduled task
  spawnSync("schtasks", [
    "/delete",
    "/tn", WINDOWS_TASK_NAME,
    "/f",
  ], { encoding: "utf-8", timeout: 10000 })

  const launcherCmd = windowsLauncherCmdPath()
  if (fs.existsSync(launcherCmd)) fs.unlinkSync(launcherCmd)

  // Clean up legacy VBS launcher and Run key if present
  const legacyVbsPath = path.join(windowsAppDir(), "launcher.vbs")
  if (fs.existsSync(legacyVbsPath)) fs.unlinkSync(legacyVbsPath)
  spawnSync("reg.exe", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v", "XcCopilotApi",
    "/f",
  ], { encoding: "utf-8", timeout: 10000 })

  console.log(`Uninstalled scheduled task '${WINDOWS_TASK_NAME}'`)
}

function startWindows(): boolean {
  const result = spawnSync("schtasks", [
    "/run",
    "/tn", WINDOWS_TASK_NAME,
  ], { encoding: "utf-8", timeout: 10000 })

  if (result.status !== 0) {
    console.error(`Scheduled task '${WINDOWS_TASK_NAME}' not found.`)
    console.error("Run 'xc-copilot-api-daemon install' first.")
    return false
  }

  console.log("Started xc-copilot-api (background)")
  return true
}

function findCopilotPids(filter: string): string[] {
  // Use WQL filter; exclude the PowerShell process itself ($PID) to avoid self-matching
  const wqlFilter = filter.replace(/\*/g, "%")
  const result = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '${wqlFilter}' AND ProcessId != $PID" | Select-Object -ExpandProperty ProcessId`,
  ], { encoding: "utf-8", timeout: 10000 })

  if (result.status !== 0) return []
  return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

function stopWindows(): boolean {
  // Find copilot-api processes excluding daemon management and self
  const result = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%copilot-api%' AND NOT (CommandLine LIKE '%daemon%') AND ProcessId != $PID" | Select-Object -ExpandProperty ProcessId`,
  ], { encoding: "utf-8", timeout: 10000 })

  const pids = (result.status === 0 ? result.stdout : "")
    .split("\n").map((l) => l.trim()).filter(Boolean)

  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", pid, "/F"], { encoding: "utf-8", timeout: 5000 })
  }

  if (pids.length > 0) {
    console.log(`Stopped ${pids.length} process(es)`)
    return true
  }

  console.log("No copilot-api processes found.")
  return true
}

function statusWindows(): void {
  // Check scheduled task
  const taskResult = spawnSync("schtasks", [
    "/query",
    "/tn", WINDOWS_TASK_NAME,
    "/fo", "LIST",
  ], { encoding: "utf-8", timeout: 5000 })

  if (taskResult.status !== 0) {
    console.log("Daemon: not installed")
    return
  }

  console.log("Daemon: installed")

  // Parse task status from schtasks output
  const statusMatch = (taskResult.stdout || "").match(/Status:\s*(.+)/i)
  if (statusMatch) {
    console.log(`  Task:   ${statusMatch[1].trim()}`)
  }

  // Show command from CMD launcher
  const launcherCmd = windowsLauncherCmdPath()
  if (fs.existsSync(launcherCmd)) {
    const content = fs.readFileSync(launcherCmd, "utf-8")
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("@") && !l.startsWith("cd "))
    if (lines.length > 0) {
      // Strip log redirection to show just the command
      const cmd = lines[0].replace(/\s*>>.*$/, "").trim()
      if (cmd) console.log(`  Command: ${cmd}`)
    }
  }

  // Check if running
  const pids = findCopilotPids("*copilot-api*start*")

  console.log(pids.length > 0
    ? `  Status: running (PID ${pids.join(", ")})`
    : "  Status: not running")

  const logFile = windowsLogFile()
  if (fs.existsSync(logFile)) {
    const stat = fs.statSync(logFile)
    console.log(`  Log: ${logFile} (${(stat.size / 1024).toFixed(1)} KB)`)
  }
}

// ---------------------------------------------------------------------------
// --all: find all copilot-api related jobs / processes
// ---------------------------------------------------------------------------

interface CopilotJob {
  label: string
  pid: string | null
  plistPath: string | null
}

function findAllCopilotLaunchdJobs(): CopilotJob[] {
  const result = spawnSync("launchctl", ["list"], {
    encoding: "utf-8",
    timeout: 5000,
  })
  if (result.status !== 0) return []

  const jobs: CopilotJob[] = []
  for (const line of result.stdout.split("\n")) {
    if (!line.toLowerCase().includes("copilot")) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const pid = parts[0] === "-" ? null : parts[0]
    const label = parts[2]
    const plist = path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      `${label}.plist`,
    )
    jobs.push({
      label,
      pid,
      plistPath: fs.existsSync(plist) ? plist : null,
    })
  }
  return jobs
}

interface CopilotProcess {
  pid: string
  command: string
}

function findAllCopilotProcesses(): CopilotProcess[] {
  if (isWindows()) {
    const result = spawnSync("powershell", [
      "-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%copilot-api%' AND ProcessId != $PID" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`,
    ], { encoding: "utf-8", timeout: 10000 })
    if (result.status !== 0) return []
    const procs: CopilotProcess[] = []
    for (const line of result.stdout.trim().split("\n")) {
      if (!line.trim()) continue
      const sep = line.indexOf("|")
      if (sep < 0) continue
      procs.push({ pid: line.slice(0, sep).trim(), command: line.slice(sep + 1).trim() })
    }
    return procs
  }

  try {
    const output = execSync(
      "ps aux | grep -i copilot-api | grep -v grep",
      { encoding: "utf-8", timeout: 5000 },
    )
    const procs: CopilotProcess[] = []
    for (const line of output.trim().split("\n")) {
      if (!line) continue
      const parts = line.trim().split(/\s+/)
      if (parts.length < 11) continue
      const pid = parts[1]
      const command = parts.slice(10).join(" ")
      procs.push({ pid, command })
    }
    return procs
  } catch {
    return []
  }
}

function findAllCopilotSystemdUnits(): string[] {
  const result = spawnSync(
    "systemctl",
    ["--user", "list-units", "--all", "--no-pager", "--plain"],
    { encoding: "utf-8", timeout: 5000 },
  )
  if (result.status !== 0) return []
  const units: string[] = []
  for (const line of result.stdout.split("\n")) {
    if (line.toLowerCase().includes("copilot")) {
      const unit = line.trim().split(/\s+/)[0]
      if (unit) units.push(unit)
    }
  }
  return units
}

function statusAll(): void {
  if (isMacOS()) {
    const jobs = findAllCopilotLaunchdJobs()
    if (jobs.length > 0) {
      console.log("=== LaunchAgent Jobs ===")
      for (const job of jobs) {
        console.log(`\n  Label: ${job.label}`)
        if (job.plistPath) console.log(`  Plist: ${job.plistPath}`)
        else console.log(`  Plist: (not found)`)
        console.log(`  PID:   ${job.pid ?? "not running"}`)
      }
    } else {
      console.log("No copilot-api LaunchAgent jobs found.")
    }
  } else if (isWindows()) {
    // Show Run key status
    statusWindows()
  } else {
    const units = findAllCopilotSystemdUnits()
    if (units.length > 0) {
      console.log("=== Systemd Units ===")
      for (const unit of units) {
        const r = spawnSync(
          "systemctl",
          ["--user", "status", unit, "--no-pager"],
          { encoding: "utf-8", timeout: 5000 },
        )
        console.log(`\n--- ${unit} ---`)
        console.log(r.stdout.trim())
      }
    } else {
      console.log("No copilot-api systemd units found.")
    }
  }

  const procs = findAllCopilotProcesses()
  if (procs.length > 0) {
    console.log("\n=== Processes ===")
    for (const proc of procs) {
      console.log(`  PID ${proc.pid}: ${proc.command}`)
    }
  }
}

function stopAll(): void {
  let stopped = 0

  if (isMacOS()) {
    const jobs = findAllCopilotLaunchdJobs()
    const domain = `gui/${process.getuid?.() ?? 501}`
    for (const job of jobs) {
      const jobTarget = `${domain}/${job.label}`
      console.log(`Stopping LaunchAgent '${job.label}'...`)
      spawnSync("launchctl", ["bootout", jobTarget], {
        encoding: "utf-8",
        timeout: 15000,
      })
      stopped++
    }
  } else if (!isWindows()) {
    const units = findAllCopilotSystemdUnits()
    for (const unit of units) {
      console.log(`Stopping systemd unit '${unit}'...`)
      spawnSync("systemctl", ["--user", "stop", unit], {
        encoding: "utf-8",
        timeout: 15000,
      })
      stopped++
    }
  }

  // Kill remaining processes
  const procs = findAllCopilotProcesses()
  for (const proc of procs) {
    console.log(`Killing PID ${proc.pid}: ${proc.command}`)
    if (isWindows()) {
      spawnSync("taskkill", ["/PID", proc.pid, "/F"], { encoding: "utf-8", timeout: 5000 })
      stopped++
    } else {
      try {
        process.kill(Number.parseInt(proc.pid, 10), "SIGTERM")
        stopped++
      } catch {
        // already dead
      }
    }
  }

  if (stopped === 0) {
    console.log("No copilot-api processes found.")
  } else {
    console.log(`\nStopped/killed ${stopped} item(s).`)
  }
}

// ---------------------------------------------------------------------------
// Platform dispatch
// ---------------------------------------------------------------------------

interface DaemonInstallArgs {
  npx: boolean
  port?: string
  verbose: boolean
  accountType?: string
  githubToken?: string
  proxyEnv: boolean
}

function isMacOS(): boolean {
  return process.platform === "darwin"
}

function isLinux(): boolean {
  return process.platform === "linux"
}

function isWindows(): boolean {
  return process.platform === "win32"
}

function assertSupported(): void {
  if (!isMacOS() && !isLinux() && !isWindows()) {
    console.error("Daemon management is only supported on macOS, Linux, and Windows.")
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// CLI subcommands
// ---------------------------------------------------------------------------

const installCmd = defineCommand({
  meta: {
    name: "install",
    description:
      "Install xc-copilot-api daemon (launchd on macOS, systemd on Linux, Task Scheduler on Windows)",
  },
  args: {
    npx: {
      type: "boolean",
      default: true,
      description:
        "Use npx to run (auto-updates on restart). Set --no-npx to use direct binary.",
    },
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port for the API server",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type (individual, business, enterprise)",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description: "GitHub token to use",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
  },
  run({ args }) {
    assertSupported()
    const installArgs: DaemonInstallArgs = {
      npx: args.npx,
      port: args.port,
      verbose: args.verbose,
      accountType: args["account-type"],
      githubToken: args["github-token"],
      proxyEnv: args["proxy-env"],
    }
    if (isMacOS()) {
      installMacOS(installArgs)
    } else if (isWindows()) {
      installWindows(installArgs)
    } else {
      installLinux(installArgs)
    }
  },
})

const uninstallCmd = defineCommand({
  meta: {
    name: "uninstall",
    description: "Uninstall the daemon",
  },
  run() {
    assertSupported()
    if (isMacOS()) {
      uninstallMacOS()
    } else if (isWindows()) {
      uninstallWindows()
    } else {
      uninstallLinux()
    }
  },
})

const statusCmd = defineCommand({
  meta: {
    name: "status",
    description: "Show daemon status (use --all to show all copilot-api instances)",
  },
  args: {
    all: {
      type: "boolean",
      default: false,
      description:
        "Show all copilot-api related daemons and processes",
    },
  },
  run({ args }) {
    assertSupported()
    if (args.all) {
      statusAll()
    } else if (isMacOS()) {
      statusMacOS()
    } else if (isWindows()) {
      statusWindows()
    } else {
      statusLinux()
    }
  },
})

const restartCmd = defineCommand({
  meta: {
    name: "restart",
    description:
      "Restart the daemon (npx mode fetches latest version automatically)",
  },
  run() {
    assertSupported()
    if (isMacOS()) {
      if (!startMacOS()) process.exit(1)
    } else if (isWindows()) {
      stopWindows()
      if (!startWindows()) process.exit(1)
    } else {
      stopLinux()
      if (!startLinux()) process.exit(1)
    }
  },
})

const stopCmd = defineCommand({
  meta: {
    name: "stop",
    description: "Stop the daemon (use --all to kill all copilot-api instances)",
  },
  args: {
    all: {
      type: "boolean",
      default: false,
      description:
        "Stop all copilot-api related daemons and kill all processes",
    },
  },
  run({ args }) {
    assertSupported()
    if (args.all) {
      stopAll()
    } else if (isMacOS()) {
      if (!stopMacOS()) process.exit(1)
    } else if (isWindows()) {
      if (!stopWindows()) process.exit(1)
    } else {
      if (!stopLinux()) process.exit(1)
    }
  },
})

const logsCmd = defineCommand({
  meta: {
    name: "logs",
    description: "Show recent daemon logs",
  },
  args: {
    follow: {
      alias: "f",
      type: "boolean",
      default: false,
      description: "Follow log output (like tail -f)",
    },
    lines: {
      alias: "n",
      type: "string",
      default: "50",
      description: "Number of lines to show",
    },
  },
  run({ args }) {
    assertSupported()
    const logPath = isWindows() ? windowsLogFile() : LOG_FILE
    if (!fs.existsSync(logPath)) {
      console.log("No log file found.")
      return
    }

    if (isWindows()) {
      // Windows: use powershell Get-Content
      if (args.follow) {
        const { status } = spawnSync("powershell", ["-Command", `Get-Content -Path '${logPath}' -Wait -Tail ${args.lines}`], { stdio: "inherit" })
        process.exit(status ?? 0)
      } else {
        const { status } = spawnSync("powershell", ["-Command", `Get-Content -Path '${logPath}' -Tail ${args.lines}`], { stdio: "inherit" })
        process.exit(status ?? 0)
      }
    } else {
      if (args.follow) {
        const { status } = spawnSync("tail", ["-f", logPath], { stdio: "inherit" })
        process.exit(status ?? 0)
      } else {
        const { status } = spawnSync("tail", ["-n", args.lines, logPath], { stdio: "inherit" })
        process.exit(status ?? 0)
      }
    }
  },
})

// ---------------------------------------------------------------------------
// Main daemon command
// ---------------------------------------------------------------------------

export const daemon = defineCommand({
  meta: {
    name: "xc-copilot-api-daemon",
    description:
      "Manage xc-copilot-api daemon (install, status, restart, stop, uninstall, logs)",
  },
  subCommands: {
    install: installCmd,
    uninstall: uninstallCmd,
    status: statusCmd,
    restart: restartCmd,
    stop: stopCmd,
    logs: logsCmd,
  },
})
