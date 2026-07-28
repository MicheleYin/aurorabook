import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      // Phase 4: critical logic + providers/hooks. UI shells stay out (Phase 5 / Playwright).
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/constants/**/*.{ts,tsx}",
        "src/context/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/vite-env.d.ts",
        "src/main.tsx",
      ],
      thresholds: {
        // Dense FE logic: ~91% lines today.
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
