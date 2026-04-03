#!/usr/bin/env node

import { runMain } from "citty"

import { daemon } from "./daemon"

await runMain(daemon)
