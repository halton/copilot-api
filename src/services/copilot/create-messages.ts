import { logger } from "hono/logger"
import { filterResponseHeaders, postCopilotPassthrough } from "./passthrough"
import consola from "consola"

type MessagesPath = "/v1/messages" | "/v1/messages/count_tokens"

const REQUEST_HEADERS_TO_FORWARD = [
  "accept",
  "anthropic-beta",
  "anthropic-version",
] as const

// For GHC, just remove the 1M header, use the original model name
// GHC will automatically route to the 1M model
const CONTEXT_1M_BETA = "context-1m-2025-08-07"

const OUTPUT_128K_BETA = "output-128k-2025-02-19"

const EFFORT_BETA = "effort-2025-11-24"

const UNSUPPORTED_BETA_VALUES = new Set([
  CONTEXT_1M_BETA,
  OUTPUT_128K_BETA,
  EFFORT_BETA,
])

function hasUnsupportedBeta(headers: Headers): boolean {
  const beta = headers.get("anthropic-beta")
  if (!beta) return false
  return beta.split(",").map(v => v.trim()).some(v => UNSUPPORTED_BETA_VALUES.has(v))
}

function sanitizeBetaHeader(headers: Headers): Headers {
  const beta = headers.get("anthropic-beta")
  if (!beta) return headers

  const filtered = beta
    .split(",")
    .map(v => v.trim())
    .filter(v => !UNSUPPORTED_BETA_VALUES.has(v))
    .join(",")

  const newHeaders = new Headers(headers)
  if (filtered) {
    newHeaders.set("anthropic-beta", filtered)
  } else {
    newHeaders.delete("anthropic-beta")
  }
  return newHeaders
}

/**
 * Normalize Claude model names from versioned format to base format.
 * Claude Code sends versioned names like "claude-opus-4-7-20250514",
 * but GHC expects base names like "claude-opus-4.7".
 *
 * Pattern: claude-{name}-{major}-{minor}-{date} → claude-{name}-{major}.{minor}
 * Examples:
 *   claude-opus-4-7-20250514 → claude-opus-4.7
 *   claude-sonnet-4-5-20250514 → claude-sonnet-4.5
 */
function normalizeClaudeModelName(model: string): string {
  // Match patterns like claude-opus-4-7-20250514 or claude-sonnet-4-5-20250514
  const match = model.match(/^(claude-[a-z]+-\d+)-(\d+)-\d{8}$/)
  if (match) {
    return `${match[1]}.${match[2]}`
  }
  // Also handle claude-opus-4.7-20250514 (dot variant)
  const dotMatch = model.match(/^(claude-[a-z]+-\d+\.\d+)-\d{8}$/)
  if (dotMatch) {
    return dotMatch[1]
  }
  // Handle claude-opus-4-7 (dash minor, no date) → claude-opus-4.7
  const dashMinor = model.match(/^(claude-[a-z]+-\d+)-(\d+)$/)
  if (dashMinor) {
    return `${dashMinor[1]}.${dashMinor[2]}`
  }
  return model
}

/**
 * Normalize the model field in a request body if it's a versioned Claude model name.
 * Also transforms thinking config for models that require adaptive thinking (e.g. opus-4.7+).
 * Returns original text if no modification is needed.
 */
function normalizeModelName(bodyText: string): string {
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>
    if (typeof body.model !== "string" || !body.model.startsWith("claude")) {
      return bodyText
    }

    let modified = false
    const normalized = normalizeClaudeModelName(body.model)
    if (normalized !== body.model) {
      consola.debug(`Normalizing model name: ${body.model} → ${normalized}`)
      body.model = normalized
      modified = true
    }

    // opus-4.7+ uses adaptive thinking instead of enabled+budget_tokens
    if ((body.model as string).includes("opus-4.7")) {
      if (
        body.thinking !== null
        && typeof body.thinking === "object"
        && (body.thinking as Record<string, unknown>).type === "enabled"
      ) {
        consola.debug("Converting thinking.type from 'enabled' to 'adaptive' for opus-4.7")
        body.thinking = { type: "adaptive" }
        modified = true
      }

      // opus-4.7 only supports output_config.effort = "medium"
      if (
        body.output_config !== null
        && typeof body.output_config === "object"
        && (body.output_config as Record<string, unknown>).effort !== undefined
        && (body.output_config as Record<string, unknown>).effort !== "medium"
      ) {
        const original = (body.output_config as Record<string, unknown>).effort
        consola.debug(`Coercing output_config.effort '${String(original)}' → 'medium' for opus-4.7`)
        ;(body.output_config as Record<string, unknown>).effort = "medium"
        modified = true
      }
    }

    return modified ? JSON.stringify(body) : bodyText
  } catch {
    return bodyText
  }
}

/**
 * Parse body JSON and rebuild cache_control objects to only keep "type",
 * using JSON.parse reviver to avoid mutating input.
 * Returns original text if no modification is needed.
 */
function stripUnsupportedFields(bodyText: string): string {
  const state = { modified: false }

  try {
    const body = JSON.parse(bodyText, (_key, value: unknown) => {
      if (
        _key === "cache_control"
        && value !== null
        && typeof value === "object"
        && !Array.isArray(value)
      ) {
        const cc = value as Record<string, unknown>
        const keys = Object.keys(cc)
        if (keys.length > 1 || (keys.length === 1 && !keys.includes("type"))) {
          state.modified = true
          return { type: cc.type }
        }
      }
      return value
    }) as unknown

    return state.modified ? JSON.stringify(body) : bodyText
  } catch {
    return bodyText
  }
}

export async function createMessages(
  bodyText: string,
  requestHeaders: Headers,
  path: MessagesPath = "/v1/messages",
): Promise<Response> {
  consola.debug(`Original request headers: ${JSON.stringify([...requestHeaders])}`)
  requestHeaders = sanitizeBetaHeader(requestHeaders)
  const transformed = normalizeModelName(stripUnsupportedFields(bodyText))
  // TEMP DEBUG: append bodies to /tmp for inspection
  try {
    const fs = await import("node:fs/promises")
    const ts = new Date().toISOString()
    await fs.appendFile("/tmp/copilot-req-log.jsonl", JSON.stringify({ ts, dir: "in", body: JSON.parse(bodyText) }) + "\n")
    await fs.appendFile("/tmp/copilot-req-log.jsonl", JSON.stringify({ ts, dir: "out", body: JSON.parse(transformed) }) + "\n")
  } catch {}
  return postCopilotPassthrough({
    path,
    body: transformed,
    requestHeaders,
    forwardRequestHeaders: REQUEST_HEADERS_TO_FORWARD,
    initiator: "user",
    errorMessage: `Upstream ${path} request failed`,
  })
}

export function isClaudeMessagesRequest(bodyText: string): boolean {
  const payload = tryParsePayload(bodyText)

  return payload?.model?.startsWith("claude") ?? false
}

export function getForwardHeaders(headers: Headers): Headers {
  return filterResponseHeaders(headers)
}

function tryParsePayload(bodyText: string): { model?: string } | undefined {
  try {
    return JSON.parse(bodyText) as { model?: string }
  } catch {
    return undefined
  }
}
