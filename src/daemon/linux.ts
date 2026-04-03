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

const SYSTEMD_UNIT = "xc-copilot-api.service"

function systemdUnitPath(): string {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    SYSTEMD_UNIT,
  )
}

export function installLinux(args: DaemonInstallArgs): void {
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

export function uninstallLinux(): void {
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

export function startLinux(): boolean {
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

export function stopLinux(): boolean {
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

export function statusLinux(): void {
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

export function findAllCopilotSystemdUnits(): string[] {
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
