# Leptos Quick Start Guide

## Immediate Configuration Changes

### 1. Update `src-tauri/tauri.conf.json`

Replace the current `build` section:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AuroraBook",
  "version": "0.1.0",
  "identifier": "com.bigemperor26.tauri",
  "build": {
    "beforeDevCommand": "trunk serve",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "trunk build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    // ... rest of your bundle config stays the same
  }
}
```

### 2. Create `Trunk.toml` in project root

```toml
[build]
target = "./index.html"

[watch]
ignore = ["./src-tauri"]

[serve]
port = 1420
open = false
ws_protocol = "ws"
```

### 3. Create `src-frontend/Cargo.toml`

```toml
[package]
name = "aurorabook-frontend"
version = "0.1.0"
edition = "2021"

[lib]
name = "aurorabook_frontend"
crate-type = ["cdylib"]
path = "src/lib.rs"

[dependencies]
# Leptos
leptos = { version = "0.6", features = ["csr"] }
leptos_router = "0.6"
leptos_meta = "0.6"
leptos_use = "0.6"

# Tauri
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
tauri-plugin-store = "2"
tauri-plugin-os = "2"

# Serialization
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
serde_json = "1"

# WASM
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"

# Web APIs
web-sys = { version = "0.3", features = [
  "Window",
  "Document",
  "Element",
  "HtmlElement",
  "HtmlAudioElement",
  "MediaQueryList",
  "MediaQueryListEvent",
  "Event",
  "EventTarget",
  "Storage",
  "Location",
] }
gloo-utils = "0.1"
gloo-timers = "0.2"
gloo-storage = "0.2"

# Utilities
console_error_panic_hook = "0.1"
tracing = "0.1"
tracing-wasm = "0.1"
```

### 4. Create `src-frontend/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="format-detection" content="telephone=no, email=no, address=no" />
    <meta name="mobile-web-app-capable" content="yes" />
    <title>AuroraBook</title>
    <link data-trunk rel="css" href="/src/index.css"/>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

### 5. Create `src-frontend/src/lib.rs`

```rust
use leptos::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    
    mount_to_body(|| {
        view! {
            <App />
        }
    })
}

#[component]
fn App() -> impl IntoView {
    view! {
        <div class="flex min-h-screen flex-col bg-background text-foreground">
            <h1 class="text-4xl font-bold p-8">AuroraBook - Leptos</h1>
            <p class="px-8">Migration in progress...</p>
        </div>
    }
}
```

### 6. Install Trunk

```bash
cargo install trunk
```

### 7. Update package.json scripts (optional, for compatibility)

You can keep some scripts but they'll call Trunk instead:

```json
{
  "scripts": {
    "dev": "trunk serve",
    "build": "trunk build",
    "preview": "trunk serve"
  }
}
```

## Development Workflow

### Run Development Server
```bash
cd src-frontend
trunk serve
```

### Build for Production
```bash
cd src-frontend
trunk build --release
```

### Run with Tauri
```bash
# From project root
bun tauri dev
```

## Key Differences from React

### 1. Components
```rust
// React
function Button({ onClick, children }) {
  return <button onClick={onClick}>{children}</button>;
}

// Leptos
#[component]
fn Button(on_click: Callback<()>, children: Children) -> impl IntoView {
    view! {
        <button on:click=move |_| on_click.call(())>
            {children()}
        </button>
    }
}
```

### 2. State
```rust
// React
const [count, setCount] = useState(0);

// Leptos
let (count, set_count) = create_signal(0);
```

### 3. Effects
```rust
// React
useEffect(() => {
  // side effect
}, [deps]);

// Leptos
create_effect(move |_| {
    // side effect
    let _ = deps.get();
});
```

### 4. Async Data
```rust
// React
const [data, setData] = useState(null);
useEffect(() => {
  fetchData().then(setData);
}, []);

// Leptos
let data = Resource::new(
    || (),
    |_| async move {
        fetch_data().await
    }
);
```

## Next Steps

1. Start with migrating simple components (Button, Input)
2. Migrate state management (library, settings)
3. Migrate complex components (ReaderAudioPlayer last)
4. Test thoroughly at each step

See `LEPTOS_MIGRATION_PLAN.md` for the complete migration strategy.
