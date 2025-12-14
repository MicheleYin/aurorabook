import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Memory optimization and aggressive bundling settings
  build: {
    // Target modern browsers to reduce polyfills and bundle size
    target: "esnext",
    
    // Use esbuild for minification (more memory efficient than terser)
    minify: "esbuild",
    
    // Aggressive minification options
    esbuild: {
      legalComments: "none",
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      treeShaking: true,
    },

    // Optimize chunk splitting to reduce memory usage
    rollupOptions: {
      output: {
        // Manual chunk splitting to control memory usage
        manualChunks: (id) => {
          // Split vendor chunks for better memory management
          if (id.includes("node_modules")) {
            // Large libraries get their own chunks
            if (id.includes("react") || id.includes("react-dom")) {
              return "react-vendor";
            }
            if (id.includes("@radix-ui")) {
              return "radix-vendor";
            }
            if (id.includes("epubjs")) {
              return "epub-vendor";
            }
            if (id.includes("lucide-react")) {
              return "lucide-vendor";
            }
            // Other node_modules
            return "vendor";
          }
        },
        
        // Limit chunk size to prevent memory issues
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        
        // Compact output to reduce memory usage
        compact: true,
      },
      
      // Limit concurrent chunk processing to reduce memory pressure
      maxParallelFileOps: 2,
    },

    // Reduce memory usage during build
    chunkSizeWarningLimit: 1000,
    
    // Enable CSS code splitting
    cssCodeSplit: true,
    
    // Optimize source maps (use "hidden" for production to save memory)
    sourcemap: false,
    
    // Report compressed size
    reportCompressedSize: true,
    
    // Reduce memory usage by writing files incrementally
    write: true,
  },

  // Optimize dependency pre-bundling for development
  optimizeDeps: {
    // Limit concurrent pre-bundling to reduce memory usage
    maxParallelFileOps: 2,
    
    // Exclude large dependencies that don't need pre-bundling
    exclude: [],
    
    // Include only essential dependencies
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
    ],
  },
}));
