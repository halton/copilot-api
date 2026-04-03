import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/main.ts", "src/daemon-main.ts"],

  format: ["esm"],
  target: "es2022",
  platform: "node",

  sourcemap: true,
  clean: true,
  removeNodeProtocol: false,

  env: {
    NODE_ENV: "production",
  },
})
