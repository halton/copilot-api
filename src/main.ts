#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import packageJson from "../package.json"
import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { debug } from "./debug"
import { start } from "./start"

const main = defineCommand({
  meta: {
    name: "copilot-api",
    version: packageJson.version,
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  args: {
    version: {
      type: "boolean",
      alias: "V",
      description: "Show version number",
    },
  },
  run({ args }) {
    if (args.version) {
      console.log(packageJson.version)
      process.exit(0)
    }
  },
  subCommands: { auth, start, "check-usage": checkUsage, debug },
})

await runMain(main)
