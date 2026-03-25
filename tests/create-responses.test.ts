import { expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import {
  createResponses,
  getForwardHeaders,
  isResponsesModelAllowed,
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

  await createResponses(JSON.stringify(payload), new Headers())

  expect(fetchMock).toHaveBeenCalled()
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "https://api.githubcopilot.com/responses",
  )
  const headers = (
    fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("allows GPT models for responses", () => {
  expect(isResponsesModelAllowed('{"model":"gpt-5.4"}')).toBe(true)
  expect(isResponsesModelAllowed('{"model":"gpt-4.1"}')).toBe(true)
  expect(isResponsesModelAllowed('{"model":"gpt-4o"}')).toBe(true)
  expect(isResponsesModelAllowed('{"model":"claude-sonnet-4"}')).toBe(false)
  expect(isResponsesModelAllowed("{}")).toBe(false)
})

test("filters responses headers through the responses helper", () => {
  const headers = getForwardHeaders(
    new Headers({
      connection: "keep-alive",
      "content-type": "application/json",
      "cache-control": "no-cache",
      "x-request-id": "req_123",
    }),
  )

  expect(headers.get("connection")).toBeNull()
  expect(headers.get("content-type")).toBe("application/json")
  expect(headers.get("cache-control")).toBe("no-cache")
  expect(headers.get("x-request-id")).toBe("req_123")
})
