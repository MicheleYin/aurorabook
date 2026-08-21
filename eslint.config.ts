import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import pluginReact from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/.history/**",
      "**/.mypy_cache/**",
      "**/.svelte-kit/**",
      "**/.venv/**",
      "**/venv/**",
      "**/onnxruntime/**",
      "**/ort/**",
      "**/Kokoros/**",
      "**/misaki/**",
      "**/misaki-rs/**",
      "**/phonetisaurus-g2p-rs/**",
      "**/piper-rs/**",
      "**/patches/**",
      "**/aurora-new/**",
      "**/eslint/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.lock",
      "**/bun.lock",
      "**/package-lock.json",
      "**/uv.lock",
      "**/Cargo.lock",
      "**/*.json",
      "**/*.md",
      "**/*.css",
      // Node build helpers — CommonJS + process; not part of the Vite app surface.
      "scripts/**",
      "e2e-tauri/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      react: pluginReact,
      "react-hooks": reactHooks,
    },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off", // TypeScript handles prop validation
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn", // Warn on missing dependencies
      // React Compiler rules: keep as warnings until call sites are migrated.
      // They currently fail large amounts of intentional UI sync code in CI.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["**/*.config.{js,ts,mjs}", "**/vite.config.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
