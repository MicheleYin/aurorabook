# React to Leptos Pattern Comparison

This document provides side-by-side comparisons of common React patterns and their Leptos equivalents.

## Table of Contents

1. [Components](#components)
2. [State Management](#state-management)
3. [Effects](#effects)
4. [Async Data](#async-data)
5. [Event Handlers](#event-handlers)
6. [Conditional Rendering](#conditional-rendering)
7. [Lists](#lists)
8. [Context/Providers](#contextproviders)
9. [Refs](#refs)
10. [Memoization](#memoization)

## Components

### Basic Component

**React:**
```typescript
function Button({ onClick, children }: ButtonProps) {
  return (
    <button onClick={onClick}>
      {children}
    </button>
  );
}
```

**Leptos:**
```rust
#[component]
fn Button(on_click: Callback<()>, children: Children) -> impl IntoView {
    view! {
        <button on:click=move |_| on_click.call(())>
            {children()}
        </button>
    }
}
```

### Component with Props

**React:**
```typescript
interface BookCardProps {
  book: Book;
  onSelect: (id: string) => void;
  isSelected?: boolean;
}

function BookCard({ book, onSelect, isSelected = false }: BookCardProps) {
  return (
    <div className={isSelected ? "selected" : ""}>
      <h3>{book.title}</h3>
      <button onClick={() => onSelect(book.id)}>Select</button>
    </div>
  );
}
```

**Leptos:**
```rust
#[component]
fn BookCard(
    book: Book,
    on_select: Callback<String>,
    #[prop(optional)] is_selected: Option<bool>,
) -> impl IntoView {
    let is_selected = is_selected.unwrap_or(false);
    
    view! {
        <div class=if is_selected { "selected" } else { "" }>
            <h3>{book.title}</h3>
            <button on:click=move |_| on_select.call(book.id.clone())>
                "Select"
            </button>
        </div>
    }
}
```

## State Management

### Local State

**React:**
```typescript
const [count, setCount] = useState(0);
const [name, setName] = useState("");

// Update
setCount(count + 1);
setName("New Name");
```

**Leptos:**
```rust
let (count, set_count) = create_signal(0);
let (name, set_name) = create_signal(String::new());

// Update
set_count.set(count.get() + 1);
set_name.set("New Name".to_string());
```

### Derived State

**React:**
```typescript
const [count, setCount] = useState(0);
const doubled = useMemo(() => count * 2, [count]);
```

**Leptos:**
```rust
let (count, set_count) = create_signal(0);
let doubled = create_memo(move |_| count.get() * 2);
```

### Read-Only Signal

**React:**
```typescript
const [count, setCount] = useState(0);
// No direct way to make read-only
```

**Leptos:**
```rust
let (count, set_count) = create_signal(0);
let count_readonly = count.read_only(); // Can't be written to
```

## Effects

### Basic Effect

**React:**
```typescript
useEffect(() => {
  console.log("Count changed:", count);
}, [count]);
```

**Leptos:**
```rust
create_effect(move |_| {
    let count_value = count.get();
    web_sys::console::log_1(&format!("Count changed: {}", count_value).into());
});
```

### Effect with Cleanup

**React:**
```typescript
useEffect(() => {
  const timer = setInterval(() => {
    console.log("Tick");
  }, 1000);
  
  return () => clearInterval(timer);
}, []);
```

**Leptos:**
```rust
create_effect(move |_| {
    let handle = gloo_timers::callback::Interval::new(1000, move || {
        web_sys::console::log_1(&"Tick".into());
    });
    
    on_cleanup(move || {
        handle.cancel();
    });
});
```

### Effect That Runs Once

**React:**
```typescript
useEffect(() => {
  // Run once on mount
  initialize();
}, []); // Empty deps
```

**Leptos:**
```rust
create_effect(move |_| {
    initialize();
});
// Or use on_mount
on_mount(move || {
    initialize();
});
```

## Async Data

### Loading Data

**React:**
```typescript
const [data, setData] = useState<Data | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  setLoading(true);
  fetchData()
    .then(setData)
    .finally(() => setLoading(false));
}, []);
```

**Leptos:**
```rust
let data = Resource::new(
    || (),
    |_| async move {
        fetch_data().await
    }
);

// Access with loading state
view! {
    {move || match data.get() {
        None => view! { <p>"Loading..."</p> },
        Some(Ok(data)) => view! { <DataView data /> },
        Some(Err(e)) => view! { <p>{"Error: "}{e}</p> },
    }}
}
```

### Resource with Parameters

**React:**
```typescript
const [bookId, setBookId] = useState<string | null>(null);
const [book, setBook] = useState<Book | null>(null);

useEffect(() => {
  if (bookId) {
    loadBook(bookId).then(setBook);
  }
}, [bookId]);
```

**Leptos:**
```rust
let (book_id, set_book_id) = create_signal(None::<String>);

let book = Resource::new(
    move || book_id.get(),
    |book_id| async move {
        if let Some(id) = book_id {
            load_book(id).await
        } else {
            Ok(None)
        }
    }
);
```

## Event Handlers

### Click Handler

**React:**
```typescript
<button onClick={(e) => {
  e.preventDefault();
  handleClick();
}}>
  Click me
</button>
```

**Leptos:**
```rust
view! {
    <button on:click=move |ev| {
        ev.prevent_default();
        handle_click();
    }>
        "Click me"
    </button>
}
```

### Input Handler

**React:**
```typescript
<input
  value={name}
  onChange={(e) => setName(e.target.value)}
/>
```

**Leptos:**
```rust
view! {
    <input
        prop:value=move || name.get()
        on:input=move |ev| {
            let value = event_target_value(&ev);
            set_name.set(value);
        }
    />
}
```

## Conditional Rendering

### Simple Conditional

**React:**
```typescript
{isLoading ? <Spinner /> : <Content />}
```

**Leptos:**
```rust
view! {
    {move || if is_loading.get() {
        view! { <Spinner /> }
    } else {
        view! { <Content /> }
    }}
}
```

### Multiple Conditions

**React:**
```typescript
{status === "loading" && <Spinner />}
{status === "error" && <Error />}
{status === "success" && <Content />}
```

**Leptos:**
```rust
view! {
    {move || match status.get().as_str() {
        "loading" => view! { <Spinner /> },
        "error" => view! { <Error /> },
        "success" => view! { <Content /> },
        _ => view! { <></> },
    }}
}
```

## Lists

### Rendering List

**React:**
```typescript
{books.map(book => (
  <BookCard key={book.id} book={book} />
))}
```

**Leptos:**
```rust
view! {
    <For
        each=move || books.get()
        key=|book| book.id.clone()
        children=move |book| {
            view! { <BookCard book=book.clone() /> }
        }
    />
}
```

### List with Index

**React:**
```typescript
{items.map((item, index) => (
  <Item key={index} item={item} index={index} />
))}
```

**Leptos:**
```rust
view! {
    <For
        each=move || items.get()
        key=|item| item.id.clone()
        children=move |(index, item)| {
            view! { <Item item=item.clone() index=index /> }
        }
    />
}
```

## Context/Providers

### Creating Context

**React:**
```typescript
const AppContext = createContext<AppState | null>(null);

function AppProvider({ children }) {
  const [library, setLibrary] = useState<Book[]>([]);
  
  return (
    <AppContext.Provider value={{ library, setLibrary }}>
      {children}
    </AppContext.Provider>
  );
}
```

**Leptos:**
```rust
#[derive(Clone)]
pub struct AppState {
    pub library: RwSignal<Vec<Book>>,
}

#[component]
pub fn AppProvider(children: Children) -> impl IntoView {
    let state = AppState {
        library: create_rw_signal(vec![]),
    };
    
    provide_context(state.clone());
    
    view! {
        {children()}
    }
}
```

### Using Context

**React:**
```typescript
const { library, setLibrary } = useContext(AppContext)!;
```

**Leptos:**
```rust
let app_state = use_context::<AppState>().expect("AppState should be provided");
let library = app_state.library;
```

## Refs

### DOM Ref

**React:**
```typescript
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  inputRef.current?.focus();
}, []);

return <input ref={inputRef} />;
```

**Leptos:**
```rust
let input_ref = NodeRef::<html::Input>::new();

create_effect(move |_| {
    if let Some(input) = input_ref.get() {
        input.focus().unwrap();
    }
});

view! {
    <input node_ref=input_ref />
}
```

### Mutable Ref

**React:**
```typescript
const timerRef = useRef<NodeJS.Timeout | null>(null);

timerRef.current = setTimeout(() => {}, 1000);
```

**Leptos:**
```rust
let timer_ref = create_rw_signal(None::<gloo_timers::callback::Timeout>);

let handle = gloo_timers::callback::Timeout::new(1000, move || {
    // callback
});
timer_ref.set(Some(handle));
```

## Memoization

### Memoized Component

**React:**
```typescript
const MemoizedBookCard = memo(BookCard, (prev, next) => {
  return prev.book.id === next.book.id;
});
```

**Leptos:**
```rust
// Leptos automatically memoizes based on signal changes
// No explicit memo needed - signals are already reactive
#[component]
fn BookCard(book: ReadSignal<Book>) -> impl IntoView {
    // Only re-renders when book signal changes
    view! {
        <div>{move || book.get().title}</div>
    }
}
```

### Memoized Value

**React:**
```typescript
const expensiveValue = useMemo(() => {
  return expensiveCalculation(data);
}, [data]);
```

**Leptos:**
```rust
let expensive_value = create_memo(move |_| {
    expensive_calculation(data.get())
});
```

## Tauri Integration

### Calling Tauri Commands

**React:**
```typescript
import { invoke } from "@tauri-apps/api/core";

const books = await invoke<Book[]>("read_all_books", { filter });
```

**Leptos:**
```rust
use tauri::Manager;

async fn load_books(app: AppHandle) -> Result<Vec<Book>, String> {
    tauri::command::invoke(
        &app,
        "read_all_books",
        serde_json::json!({ "filter": None::<()> })
    )
    .await
    .map_err(|e| e.to_string())
}
```

### Listening to Events

**React:**
```typescript
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = await listen("file-opened", (event) => {
    handleFileOpen(event.payload);
  });
  return () => unlisten();
}, []);
```

**Leptos:**
```rust
use tauri::Manager;

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
```

## Common Patterns in Your Codebase

### Your useLibrary Hook

**React (Current):**
```typescript
export function useLibrary() {
  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  
  useEffect(() => {
    readAllBooks().then(books => {
      setLibrary(books);
      setIsHydrated(true);
    });
  }, []);
  
  return { library, setLibrary, isHydrated };
}
```

**Leptos (Target):**
```rust
pub fn use_library(app: AppHandle) -> (
    ReadSignal<Vec<Book>>,
    WriteSignal<Vec<Book>>,
    ReadSignal<bool>
) {
    let (library, set_library) = create_signal(vec![]);
    let (is_hydrated, set_is_hydrated) = create_signal(false);
    
    let library_resource = Resource::new(
        || (),
        move |_| async move {
            read_all_books(&app, None).await.unwrap_or_default()
        }
    );
    
    create_effect(move |_| {
        if let Some(books) = library_resource.get() {
            set_library.set(books);
            set_is_hydrated.set(true);
        }
    });
    
    (library.read_only(), library, is_hydrated.read_only())
}
```

### Your AppContext Pattern

**React (Current):**
```typescript
const AppContext = createContext<AppState | null>(null);

export function AppContextProvider({ children, library }) {
  const [activeBookId, setActiveBookId] = useState<string | undefined>();
  // ... more state
  
  return (
    <AppContext.Provider value={{ activeBookId, setActiveBookId, ... }}>
      {children}
    </AppContext.Provider>
  );
}
```

**Leptos (Target):**
```rust
#[derive(Clone)]
pub struct AppState {
    pub active_book_id: RwSignal<Option<String>>,
    // ... more signals
}

#[component]
pub fn AppContextProvider(children: Children, library: ReadSignal<Vec<Book>>) -> impl IntoView {
    let state = AppState {
        active_book_id: create_rw_signal(None),
        // ... more signals
    };
    
    provide_context(state.clone());
    
    view! {
        {children()}
    }
}
```

## Tips for Migration

1. **Start with simple components** - Button, Input, etc.
2. **Convert types first** - Get your data structures right
3. **Use signals for state** - They're the core of Leptos reactivity
4. **Resources for async** - Perfect for data loading
5. **Test frequently** - Migrate one component at a time
6. **Keep React version** - Until Leptos version is fully working

## Resources

- [Leptos Book](https://leptos.dev/book/)
- [Leptos Examples](https://github.com/leptos-rs/leptos/tree/main/examples)
- [Tauri + Leptos Guide](https://tauri.app/start/frontend/leptos/)
