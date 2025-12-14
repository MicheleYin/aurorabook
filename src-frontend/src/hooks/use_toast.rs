use leptos::*;
use std::collections::HashMap;
use gloo_timers::callback::Timeout;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ToastType {
    Success,
    Error,
    Warning,
    Info,
    Loading,
}

#[derive(Clone)]
pub struct Toast {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub toast_type: ToastType,
}

#[derive(Clone)]
pub struct ToastContext {
    toasts: RwSignal<HashMap<String, Toast>>,
}

impl ToastContext {
    pub fn new() -> Self {
        Self {
            toasts: create_rw_signal(HashMap::new()),
        }
    }

    pub fn add_toast(&self, toast: Toast) {
        self.toasts.update(|toasts| {
            toasts.insert(toast.id.clone(), toast.clone());
        });
    }

    pub fn remove_toast(&self, id: &str) {
        self.toasts.update(|toasts| {
            toasts.remove(id);
        });
    }

    pub fn get_toasts(&self) -> ReadSignal<HashMap<String, Toast>> {
        self.toasts.read_only()
    }
}

pub fn use_toast() -> ToastApi {
    let context = use_context::<ToastContext>()
        .expect("use_toast must be used within a ToastProvider");
    
    ToastApi::new(context)
}

#[derive(Clone)]
pub struct ToastApi {
    context: ToastContext,
}

impl ToastApi {
    fn new(context: ToastContext) -> Self {
        Self { context }
    }

    fn show(&self, title: String, description: Option<String>, toast_type: ToastType) {
        let id = format!("toast-{}", js_sys::Date::now() as u64);
        let toast = Toast {
            id: id.clone(),
            title,
            description,
            toast_type,
        };
        
        self.context.add_toast(toast);
        
        // Auto-dismiss after 4 seconds (except for loading)
        if toast_type != ToastType::Loading {
            let context_clone = self.context.clone();
            let id_clone = id.clone();
            let _timeout = Timeout::new(4000, move || {
                context_clone.remove_toast(&id_clone);
            });
        }
    }

    pub fn success(&self, title: String, description: Option<String>) {
        self.show(title, description, ToastType::Success);
    }

    pub fn error(&self, title: String, description: Option<String>) {
        self.show(title, description, ToastType::Error);
    }

    pub fn warning(&self, title: String, description: Option<String>) {
        self.show(title, description, ToastType::Warning);
    }

    pub fn info(&self, title: String, description: Option<String>) {
        self.show(title, description, ToastType::Info);
    }

    pub fn loading(&self, title: String, description: Option<String>) {
        self.show(title, description, ToastType::Loading);
    }

    pub fn dismiss(&self, id: &str) {
        self.context.remove_toast(id);
    }
}

#[component]
pub fn ToastProvider(children: Children) -> impl IntoView {
    let context = ToastContext::new();
    provide_context(context);
    
    view! {
        {children()}
    }
}
