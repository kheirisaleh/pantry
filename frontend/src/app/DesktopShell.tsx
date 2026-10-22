import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { userChooser, UserBadge } from "@/features/users";
import { useStore } from "@/lib/store";
import { routePath, type RouteKey } from "@/lib/routes";
import { NavIcon } from "@/ui/icons";
import { bootStore, userStore } from "./session";
import { routeKey, useAutoRefresh } from "./useAutoRefresh";

export const DESKTOP_NAV: [RouteKey, string][] = [
  ["today", "Today"],
  ["plan", "Plan"],
  ["recipes", "Dishes"],
  ["pantry", "Pantry"],
  ["shop", "Shopping"],
  ["reports", "Reports"],
  ["alerts", "Notes"],
  ["settings", "Settings"],
];

function AssistantStatus() {
  const ai = useStore(bootStore)?.ai;
  if (!ai) return null;
  const tone = !ai.key_set ? "off" : ai.queued ? "busy" : "";
  const text = !ai.key_set ? "Assistant offline" : ai.queued ? "Assistant working on " + String(ai.queued) : "Assistant idle";
  return (
    <div className="rail-ai">
      <span className={"ai-dot " + tone} />
      <span>{text}</span>
    </div>
  );
}

export function DesktopShell() {
  const location = useLocation();
  const alerts = useStore(bootStore)?.alerts ?? 0;
  useAutoRefresh(routeKey(location.pathname));

  useEffect(() => {
    if (!userStore.get()) userChooser();
  }, []);

  return (
    <div className="app">
      <aside className="rail">
        <Link className="brand" to="/">
          <img className="brand-mark brand-logo" src="/logo.svg" alt="" />
          <span className="brand-word">Pantry</span>
        </Link>
        <nav className="rail-nav" aria-label="Sections">
          {DESKTOP_NAV.map(([key, label]) => (
            <NavLink key={key} to={routePath(key, false)} end={key === "today"} className={({ isActive }) => "rail-link" + (isActive ? " active" : "")}>
              <NavIcon name={key} />
              <span>{label}</span>
              {key === "alerts" && alerts ? <span className="badge">{alerts}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <AssistantStatus />
          <div className="rail-user">
            <UserBadge />
          </div>
        </div>
      </aside>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
