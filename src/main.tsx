import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadPrefs } from "./lib/prefs";
import { applyTheme } from "./lib/theme";
import "./index.css";

// Apply saved theme before first paint to avoid dark→light flash.
applyTheme(loadPrefs().theme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
