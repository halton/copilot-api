/* eslint-disable */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { buildStartArgs } from "./shared"
import type { DaemonInstallArgs } from "./shared"

const WINDOWS_TASK_NAME = "XcCopilotApi"

function windowsAppDir(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return path.join(localAppData, "copilot-api")
}

function windowsLauncherCmdPath(): string {
  return path.join(windowsAppDir(), "launcher.cmd")
}

export function windowsLogFile(): string {
  return path.join(windowsAppDir(), "copilot-api.log")
}

function buildWindowsCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  if (args.npx) {
    startArgs[0] = "xc-copilot-api@latest"
    const parts = ["npx", "-y", ...startArgs]
    return parts.map((s) => (s.includes(" ") ? `"${s}"` : s)).join(" ")
  }
  return startArgs.map((s) => (s.includes(" ") ? `"${s}"` : s)).join(" ")
}

export function installWindows(args: DaemonInstallArgs): void {
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

export function uninstallWindows(): void {
  stopWindows()

  // Remove scheduled task
  spawnSync("schtasks", [
    "/delete",
    "/tn", WINDOWS_TASK_NAME,
    "/f",
  ], { encoding: "utf-8", timeout: 10000 })

  const launcherCmd = windowsLauncherCmdPath()
  if (fs.existsSync(launcherCmd)) fs.unlinkSync(launcherCmd)

  console.log(`Uninstalled scheduled task '${WINDOWS_TASK_NAME}'`)
}

export function startWindows(): boolean {
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

export function findCopilotPids(filter: string): string[] {
  // Use WQL filter; exclude the PowerShell process itself ($PID) to avoid self-matching
  const wqlFilter = filter.replace(/\*/g, "%")
  const result = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '${wqlFilter}' AND ProcessId != $PID" | Select-Object -ExpandProperty ProcessId`,
  ], { encoding: "utf-8", timeout: 10000 })

  if (result.status !== 0) return []
  return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

export function stopWindows(): boolean {
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

export function statusWindows(): void {
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
