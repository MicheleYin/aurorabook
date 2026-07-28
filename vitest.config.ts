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
        // Stepwise gate after Phase 2–3 (~55% today). Raise as more contexts/hooks gain tests.
        lines: 50,
        functions: 50,
        branches: 45,
        statements: 50,
      },
    },
  },
});
