import { filterResponseHeaders, postCopilotPassthrough } from "./passthrough"

type MessagesPath = "/v1/messages" | "/v1/messages/count_tokens"

const REQUEST_HEADERS_TO_FORWARD = [
  "accept",
  "anthropic-beta",
  "anthropic-version",
] as const

export async function createMessages(
  bodyText: string,
  requestHeaders: Headers,
  path: MessagesPath = "/v1/messages",
): Promise<Response> {
  return postCopilotPassthrough({
    path,
    body: bodyText,
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
