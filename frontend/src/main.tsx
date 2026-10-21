import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "@/app/router";
import { boot } from "@/app/session";
import { sessionGet } from "@/lib/storage";
import { legacyTarget, phonePath, shouldUsePhone } from "@/lib/routes";
import "@/styles/fonts.css";
import "@/styles/base.css";
import "@/styles/desktop.css";
import "@/styles/mobile.css";
import "@/styles/polish.css";

const legacy = legacyTarget(window.location.pathname, window.location.hash);
if (legacy) window.history.replaceState(null, "", legacy);
if (shouldUsePhone(window.location.pathname, window.matchMedia("(max-width: 760px)").matches, navigator.userAgent, Boolean(sessionGet("stay-desktop")))) {
  window.history.replaceState(null, "", phonePath(window.location.pathname));
}

void boot();

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
