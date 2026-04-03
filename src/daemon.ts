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

    const procs = findAllCopilotProcesses()
    if (procs.length > 0) {
      console.log("\n=== Processes ===")
      for (const proc of procs) {
        console.log(`  PID ${proc.pid}: ${proc.command}`)
      }
    }
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

    const procs = findAllCopilotProcesses()
    if (procs.length > 0) {
      console.log("\n=== Processes ===")
      for (const proc of procs) {
        console.log(`  PID ${proc.pid}: ${proc.command}`)
      }
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
  } else {
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
    try {
      process.kill(Number.parseInt(proc.pid, 10), "SIGTERM")
      stopped++
    } catch {
      // already dead
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

function assertSupported(): void {
  if (!isMacOS() && !isLinux()) {
    console.error(
      "Daemon management is only supported on macOS and Linux.",
    )
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
      "Install xc-copilot-api daemon (launchd on macOS, systemd on Linux)",
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
    if (!fs.existsSync(LOG_FILE)) {
      console.log("No log file found.")
      return
    }

    if (args.follow) {
      const { status } = spawnSync("tail", ["-f", LOG_FILE], {
        stdio: "inherit",
      })
      process.exit(status ?? 0)
    } else {
      const { status } = spawnSync("tail", ["-n", args.lines, LOG_FILE], {
        stdio: "inherit",
      })
      process.exit(status ?? 0)
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
