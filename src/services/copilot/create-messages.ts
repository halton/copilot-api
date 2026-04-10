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

const UNSUPPORTED_BETA_VALUES = new Set([
  CONTEXT_1M_BETA,
])

function hasContext1mBeta(headers: Headers): boolean {
  const beta = headers.get("anthropic-beta")
  if (!beta) return false
  return beta.split(",").map(v => v.trim()).includes(CONTEXT_1M_BETA)
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
  if (hasContext1mBeta(requestHeaders)) {
    consola.debug(
      "Request includes unsupported beta features. Stripping unsupported beta flags and fields.",
    )
    requestHeaders = sanitizeBetaHeader(requestHeaders)
  }
  return postCopilotPassthrough({
    path,
    body: stripUnsupportedFields(bodyText),
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
