import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignSystemProvider } from "./design-system";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemProvider>
      <App />
    </DesignSystemProvider>
  </StrictMode>,
);
