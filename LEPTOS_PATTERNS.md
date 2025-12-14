# Leptos Patterns & Best Practices

This document summarizes key Leptos patterns based on the [official Leptos book](https://book.leptos.dev/) and our implementation experience.

## Table of Contents

1. [Reactivity Patterns](#reactivity-patterns)
2. [Component Patterns](#component-patterns)
3. [Parent-Child Communication](#parent-child-communication)
4. [State Management](#state-management)
5. [Forms and Inputs](#forms-and-inputs)
6. [Async Patterns](#async-patterns)
7. [Common Pitfalls](#common-pitfalls)

---

## Reactivity Patterns

### Signals

**`create_signal`** - Creates a read/write signal pair
```rust
let (count, set_count) = create_signal(0);

// Reading
let value = count.get();

// Writing
set_count.set(5);
set_count.update(|n| *n += 1);
```

**`create_rw_signal`** - Single handle for read/write
```rust
let count = create_rw_signal(0);

// Reading
let value = count.get();

// Writing
count.set(5);
count.update(|n| *n += 1);

// Read-only access
let read_only = count.read_only();
```

**When to use:**
- `create_signal`: When you need separate read/write handles (common pattern)
- `create_rw_signal`: When a single handle is sufficient (simpler API)

### Memos

**`create_memo`** - Derived reactive values
```rust
let (value, set_value) = create_signal(0);

// Memo recomputes only when dependencies change
let doubled = create_memo(move |_| value.get() * 2);

// Access memoized value
let result = doubled.get();
```

**Best practices:**
- Use for expensive computations
- Use for derived state that depends on signals
- Memos only recompute when dependencies change
- Memos only notify dependents if the computed value changes

### Effects

**`create_effect`** - Side effects in response to signal changes
```rust
let (count, set_count) = create_signal(0);

create_effect(move |_| {
    println!("Count changed to: {}", count.get());
    // Side effects here (DOM updates, API calls, etc.)
});
```

**Important rules:**
- ✅ Use effects for **side effects** (DOM updates, logging, API calls)
- ❌ **Don't** write to signals within effects (use memos for derived state)
- Effects run whenever dependencies change
- Use `on_cleanup` for cleanup logic

```rust
create_effect(move |_| {
    let timeout = gloo_timers::callback::Timeout::new(2000, move || {
        // Do something
    });
    
    on_cleanup(move || {
        timeout.cancel();
    });
});
```

---

## Component Patterns

### Basic Component

```rust
#[component]
pub fn MyComponent(
    name: String,
    #[prop(optional)] age: Option<u32>,
) -> impl IntoView {
    view! {
        <div>
            <p>{name}</p>
            {age.map(|a| view! { <p>{a}</p> })}
        </div>
    }
}
```

### Reactive Props

Props can be reactive by accepting signals:

```rust
#[component]
pub fn ReactiveComponent(
    value: ReadSignal<String>,
) -> impl IntoView {
    view! {
        <div>
            {move || value.get()}
        </div>
    }
}
```

### Children

```rust
#[component]
pub fn Container(children: Children) -> impl IntoView {
    view! {
        <div class="container">
            {children()}
        </div>
    }
}
```

### Conditional Rendering

```rust
view! {
    {move || {
        if condition.get() {
            view! { <div>"Shown"</div> }.into_view()
        } else {
            view! { <></> }.into_view()
        }
    }}
}
```

### Iteration

```rust
let items = vec!["a", "b", "c"];

view! {
    <ul>
        {items.into_iter().map(|item| {
            view! {
                <li>{item}</li>
            }
        }).collect::<Vec<_>>()}
    </ul>
}
```

---

## Parent-Child Communication

### Pattern 1: Callbacks

**Parent passes callback to child:**

```rust
#[component]
pub fn Parent() -> impl IntoView {
    let (count, set_count) = create_signal(0);
    
    view! {
        <Child on_click=Callback::new(move |_| {
            set_count.update(|n| *n += 1);
        }) />
    }
}

#[component]
pub fn Child(on_click: Callback<()>) -> impl IntoView {
    view! {
        <button on:click=move |_| on_click.call(())>
            "Click me"
        </button>
    }
}
```

### Pattern 2: WriteSignal Props

**Parent passes WriteSignal to child:**

```rust
#[component]
pub fn Parent() -> impl IntoView {
    let (count, set_count) = create_signal(0);
    
    view! {
        <Child set_count=set_count />
    }
}

#[component]
pub fn Child(set_count: WriteSignal<u32>) -> impl IntoView {
    view! {
        <button on:click=move |_| set_count.update(|n| *n += 1)>
            "Click me"
        </button>
    }
}
```

### Pattern 3: Context API

**Share state across component tree:**

```rust
#[component]
pub fn App() -> impl IntoView {
    let (count, set_count) = create_signal(0);
    
    // Provide context to all descendants
    provide_context(set_count);
    
    view! {
        <Layout />
    }
}

#[component]
pub fn SomeDeepChild() -> impl IntoView {
    // Access context from ancestor
    let set_count = use_context::<WriteSignal<u32>>()
        .expect("set_count not found in context");
    
    view! {
        <button on:click=move |_| set_count.update(|n| *n += 1)>
            "Increment"
        </button>
    }
}
```

**When to use:**
- **Callbacks**: Simple parent-child communication, event handling
- **WriteSignal props**: Direct state updates from child
- **Context**: Sharing state across many levels (avoid prop drilling)

---

## State Management

### Local Component State

```rust
#[component]
pub fn Counter() -> impl IntoView {
    let (count, set_count) = create_signal(0);
    
    view! {
        <button on:click=move |_| set_count.update(|n| *n += 1)>
            {move || count.get()}
        </button>
    }
}
```

### Global State with Context

```rust
// Define state struct
#[derive(Clone)]
struct AppState {
    user: RwSignal<Option<User>>,
    theme: RwSignal<Theme>,
}

#[component]
pub fn App() -> impl IntoView {
    let state = AppState {
        user: create_rw_signal(None),
        theme: create_rw_signal(Theme::Light),
    };
    
    provide_context(state);
    
    view! {
        <Layout />
    }
}

#[component]
pub fn SomeComponent() -> impl IntoView {
    let state = use_context::<AppState>()
        .expect("AppState not found");
    
    view! {
        <div>
            {move || state.user.get().map(|u| view! { <p>{u.name}</p> })}
        </div>
    }
}
```

### Reactive Slices (Performance)

For large state objects, create reactive slices to avoid unnecessary updates:

```rust
let state = create_rw_signal(AppState { ... });

// Create slice for specific field
let user = create_memo(move |_| state.get().user.clone());

// Only components using `user` will update when user changes
// Other fields changing won't trigger updates
```

---

## Forms and Inputs

### Controlled Inputs

```rust
#[component]
pub fn Form() -> impl IntoView {
    let (name, set_name) = create_signal(String::new());
    
    view! {
        <input
            type="text"
            value=move || name.get()
            on:input=move |ev| {
                let value = event_target_value(&ev);
                set_name.set(value);
            }
        />
        <p>{move || name.get()}</p>
    }
}
```

### Uncontrolled Inputs

```rust
#[component]
pub fn Form() -> impl IntoView {
    let input_ref = create_node_ref::<leptos::html::Input>();
    
    let handle_submit = move |_| {
        if let Some(input) = input_ref.get() {
            let value = input.value();
            // Use value
        }
    };
    
    view! {
        <form on:submit=handle_submit>
            <input node_ref=input_ref type="text" />
            <button type="submit">Submit</button>
        </form>
    }
}
```

---

## Async Patterns

### Resources

**Loading async data:**

```rust
#[component]
pub fn DataComponent() -> impl IntoView {
    let async_data = Resource::new(
        || (),
        |_| async {
            // Fetch data
            fetch_data().await
        }
    );
    
    view! {
        {move || {
            match async_data.get() {
                None => view! { <p>"Loading..."</p> },
                Some(Ok(data)) => view! { <p>{data}</p> },
                Some(Err(e)) => view! { <p>"Error: {e}"</p> },
            }
        }}
    }
}
```

### Suspense

```rust
view! {
    <Suspense fallback=move || view! { <p>"Loading..."</p> }>
        <DataComponent />
    </Suspense>
}
```

### Manual Async with spawn_local

```rust
use leptos::spawn_local;

#[component]
pub fn Component() -> impl IntoView {
    let (data, set_data) = create_signal(None::<String>);
    
    create_effect(move |_| {
        spawn_local(async move {
            let result = fetch_data().await;
            set_data.set(Some(result));
        });
    });
    
    view! {
        {move || data.get().map(|d| view! { <p>{d}</p> })}
    }
}
```

---

## Common Pitfalls

### ❌ Moving Values in Closures

**Problem:**
```rust
let value = "hello".to_string();
view! {
    {move || {
        // value is moved here
        view! { <p>{value}</p> }
    }}
    {move || {
        // ERROR: value already moved!
        view! { <p>{value}</p> }
    }}
}
```

**Solution:**
```rust
let value = "hello".to_string();
let value1 = value.clone();
let value2 = value.clone();

view! {
    {move || view! { <p>{value1}</p> }}
    {move || view! { <p>{value2}</p> }}
}
```

### ❌ Writing to Signals in Effects

**Problem:**
```rust
let (a, set_a) = create_signal(0);
let (b, set_b) = create_signal(0);

create_effect(move |_| {
    set_b.set(a.get() * 2); // ❌ Don't do this!
});
```

**Solution:**
```rust
let (a, set_a) = create_signal(0);
let b = create_memo(move |_| a.get() * 2); // ✅ Use memo
```

### ❌ Non-Reactive Props

**Problem:**
```rust
#[component]
pub fn Component(value: String) -> impl IntoView {
    view! {
        <p>{value}</p> // Won't update when parent changes
    }
}
```

**Solution:**
```rust
#[component]
pub fn Component(value: ReadSignal<String>) -> impl IntoView {
    view! {
        <p>{move || value.get()}</p> // ✅ Reactive
    }
}
```

### ❌ FnOnce Closures

**Problem:**
```rust
let data = vec![1, 2, 3];
view! {
    {move || {
        data.into_iter().map(|n| view! { <p>{n}</p> }).collect::<Vec<_>>()
        // data is moved, can't use again
    }}
}
```

**Solution:**
```rust
let data = vec![1, 2, 3];
let data_clone = data.clone();
view! {
    {move || {
        data_clone.iter().map(|n| view! { <p>{*n}</p> }).collect::<Vec<_>>()
    }}
}
```

---

## Best Practices Summary

1. **Use signals for reactive state** - `create_signal` or `create_rw_signal`
2. **Use memos for derived values** - `create_memo` for computed state
3. **Use effects for side effects** - DOM updates, API calls, logging
4. **Don't write to signals in effects** - Use memos instead
5. **Use Callback for event handlers** - Type-safe callback pattern
6. **Use Context for shared state** - Avoid prop drilling
7. **Clone values before moving** - When using in multiple closures
8. **Make props reactive when needed** - Pass signals, not values
9. **Use Resources for async data** - Built-in loading/error states
10. **Use Suspense for loading states** - Better UX

---

## References

- [Leptos Book](https://book.leptos.dev/)
- [Leptos Docs](https://docs.rs/leptos/)
- [Leptos Examples](https://github.com/leptos-rs/leptos/tree/main/examples)
