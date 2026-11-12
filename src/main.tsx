import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "./components/ui/badge.css";

// Remove credentials left by older browser-only versions of the dashboard.
localStorage.removeItem("integration.apiKey");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
