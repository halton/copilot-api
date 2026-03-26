import consola from "consola"
import fs from "node:fs/promises"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./error"
import { state } from "./state"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

// Retry logic with exponential backoff
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const getCopilotTokenWithRetry = async (
  maxRetries = 3,
  initialDelayMs = 1000,
) => {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await getCopilotToken()
    } catch (error) {
      lastError = error as Error
      const delayMs = initialDelayMs * Math.pow(2, attempt)
      consola.warn(
        `Token refresh attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms:`,
        lastError.message,
      )
      if (attempt < maxRetries - 1) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError || new Error("Failed to refresh Copilot token")
}

// Force refresh token (called when 401 is detected)
export const forceRefreshCopilotToken = async () => {
  try {
    consola.debug("Force refreshing Copilot token due to 401 response")
    const { token } = await getCopilotTokenWithRetry()
    state.copilotToken = token
    consola.debug("Copilot token force refreshed successfully")
  } catch (error) {
    consola.error("Failed to force refresh Copilot token:", error)
    // Don't throw - let the caller handle the error
  }
}

export const setupCopilotToken = async () => {
  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token

  // Display the Copilot token to the screen
  consola.debug("GitHub Copilot Token fetched successfully!")
  if (state.showToken) {
    consola.info("Copilot token:", token)
  }

  const refreshInterval = (refresh_in - 60) * 1000
  setInterval(async () => {
    try {
      consola.debug("Refreshing Copilot token")
      const { token } = await getCopilotTokenWithRetry()
      state.copilotToken = token
      consola.debug("Copilot token refreshed successfully")
      if (state.showToken) {
        consola.info("Refreshed Copilot token:", token)
      }
    } catch (error) {
      // Don't throw - just log the error and continue with old token
      // If token is actually expired, 401 response will trigger forceRefreshCopilotToken
      consola.error(
        "Failed to refresh Copilot token, will retry on next interval:",
        error,
      )
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }
    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
