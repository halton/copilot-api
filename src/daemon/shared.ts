/* eslint-disable */
import os from "node:os"
import path from "node:path"

export const APP_DIR = path.join(os.homedir(), ".local", "share", "copilot-api")
export const LOG_FILE = path.join(APP_DIR, "copilot-api.log")
export const ERR_FILE = path.join(APP_DIR, "copilot-api.err")

export interface DaemonInstallArgs {
  npx: boolean
  port?: string
  verbose: boolean
  accountType?: string
  githubToken?: string
  proxyEnv: boolean
}

export interface CopilotProcess {
  pid: string
  command: string
}

export function launcherPath(): string {
  return path.join(APP_DIR, "launcher.sh")
}

export function buildStartArgs(args: DaemonInstallArgs): string[] {
  const cmd = ["xc-copilot-api", "start"]
  if (args.port) cmd.push("--port", args.port)
  if (args.verbose) cmd.push("--verbose")
  if (args.accountType && args.accountType !== "individual")
    cmd.push("--account-type", args.accountType)
  if (args.githubToken) cmd.push("--github-token", args.githubToken)
  if (args.proxyEnv) cmd.push("--proxy-env")
  return cmd
}

export function shellQuote(s: string): string {
  if (/^[\w./:@=-]+$/.test(s)) return s
  return `'${s.replace(/'/g, "'\\''")}'`
}

export function buildNpxCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  // -y skips install prompt; @latest ensures fresh version on every run
  startArgs[0] = "xc-copilot-api@latest"
  return ["npx", "-y", ...startArgs].map(shellQuote).join(" ")
}

export function buildDirectCommand(args: DaemonInstallArgs): string {
  const startArgs = buildStartArgs(args)
  return startArgs.map(shellQuote).join(" ")
}

export function isMacOS(): boolean {
  return process.platform === "darwin"
}

export function isLinux(): boolean {
  return process.platform === "linux"
}

export function isWindows(): boolean {
  return process.platform === "win32"
}

export function assertSupported(): void {
  if (!isMacOS() && !isLinux() && !isWindows()) {
    console.error("Daemon management is only supported on macOS, Linux, and Windows.")
    process.exit(1)
  }
}
