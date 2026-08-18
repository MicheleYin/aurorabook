import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { initI18n } from "./lib/i18n";
import { isNativeReaderContextMenuTarget } from "./lib/reader-utils";

import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "Root element not found. Make sure there's a <div id='root'></div> in your HTML."
  );
}

document.addEventListener("contextmenu", (e) => {
  if (isNativeReaderContextMenuTarget(e.target)) {
    return;
  }
  e.preventDefault();
});

async function init() {
  try {
    // Initialize i18n before rendering
    await initI18n();

    ReactDOM.createRoot(rootElement!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    // Use console.error directly as it's critical for error reporting
    console.error("Failed to initialize or render app:", error);
    rootElement!.innerHTML = `
      <div style="padding: 2rem; font-family: system-ui; color: #ef4444; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 0.5rem;">
        <h1 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem;">Failed to load application</h1>
        <p style="margin-bottom: 0.5rem;">${error instanceof Error ? error.message : String(error)}</p>
        <p style="font-size: 0.875rem; color: #7f1d1d;">Check the browser console for more details.</p>
      </div>
    `;
  }
}

init();
