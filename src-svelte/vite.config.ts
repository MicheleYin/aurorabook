import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1421
				}
			: undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	},
	clearScreen: false,
	build: {
		target: 'esnext',
		minify: 'esbuild',
		esbuild: {
			legalComments: 'none',
			minifyIdentifiers: true,
			minifySyntax: true,
			minifyWhitespace: true,
			treeShaking: true
		},
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					if (id.includes('node_modules')) {
						if (id.includes('@tauri-apps')) {
							return 'tauri-vendor';
						}
						return 'vendor';
					}
				},
				chunkFileNames: 'assets/js/[name]-[hash].js',
				entryFileNames: 'assets/js/[name]-[hash].js',
				assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
				compact: true
			},
			maxParallelFileOps: 2
		},
		chunkSizeWarningLimit: 1000,
		cssCodeSplit: true,
		sourcemap: false,
		reportCompressedSize: true
	},
	optimizeDeps: {
		maxParallelFileOps: 2,
		include: ['svelte']
	}
});

