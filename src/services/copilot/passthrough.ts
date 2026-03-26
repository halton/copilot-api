import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { forceRefreshCopilotToken } from "~/lib/token"

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export type CopilotInitiator = "agent" | "user"

interface CopilotRequestHeadersOptions {
  requestHeaders?: Headers
  forwardRequestHeaders?: ReadonlyArray<string>
  initiator: CopilotInitiator
  enableVision?: boolean
}

interface PostCopilotPassthroughOptions {
  path: string
  body: string
  requestHeaders?: Headers
  forwardRequestHeaders?: ReadonlyArray<string>
  initiator: CopilotInitiator
  enableVision?: boolean
  errorMessage: string
  throwOnError?: boolean
}

export async function postCopilotPassthrough({
  path,
  body,
  requestHeaders,
  forwardRequestHeaders,
  initiator,
  enableVision = false,
  errorMessage,
  throwOnError = false,
}: PostCopilotPassthroughOptions): Promise<Response> {
  if (!state.copilotToken) {
    throw new Error("Copilot token not found")
  }

  // First attempt
  let response = await makeRequest()

  // If we get 401, try to refresh token and retry once
  if (response.status === 401) {
    consola.warn("Received 401, attempting to refresh Copilot token and retry")
    await forceRefreshCopilotToken()
    response = await makeRequest()
  }

  consola.debug("Passthrough response:", {
    path,
    status: response.status,
    ok: response.ok,
  })

  if (!response.ok) {
    consola.error(errorMessage, response)
    if (throwOnError) {
      throw new HTTPError(errorMessage, response)
    }
  }

  return response

  // Helper function to make the actual request
  async function makeRequest() {
    const headers = buildCopilotRequestHeaders({
      requestHeaders,
      forwardRequestHeaders,
      initiator,
      enableVision,
    })

    consola.debug("Passthrough request:", {
      method: "POST",
      path,
      bodyLength: body.length,
    })

    return fetch(`${copilotBaseUrl(state)}${path}`, {
      method: "POST",
      headers,
      body,
    })
  }
}

export function buildCopilotRequestHeaders({
  requestHeaders,
  forwardRequestHeaders = [],
  initiator,
  enableVision = false,
}: CopilotRequestHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": initiator,
  }

  if (!requestHeaders) {
    return headers
  }

  for (const headerName of forwardRequestHeaders) {
    const value = requestHeaders.get(headerName)
    if (value) {
      headers[headerName] = value
    }
  }

  return headers
}

export function filterResponseHeaders(
  headers: Headers,
  allowedHeaders?: ReadonlyArray<string>,
): Headers {
  const forwardHeaders = new Headers()

  if (allowedHeaders) {
    for (const headerName of allowedHeaders) {
      const value = headers.get(headerName)
      if (value) {
        forwardHeaders.set(headerName, value)
      }
    }

    return forwardHeaders
  }

  for (const [headerName, value] of headers.entries()) {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(headerName.toLowerCase())) {
      forwardHeaders.set(headerName, value)
    }
  }

  return forwardHeaders
}
