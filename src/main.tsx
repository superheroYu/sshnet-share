import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { FloatingView } from "./features/floating/FloatingView";

function resolveWindowLabel() {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

const isFloating = resolveWindowLabel() === "floating";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isFloating ? <FloatingView /> : <App />}</React.StrictMode>,
);
