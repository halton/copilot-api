import type { Context, Next } from "hono"

function nowIso(): string {
  return new Date().toISOString()
}

export function requestLogger() {
  return async function timestampedRequestLogger(
    c: Context,
    next: Next,
  ): Promise<void> {
    const startTime = performance.now()

    await next()

    const durationMs = (performance.now() - startTime).toFixed(1)
    const method = c.req.method
    const path = c.req.path
    const status = c.res.status

    console.log(`[${nowIso()}] ${method} ${path} ${status} ${durationMs}ms`)
  }
}

export function logError(message: string, error: unknown): void {
  console.error(`[${nowIso()}] ${message}`, error)
}
