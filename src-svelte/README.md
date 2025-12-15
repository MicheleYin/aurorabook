# AuroraBook SvelteKit Frontend

This is the SvelteKit frontend for AuroraBook, migrated from Leptos.

## Setup

1. Install dependencies:
```bash
npm install
# or
bun install
```

2. Run development server:
```bash
npm run dev
# or
bun run dev
```

3. Build for production:
```bash
npm run build
# or
bun run build
```

## Project Structure

- `src/lib/types/` - TypeScript type definitions matching Rust types
- `src/lib/services/` - Tauri service layer (commands and events)
- `src/lib/stores/` - Svelte stores for state management
- `src/lib/components/` - Svelte components
- `src/routes/` - SvelteKit routes

## Migration Notes

This frontend replaces the Leptos frontend in `src-frontend/`. The Tauri backend remains unchanged and continues to work with the same commands and events.

Key differences from Leptos:
- Uses Svelte stores instead of Leptos signals
- Uses SvelteKit routing instead of Leptos Router
- TypeScript/JavaScript instead of Rust/WASM
- Same Tauri API integration via `@tauri-apps/api`

