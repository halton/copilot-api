/* eslint-disable */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  APP_DIR,
  ERR_FILE,
  LOG_FILE,
  buildDirectCommand,
  buildNpxCommand,
  launcherPath,
} from "./shared"
import type { DaemonInstallArgs } from "./shared"

const LAUNCHD_LABEL = "com.xc-copilot-api"

function plistPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LAUNCHD_LABEL}.plist`,
  )
}

export function installMacOS(args: DaemonInstallArgs): void {
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

export function uninstallMacOS(): void {
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

export function stopMacOS(): boolean {
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

export function startMacOS(): boolean {
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

export function statusMacOS(): void {
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

export interface CopilotJob {
  label: string
  pid: string | null
  plistPath: string | null
}

export function findAllCopilotLaunchdJobs(): CopilotJob[] {
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
