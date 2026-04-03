# xc-copilot-api-daemon

Manage xc-copilot-api as a background daemon (launchd on macOS, systemd on Linux, Run key on Windows).

This is a **standalone CLI**, separate from the main `xc-copilot-api` command, to keep things lightweight.

## Usage

No install needed — run directly via npx:

```sh
npx -y -p xc-copilot-api xc-copilot-api-daemon <command>
```

> **Tip:** You can create a shell alias to save typing:
> ```sh
> alias xc-copilot-api='npx -y -p xc-copilot-api xc-copilot-api-daemon'
> ```

## Commands

| Command     | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `install`   | Install daemon (launchd on macOS, systemd on Linux, Run key on Windows) |
| `uninstall` | Uninstall the daemon                                         |
| `status`    | Show daemon status (`--all` to show all copilot-api instances) |
| `restart`   | Restart the daemon (npx mode auto-updates on restart)        |
| `stop`      | Stop the daemon (`--all` to kill all copilot-api instances)  |
| `logs`      | Show recent daemon logs (`-f` to follow, `-n` for line count) |

## Install Options

```sh
npx -y -p xc-copilot-api xc-copilot-api-daemon install [OPTIONS]
```

| Option         | Description                                            | Default    | Alias |
| -------------- | ------------------------------------------------------ | ---------- | ----- |
| --no-npx       | Use direct binary instead of npx (no auto-update)      | false      |       |
| --port         | Port for the API server                                | 4141       | -p    |
| --verbose      | Enable verbose logging                                 | false      | -v    |
| --account-type | Account type (individual, business, enterprise)        | individual | -a    |
| --github-token | GitHub token to use                                    |            | -g    |
| --proxy-env    | Initialize proxy from environment variables            | false      |       |

## Quick Start

```sh
# Install and start daemon (npx mode, auto-updates on restart)
npx -y -p xc-copilot-api xc-copilot-api-daemon install
npx -y -p xc-copilot-api xc-copilot-api-daemon restart

# Check status
npx -y -p xc-copilot-api xc-copilot-api-daemon status

# View logs
npx -y -p xc-copilot-api xc-copilot-api-daemon logs
npx -y -p xc-copilot-api xc-copilot-api-daemon logs -f    # follow mode

# Custom port
npx -y -p xc-copilot-api xc-copilot-api-daemon install --port 8080
npx -y -p xc-copilot-api xc-copilot-api-daemon restart
```

## --all Flag

Use `--all` with `status` or `stop` to discover and manage **all** copilot-api instances, including:

- LaunchAgent jobs (macOS) / systemd units (Linux) with "copilot" in the name
- Any running processes matching `copilot-api`

```sh
# Show all copilot-api instances
npx -y -p xc-copilot-api xc-copilot-api-daemon status --all

# Stop everything copilot-api related
npx -y -p xc-copilot-api xc-copilot-api-daemon stop --all
```

## How It Works

### macOS (launchd)

- Installs a LaunchAgent plist at `~/Library/LaunchAgents/com.xc-copilot-api.plist`
- Creates a launcher script at `~/.local/share/copilot-api/launcher.sh`
- Logs to `~/.local/share/copilot-api/copilot-api.log`
- `KeepAlive` is enabled — the daemon auto-restarts if it crashes
- `RunAtLoad` is enabled — starts on login

### Linux (systemd)

- Installs a user systemd unit at `~/.config/systemd/user/xc-copilot-api.service`
- Creates a launcher script at `~/.local/share/copilot-api/launcher.sh`
- Logs to `~/.local/share/copilot-api/copilot-api.log`
- `Restart=on-failure` — auto-restarts on crash

### Windows (Registry Run Key)

- Writes a VBS launcher at `%LOCALAPPDATA%\copilot-api\launcher.vbs` (runs hidden, no console window)
- Registers `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\XcCopilotApi` — starts on login, no admin needed
- Logs to `%LOCALAPPDATA%\copilot-api\copilot-api.log`

### npx Mode (default)

When installed with npx mode (the default), each restart runs `npx xc-copilot-api start`, which always fetches the latest published version. This gives you auto-updates without any extra steps — just restart the daemon.

### Direct Mode

Use `--no-npx` to run the locally installed binary directly. Faster startup, but no auto-update.
