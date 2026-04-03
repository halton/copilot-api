#!/usr/bin/env node

import { runMain } from "citty"

import { service } from "./service"

await runMain(service)
