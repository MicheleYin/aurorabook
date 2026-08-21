import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const e2eMock = process.env.VITE_E2E_MOCK === "1";

const e2eTauriAliases = e2eMock
  ? {
      "@tauri-apps/api/core": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-core.ts"
      ),
      "@tauri-apps/api/event": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-event.ts"
      ),
      "@tauri-apps/api/app": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-app.ts"
      ),
      "@tauri-apps/plugin-os": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-plugin-os.ts"
      ),
      "@tauri-apps/plugin-dialog": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-plugin-dialog.ts"
      ),
      "@tauri-apps/plugin-fs": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-plugin-fs.ts"
      ),
      "@tauri-apps/plugin-store": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-plugin-store.ts"
      ),
      "@tauri-apps/plugin-opener": path.resolve(
        __dirname,
        "src/test/e2e/shims/tauri-plugin-opener.ts"
      ),
    }
  : {};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...e2eTauriAliases,
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and build directories
      ignored: [
        "**/src-tauri/**",
        "**/onnxruntime/**",
        "**/ort/**",
        "**/Kokoros/**",
      ],
    },
    // Prevent Vite from processing files in build directories
    fs: {
      deny: [
        "**/onnxruntime/**",
        "**/ort/**",
        "**/Kokoros/**",
        "**/misaki/**",
        "**/misaki-rs/**",
        "**/phonetisaurus-g2p-rs/**",
        "**/piper-rs/**",
      ],
    },
  },
  // Exclude build directories from optimization
  optimizeDeps: {
    exclude: ["onnxruntime", "ort"],
  },
  // Build optimizations for memory efficiency
  build: {
    // Reduce memory usage by processing chunks sequentially
    chunkSizeWarningLimit: 1000,
    // Enable source maps in production for debugging (can disable later if needed)
    sourcemap: true,
    // Limit parallel processing to reduce memory pressure
    rollupOptions: {
      output: {
        // Simplified chunk splitting - less aggressive to avoid loading issues
        manualChunks: (id) => {
          // Only split node_modules, keep it simple
          if (id.includes("node_modules")) {
            // Group all vendor code together to avoid chunk loading issues
            return "vendor";
          }
        },
        // Ensure consistent asset paths for Tauri
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        // Ensure proper chunk format for better compatibility
        format: "es",
      },
    },
    // Use esbuild (default) for memory-efficient minification
    // esbuild is more memory-efficient than terser
    minify: "esbuild",
    // Limit CSS code splitting to reduce memory
    cssCodeSplit: true,
    // Report compressed size instead of gzipped to reduce memory
    reportCompressedSize: false,
    // Limit the number of assets inlined as base64 to reduce memory
    assetsInlineLimit: 4096,
    // Ensure assets are properly referenced (important for Tauri)
    assetsDir: "assets",
    // Target modern browsers for better compatibility
    target: "esnext",
  },
}));
