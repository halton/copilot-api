import type { Context } from "hono"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

const ALLOWED_RESPONSES_MODELS = new Set(["gpt54"])

export function isResponsesModelAllowed(model: string): boolean {
  return ALLOWED_RESPONSES_MODELS.has(normalizeResponsesModel(model))
}

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  if (!payload.model || !isResponsesModelAllowed(payload.model)) {
    return c.json(
      {
        error: {
          message: "Responses API is only enabled for gpt-5.4.",
          type: "invalid_request_error",
        },
      },
      400,
    )
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createResponses(payload)
  return new Response(response.body, {
    status: response.status,
    headers: getForwardHeaders(response.headers),
  })
}

function normalizeResponsesModel(model: string): string {
  return model.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function getForwardHeaders(headers: Headers): Headers {
  const forwardHeaders = new Headers()

  for (const headerName of ["content-type", "cache-control", "x-request-id"]) {
    const value = headers.get(headerName)
    if (value) {
      forwardHeaders.set(headerName, value)
    }
  }

  return forwardHeaders
}
