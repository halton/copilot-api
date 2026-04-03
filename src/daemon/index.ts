/* eslint-disable */
import { execSync, spawnSync } from "node:child_process"
import fs from "node:fs"

import { defineCommand } from "citty"

import { findAllCopilotLaunchdJobs } from "./macos"
import { installMacOS, startMacOS, statusMacOS, stopMacOS, uninstallMacOS } from "./macos"
import { findAllCopilotSystemdUnits } from "./linux"
import { installLinux, startLinux, statusLinux, stopLinux, uninstallLinux } from "./linux"
import { installWindows, startWindows, statusWindows, stopWindows, uninstallWindows, windowsLogFile } from "./windows"
import {
  LOG_FILE,
  assertSupported,
  isMacOS,
  isLinux,
  isWindows,
} from "./shared"
import type { CopilotProcess, DaemonInstallArgs } from "./shared"

// ---------------------------------------------------------------------------
// --all: find all copilot-api related processes
// ---------------------------------------------------------------------------

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
