import { filterResponseHeaders, postCopilotPassthrough } from "./passthrough"

export interface ResponsesPayload {
  model?: string
  stream?: boolean | null
  [key: string]: unknown
}

const RESPONSE_HEADERS_TO_FORWARD = [
  "content-type",
  "cache-control",
  "x-request-id",
] as const

export function isResponsesModelAllowed(bodyText: string): boolean {
  const payload = tryParsePayload(bodyText)
  return payload?.model?.startsWith("gpt") ?? false
}

function tryParsePayload(bodyText: string): ResponsesPayload | undefined {
  try {
    return JSON.parse(bodyText) as ResponsesPayload
  } catch {
    return undefined
  }
}

export const createResponses = async (
  bodyText: string,
  requestHeaders?: Headers,
) => {
  return postCopilotPassthrough({
    path: "/responses",
    body: bodyText,
    requestHeaders,
    initiator: "user",
    errorMessage: "Failed to create responses",
    throwOnError: true,
  })
}

export function getForwardHeaders(headers: Headers): Headers {
  return filterResponseHeaders(headers, RESPONSE_HEADERS_TO_FORWARD)
}
