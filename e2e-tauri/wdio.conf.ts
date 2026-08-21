import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaultBinary = path.join(
  root,
  "src-tauri/target/release/aurorabook"
);

/**
 * Native Tauri E2E via @wdio/tauri-service (embedded WebDriver).
 *
 * Requires a binary built with the `e2e` Cargo feature and the WDIO plugins.
 * See ./README.md. Until plugins are wired, this config is the scaffold for
 * local/native runs — CI continues to use Playwright mock IPC.
 */
export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "chrome",
      "wdio:maxInstances": 1,
    },
  ],
  logLevel: "info",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  services: [
    [
      "tauri",
      {
        appBinaryPath: process.env.TAURI_APP_PATH ?? defaultBinary,
        driverProvider: "embedded",
      },
    ],
  ],
};
