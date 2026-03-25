import type { Context } from "hono"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  getForwardHeaders,
  isResponsesModelAllowed,
} from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const bodyText = await c.req.text()

  if (!isResponsesModelAllowed(bodyText)) {
    return c.json(
      {
        error: {
          message: "Responses API is only enabled for GPT models.",
          type: "invalid_request_error",
        },
      },
      400,
    )
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createResponses(bodyText, c.req.raw.headers)
  return new Response(response.body, {
    status: response.status,
    headers: getForwardHeaders(response.headers),
  })
}
