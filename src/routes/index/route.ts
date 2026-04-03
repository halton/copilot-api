import { Hono } from "hono"
import { html } from "hono/html"

import { state } from "~/lib/state"

export const indexRoute = new Hono()

// eslint-disable-next-line max-lines-per-function
indexRoute.get("/", (c) => {
  const version = process.env.npm_package_version ?? "unknown"
  const login = state.githubLogin ?? "unknown"
  const accountType = state.accountType

  const format = c.req.query("format")
  const accept = c.req.header("accept") ?? ""
  if (format === "text" || !accept.includes("text/html")) {
    return c.text(
      `Copilot API v${version} - running\nUser: ${login} (${accountType})`,
    )
  }

  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Copilot API</title>
        <style>
          :root {
            --bg-darkest: #1d2021;
            --bg: #282828;
            --bg1: #3c3836;
            --bg2: #504945;
            --fg: #ebdbb2;
            --fg0: #fbf1c7;
            --fg2: #d5c4a1;
            --gray: #a89984;
            --green: #b8bb26;
            --blue: #83a598;
            --aqua: #8ec07c;
            --yellow: #fabd2f;
            --orange: #fe8019;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family:
              -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            background: var(--bg-darkest);
            color: var(--fg);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            padding: 48px 16px;
          }
          .container {
            max-width: 560px;
            width: 100%;
          }
          h1 {
            font-size: 1.5rem;
            color: var(--fg0);
            margin-bottom: 4px;
          }
          .subtitle {
            color: var(--gray);
            font-size: 0.875rem;
            margin-bottom: 32px;
          }
          .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            background: var(--bg2);
            color: var(--green);
            margin-left: 8px;
            vertical-align: middle;
          }
          .section {
            background: var(--bg);
            border: 1px solid var(--bg1);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
          }
          .section-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--gray);
            margin-bottom: 12px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 0.875rem;
          }
          .info-label {
            color: var(--fg2);
          }
          .info-value {
            color: var(--fg0);
            font-weight: 500;
          }
          .info-value a {
            color: var(--blue);
            text-decoration: none;
          }
          .info-value a:hover {
            text-decoration: underline;
          }
          .links {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .link-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            background: var(--bg1);
            border-radius: 6px;
            text-decoration: none;
            color: var(--fg);
            font-size: 0.875rem;
            transition: background 0.15s;
          }
          .link-item:hover {
            background: var(--bg2);
          }
          .link-icon {
            font-size: 1rem;
            width: 20px;
            text-align: center;
          }
          .link-desc {
            color: var(--gray);
            font-size: 0.75rem;
            margin-top: 2px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Copilot API <span class="badge">running</span></h1>
          <p class="subtitle">
            v${version} ·
            <a
              href="/?format=text"
              style="color: var(--gray); text-decoration: none; border-bottom: 1px dashed var(--gray);"
              >plain text</a
            >
          </p>

          <div class="section">
            <div class="section-title">Account</div>
            <div class="info-row">
              <span class="info-label">GitHub User</span>
              <span class="info-value">
                <a href="https://github.com/${login}" target="_blank"
                  >${login}</a
                >
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">Plan</span>
              <span class="info-value">${accountType}</span>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Links</div>
            <div class="links">
              <a class="link-item" href="/usage" target="_blank">
                <span class="link-icon">📊</span>
                <div>
                  <div>Usage</div>
                  <div class="link-desc">View API usage statistics</div>
                </div>
              </a>
              <a class="link-item" href="/models">
                <span class="link-icon">🤖</span>
                <div>
                  <div>Models</div>
                  <div class="link-desc">List available models</div>
                </div>
              </a>
              <a
                class="link-item"
                href="https://github.com/billxc/copilot-api"
                target="_blank"
              >
                <span class="link-icon">⭐</span>
                <div>
                  <div>GitHub</div>
                  <div class="link-desc">Source code &amp; documentation</div>
                </div>
              </a>
              <a
                class="link-item"
                href="https://github.com/billxc/copilot-api/issues"
                target="_blank"
              >
                <span class="link-icon">🐛</span>
                <div>
                  <div>Issues</div>
                  <div class="link-desc">Report bugs or request features</div>
                </div>
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>`

  return c.html(page)
})
