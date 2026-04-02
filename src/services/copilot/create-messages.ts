import { filterResponseHeaders, postCopilotPassthrough } from "./passthrough"

type MessagesPath = "/v1/messages" | "/v1/messages/count_tokens"

const REQUEST_HEADERS_TO_FORWARD = [
  "accept",
  "anthropic-beta",
  "anthropic-version",
] as const

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
