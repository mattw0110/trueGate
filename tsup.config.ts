import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["cjs"],
    target: "node20",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: { "proxy/server": "src/proxy/server.ts" },
    format: ["esm", "cjs"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    dts: true,
  },
]);
