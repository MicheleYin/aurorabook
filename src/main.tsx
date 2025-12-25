import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";

import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "Root element not found. Make sure there's a <div id='root'></div> in your HTML."
  );
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  // Use console.error directly in main.tsx as it's critical for error reporting
  console.error("Failed to render app:", error);
  rootElement.innerHTML = `
    <div style="padding: 2rem; font-family: system-ui; color: red;">
      <h1>Failed to load application</h1>
      <p>${error instanceof Error ? error.message : String(error)}</p>
      <p>Check the browser console for more details.</p>
    </div>
  `;
}
