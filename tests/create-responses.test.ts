import { expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import { isResponsesModelAllowed } from "../src/routes/responses/handler"
import {
  createResponses,
  type ResponsesPayload,
} from "../src/services/copilot/create-responses"

state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string> }) => {
    return new Response(
      JSON.stringify({ id: "resp_123", object: "response" }),
      {
        status: 200,
        headers: opts.headers,
      },
    )
  },
)

// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

test("posts responses payload to the GitHub responses endpoint", async () => {
  const payload: ResponsesPayload = {
    model: "gpt-5.4",
    input: "hello",
  }

  await createResponses(payload)

  expect(fetchMock).toHaveBeenCalled()
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "https://api.githubcopilot.com/responses",
  )
  const headers = (
    fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("allows only gpt-5.4 style responses models", () => {
  expect(isResponsesModelAllowed("gpt-5.4")).toBe(true)
  expect(isResponsesModelAllowed("gpt5.4")).toBe(true)
  expect(isResponsesModelAllowed("gpt-4.1")).toBe(false)
})
