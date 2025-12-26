import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
        "**/espeak-ng/**",
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
    // Limit parallel processing to reduce memory pressure
    rollupOptions: {
      output: {
        // Manual chunk splitting to control memory usage
        manualChunks: (id) => {
          // Split node_modules into smaller chunks
          if (id.includes("node_modules")) {
            // Split large dependencies into separate chunks
            if (id.includes("react") || id.includes("react-dom")) {
              return "react-vendor";
            }
            if (id.includes("@radix-ui")) {
              return "radix-vendor";
            }
            if (id.includes("epubjs")) {
              return "epub-vendor";
            }
            // Group other node_modules
            return "vendor";
          }
        },
        // Limit chunk size to reduce memory usage during build
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
      },
    },
    // Use esbuild (default) for memory-efficient minification
    // esbuild is more memory-efficient than terser
    minify: "esbuild",
    // Reduce sourcemap generation memory usage
    sourcemap: false,
    // Limit CSS code splitting to reduce memory
    cssCodeSplit: true,
    // Report compressed size instead of gzipped to reduce memory
    reportCompressedSize: false,
    // Limit the number of assets inlined as base64 to reduce memory
    assetsInlineLimit: 4096,
  },
}));
