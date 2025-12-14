# Leptos Migration Plan for AuroraBook

## Executive Summary

This document outlines a comprehensive plan to migrate the AuroraBook frontend from React + TypeScript + Vite to Leptos (Rust-based web framework). This migration will provide:
- **Memory Safety**: Rust's ownership system eliminates entire classes of bugs
- **Better Performance**: Compiled Rust code with zero-cost abstractions
- **Type Safety**: Rust's type system is more powerful than TypeScript
- **Smaller Bundle Size**: No JavaScript runtime overhead
- **Unified Language**: Frontend and backend both in Rust

## Current Architecture Analysis

### Current Stack
- **Frontend Framework**: React 18.3.1
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **State Management**: React Hooks + Context API
- **Backend**: Tauri 2.x (Rust)
- **Tauri Commands**: 20+ commands for book management, TTS, EPUB processing

### Key Components & Complexity

#### High Complexity Components
1. **ReaderAudioPlayer.tsx** (2,302 lines)
   - Complex audio playback logic
   - Media session integration
   - Progress tracking
   - Track management

2. **App.tsx** (1,034 lines)
   - Main application orchestrator
   - Complex state management
   - Multiple context providers
   - Navigation logic

3. **useAudioTextSync.ts** (853 lines)
   - Audio-text synchronization
   - Highlighting logic
   - Complex timing calculations

4. **useChapterState.ts** (857 lines)
   - Chapter loading and state management
   - Progress tracking
   - DOM manipulation

#### State Management Patterns
- **Context Providers**: AppContext, LibraryProvider, ReaderCoordinatorContext, HighlightQueueContext
- **Custom Hooks**: 20+ custom hooks for:
  - Audio management (6 hooks)
  - Chapter management (6 hooks)
  - Library operations (4 hooks)
  - Settings persistence (3 hooks)
  - Reader features (6 hooks)

#### Tauri Integration Points
- 20+ Tauri commands invoked via `invoke()`
- Event listeners for file-open events
- Plugin usage: dialog, fs, opener, store, os

## Migration Strategy

### Phase 1: Infrastructure Setup (Week 1-2)

#### 1.1 Install Leptos & Trunk
```bash
# Add to Cargo.toml
cargo add leptos@0.6
cargo add leptos_router@0.6
cargo add leptos_meta@0.6
cargo add leptos_use@0.6  # For hooks-like functionality
cargo add serde --features derive
cargo add serde-wasm-bindgen
cargo add wasm-bindgen
cargo add web-sys
cargo add gloo-utils
cargo add gloo-timers

# Install Trunk
cargo install trunk
```

#### 1.2 Update Tauri Configuration
Update `src-tauri/tauri.conf.json`:
```json
{
  "build": {
    "beforeDevCommand": "trunk serve",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "trunk build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true
  }
}
```

#### 1.3 Create Trunk Configuration
Create `Trunk.toml`:
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

#### 1.4 Update Cargo.toml
Add frontend crate configuration:
```toml
[lib]
name = "aurorabook_frontend"
crate-type = ["cdylib"]

[dependencies]
# Leptos
leptos = { version = "0.6", features = ["csr"] }
leptos_router = "0.6"
leptos_meta = "0.6"
leptos_use = "0.6"

# Tauri integration
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
tauri-plugin-store = "2"
tauri-plugin-os = "2"

# Serialization
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
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

#### 1.5 Create New Project Structure
```
src-frontend/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── main.rs
│   ├── app.rs
│   ├── components/
│   │   ├── mod.rs
│   │   ├── reader/
│   │   ├── library/
│   │   ├── ui/
│   │   └── app/
│   ├── hooks/
│   │   ├── mod.rs
│   │   ├── audio/
│   │   ├── chapter/
│   │   ├── library/
│   │   └── settings/
│   ├── contexts/
│   │   ├── mod.rs
│   │   └── app_context.rs
│   ├── lib/
│   │   ├── mod.rs
│   │   ├── book_service.rs
│   │   ├── epub.rs
│   │   └── utils.rs
│   └── types/
│       ├── mod.rs
│       └── reader.rs
├── index.html
└── Trunk.toml
```

### Phase 2: Core Infrastructure Migration (Week 3-4)

#### 2.1 Type System Migration
Convert TypeScript types to Rust structs:

**Before (TypeScript):**
```typescript
export interface Book {
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
  audioTracks: AudioTrack[];
  // ...
}
```

**After (Rust):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub chapters: Vec<Chapter>,
    pub audio_tracks: Vec<AudioTrack>,
    // ...
}
```

#### 2.2 Tauri Command Wrappers
Create Rust wrappers for Tauri commands:

```rust
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryFilter {
    pub filter: Option<String>,
    pub search: Option<String>,
}

pub async fn read_all_books(
    app: AppHandle,
    filter: Option<LibraryFilter>
) -> Result<Vec<Book>, String> {
    tauri::command::invoke(
        &app,
        "read_all_books",
        serde_json::json!({ "filter": filter })
    ).await
    .map_err(|e| e.to_string())
}
```

#### 2.3 State Management Setup
Replace React Context with Leptos signals and resources:

**Before (React):**
```typescript
const [library, setLibrary] = useState<Book[]>([]);
```

**After (Leptos):**
```rust
use leptos::*;

#[derive(Clone)]
pub struct AppState {
    pub library: RwSignal<Vec<Book>>,
    pub active_book_id: RwSignal<Option<String>>,
    // ...
}

pub fn provide_app_context() -> AppState {
    AppState {
        library: create_rw_signal(vec![]),
        active_book_id: create_rw_signal(None),
        // ...
    }
}
```

### Phase 3: Component Migration (Week 5-10)

#### 3.1 Migration Priority Order

**Priority 1: Core UI Components**
1. Button, Input, Select, Slider (replace Radix UI)
2. Dialog, Drawer, Tabs
3. LoadingScreen, ErrorBoundary

**Priority 2: Library Components**
1. LibraryPanel
2. LibraryGrid/List
3. LibrarySearchBar
4. BookDetailDialog

**Priority 3: Reader Components**
1. ReaderPanel
2. ReaderViewport
3. ChapterList
4. ReaderSettingsControl

**Priority 4: Audio Components**
1. ReaderAudioPlayer (most complex)
2. AudioTracksDialog

**Priority 5: Settings & App**
1. SettingsPanel
2. App (main orchestrator)

#### 3.2 Component Migration Pattern

**Before (React):**
```typescript
function Button({ children, onClick, disabled }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
```

**After (Leptos):**
```rust
use leptos::*;

#[component]
pub fn Button(
    children: Children,
    on_click: Option<Callback<()>>,
    disabled: Option<bool>,
) -> impl IntoView {
    view! {
        <button
            on:click=move |_| {
                if let Some(cb) = on_click {
                    cb.call(());
                }
            }
            disabled=disabled.unwrap_or(false)
        >
            {children()}
        </button>
    }
}
```

#### 3.3 Hook Migration Pattern

**Before (React Hook):**
```typescript
function useLibrary() {
  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  
  useEffect(() => {
    loadLibrary().then(setLibrary);
    setIsHydrated(true);
  }, []);
  
  return { library, setLibrary, isHydrated };
}
```

**After (Leptos Resource):**
```rust
use leptos::*;

pub fn use_library() -> (
    ReadSignal<Vec<Book>>,
    WriteSignal<Vec<Book>>,
    Resource<(), Vec<Book>>
) {
    let (library, set_library) = create_signal(vec![]);
    
    let library_resource = Resource::new(
        || (),
        move |_| async move {
            read_all_books(None).await.unwrap_or_default()
        }
    );
    
    Effect::new(move |_| {
        if let Some(books) = library_resource.get() {
            set_library.set(books);
        }
    });
    
    (library.read_only(), library, library_resource)
}
```

### Phase 4: Complex Features Migration (Week 11-14)

#### 4.1 Audio Player Migration
The `ReaderAudioPlayer` component is the most complex. Migration strategy:

1. **Break into smaller components:**
   - `AudioControls` (play/pause/skip)
   - `AudioProgress` (slider + time display)
   - `AudioTrackSelector`
   - `PlaybackRateSelector`

2. **Audio synchronization:**
   - Convert `useAudioTextSync` to Leptos resource
   - Use `create_effect` for reactive updates
   - Use `web_sys::HtmlAudioElement` directly

3. **Media Session API:**
   - Use `web_sys::MediaSession` directly
   - Create wrapper functions for metadata updates

#### 4.2 Chapter State Management
Convert `useChapterState` to Leptos:

```rust
pub struct ChapterState {
    pub current_chapter: RwSignal<Option<Chapter>>,
    pub scroll_position: RwSignal<f64>,
    pub is_loading: RwSignal<bool>,
}

pub fn use_chapter_state(
    book_id: ReadSignal<Option<String>>,
    chapter_id: ReadSignal<Option<String>>,
) -> ChapterState {
    let current_chapter = create_rw_signal(None);
    let scroll_position = create_rw_signal(0.0);
    let is_loading = create_rw_signal(false);
    
    // Load chapter when IDs change
    create_effect(move |_| {
        if let (Some(book_id), Some(chapter_id)) = (book_id.get(), chapter_id.get()) {
            is_loading.set(true);
            spawn_local(async move {
                let chapter = load_chapter(book_id, chapter_id).await;
                current_chapter.set(chapter);
                is_loading.set(false);
            });
        }
    });
    
    ChapterState {
        current_chapter,
        scroll_position,
        is_loading,
    }
}
```

#### 4.3 Event Handling
Convert Tauri event listeners:

**Before (React):**
```typescript
useEffect(() => {
  const unlisten = await listen("file-opened", (event) => {
    handleFileOpen(event.payload);
  });
  return () => unlisten();
}, []);
```

**After (Leptos):**
```rust
use leptos::*;
use tauri::Manager;

pub fn use_file_open_listener(
    app: AppHandle,
    on_file_open: Callback<String>
) {
    create_effect(move |_| {
        let app = app.clone();
        let callback = on_file_open.clone();
        
        spawn_local(async move {
            let mut listener = app.listen("file-opened", move |event| {
                if let Some(path) = event.payload().as_str() {
                    callback.call(path.to_string());
                }
            }).await;
        });
    });
}
```

### Phase 5: Styling & UI Polish (Week 15-16)

#### 5.1 Tailwind CSS Integration
Leptos works with Tailwind CSS. Options:

1. **Keep Tailwind** (recommended):
   - Use `class` attribute in Leptos views
   - Tailwind classes work the same way

2. **Alternative**: Use `leptos-use` with `style!` macro for inline styles

#### 5.2 Replace Radix UI Components
Since Radix UI is React-only, we need alternatives:

1. **Build custom components** using Leptos + Tailwind
2. **Use Leptos UI libraries**:
   - `leptos-use` for utilities
   - Build custom accessible components

3. **Key components to rebuild:**
   - Dialog (modal)
   - Select (dropdown)
   - Slider
   - Tabs
   - ScrollArea

### Phase 6: Testing & Optimization (Week 17-18)

#### 6.1 Testing Strategy
1. **Unit Tests**: Test individual components and hooks
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Use existing Playwright tests (update selectors)

#### 6.2 Performance Optimization
1. **Code Splitting**: Use Leptos router for lazy loading
2. **Memoization**: Use `create_memo` for expensive computations
3. **Resource Caching**: Leverage Leptos resource caching
4. **Bundle Size**: Compare before/after bundle sizes

#### 6.3 Memory Optimization
1. **Signal Cleanup**: Ensure proper signal disposal
2. **Resource Cleanup**: Clean up resources on unmount
3. **Event Listener Cleanup**: Remove all event listeners

## Migration Challenges & Solutions

### Challenge 1: Third-Party Dependencies

**Problem**: Some dependencies are JavaScript-only:
- `epubjs` - EPUB rendering library
- `lamejs` - MP3 encoding
- `dompurify` - HTML sanitization
- `react-virtuoso` - Virtual scrolling

**Solutions**:
1. **epubjs**: 
   - Option A: Use `wasm-bindgen` to call from Rust
   - Option B: Find Rust alternative (e.g., `epub-rs`)
   - Option C: Keep minimal JS bridge for EPUB rendering

2. **lamejs**: 
   - Use Rust `lame` crate (already in backend)
   - Move encoding to backend

3. **dompurify**: 
   - Use Rust `ammonia` or `scraper` (already in backend)
   - Sanitize on backend before sending to frontend

4. **react-virtuoso**: 
   - Build custom virtual scrolling with Leptos
   - Use `leptos-use` utilities

### Challenge 2: Complex State Management

**Problem**: React's Context API and hooks are deeply integrated

**Solution**: 
- Use Leptos signals for local state
- Use resources for async data
- Use `provide_context` / `use_context` for global state
- Create custom hooks (functions returning signals/resources)

### Challenge 3: DOM Manipulation

**Problem**: Some code directly manipulates DOM (e.g., scrolling, highlighting)

**Solution**:
- Use `NodeRef` for direct DOM access
- Use `create_effect` for reactive DOM updates
- Use `web_sys` APIs directly

### Challenge 4: Type Safety

**Problem**: TypeScript types need conversion to Rust

**Solution**:
- Create comprehensive type definitions
- Use `serde` for serialization
- Ensure Tauri command types match

## Migration Checklist

### Infrastructure
- [ ] Install Leptos and dependencies
- [ ] Set up Trunk configuration
- [ ] Update Tauri configuration
- [ ] Create new project structure
- [ ] Set up build pipeline

### Core Types
- [ ] Convert TypeScript types to Rust structs
- [ ] Set up serialization (serde)
- [ ] Create Tauri command wrappers
- [ ] Set up error handling

### State Management
- [ ] Create app context
- [ ] Migrate library state
- [ ] Migrate reader state
- [ ] Migrate settings state
- [ ] Migrate audio state

### UI Components
- [ ] Basic components (Button, Input, etc.)
- [ ] Layout components
- [ ] Dialog components
- [ ] Form components

### Feature Components
- [ ] LibraryPanel
- [ ] ReaderPanel
- [ ] ReaderAudioPlayer
- [ ] SettingsPanel

### Hooks/Resources
- [ ] Audio hooks
- [ ] Chapter hooks
- [ ] Library hooks
- [ ] Settings hooks

### Integration
- [ ] Tauri event listeners
- [ ] File system operations
- [ ] Storage operations
- [ ] Theme management

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] Performance benchmarks

### Documentation
- [ ] Update README
- [ ] Document new architecture
- [ ] Migration guide for future changes

## Estimated Timeline

- **Phase 1**: 2 weeks (Infrastructure)
- **Phase 2**: 2 weeks (Core infrastructure)
- **Phase 3**: 6 weeks (Component migration)
- **Phase 4**: 4 weeks (Complex features)
- **Phase 5**: 2 weeks (Styling & polish)
- **Phase 6**: 2 weeks (Testing & optimization)

**Total**: ~18 weeks (4.5 months) for a full-time developer

## Risk Assessment

### High Risk
1. **Audio synchronization complexity** - Most complex feature
2. **EPUB rendering** - May need to keep JS bridge
3. **Third-party dependencies** - Some may not have Rust alternatives

### Medium Risk
1. **State management migration** - Complex but manageable
2. **Performance regressions** - Need careful optimization
3. **Testing coverage** - Need comprehensive testing

### Low Risk
1. **Basic UI components** - Straightforward migration
2. **Tauri integration** - Well-documented
3. **Styling** - Tailwind works with Leptos

## Recommendations

1. **Start with a proof of concept**: Migrate one small feature first (e.g., SettingsPanel)
2. **Incremental migration**: Consider running both React and Leptos side-by-side initially
3. **Keep TypeScript types**: Maintain TypeScript definitions for reference during migration
4. **Test frequently**: Run tests after each component migration
5. **Performance monitoring**: Compare performance metrics before/after
6. **Documentation**: Keep detailed notes on migration decisions

## Alternative Approach: Hybrid Migration

If full migration is too risky, consider a hybrid approach:

1. **Keep React for complex components** (ReaderAudioPlayer, EPUB rendering)
2. **Migrate simpler components** to Leptos
3. **Use WebAssembly bridge** for communication
4. **Gradually migrate** more components over time

This reduces risk but adds complexity of maintaining two frameworks.

## Conclusion

This migration is ambitious but achievable. The benefits (memory safety, performance, unified language) are significant. The main challenges are:
1. Complexity of audio synchronization
2. Third-party dependency replacements
3. Learning curve for Leptos

With careful planning and incremental migration, this can be successfully completed.
