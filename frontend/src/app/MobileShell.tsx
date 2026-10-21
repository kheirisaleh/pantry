import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { userChooser, UserBadge } from "@/features/users";
import { sessionSet } from "@/lib/storage";
import { useStore } from "@/lib/store";
import { routePath, type RouteKey } from "@/lib/routes";
import { Icon, NavIcon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { bootStore, userStore } from "./session";
import { routeKey, useAutoRefresh } from "./useAutoRefresh";

export const TABS: [RouteKey, string][] = [
  ["today", "Today"],
  ["plan", "Plan"],
  ["shop", "Shop"],
  ["pantry", "Pantry"],
];

export const MORE: [RouteKey, string][] = [
  ["recipes", "Dishes"],
  ["reports", "Reports"],
  ["alerts", "Notes"],
  ["settings", "Settings"],
];

function MoreSheet({ close }: { close: () => void }) {
  const alerts = useStore(bootStore)?.alerts ?? 0;
  return (
    <SheetLayout title="More" onClose={close}>
      <div className="more-grid">
        {MORE.map(([key, label]) => (
          <Link key={key} to={routePath(key, true)} className="more-item" onClick={close}>
            <NavIcon name={key} />
            <span>{label}</span>
            {key === "alerts" && alerts ? <span className="badge">{alerts}</span> : null}
          </Link>
        ))}
        <a href="/" className="more-item" onClick={() => sessionSet("stay-desktop", "1")}>
          <NavIcon name="today" />
          <span>Desktop view</span>
        </a>
      </div>
    </SheetLayout>
  );
}

export function MobileShell() {
  const location = useLocation();
  const key = routeKey(location.pathname);
  const alerts = useStore(bootStore)?.alerts ?? 0;
  useAutoRefresh(key);

  useEffect(() => {
    if (!userStore.get()) userChooser();
  }, []);

  const moreActive = MORE.some(([entry]) => entry === key);
  return (
    <>
      <header className="topbar" id="topbar">
        <div className="brand-small">
          <img className="brand-mark brand-logo" src="/logo.svg" alt="" />
          Pantry
        </div>
        <div className="row">
          <Link to="/m/alerts" className="btn icon ghost bell" aria-label="Notes">
            <Icon name="bell" />
            {alerts ? <span className="badge">{alerts}</span> : null}
          </Link>
          <UserBadge />
        </div>
      </header>
      <main className="mmain" id="main">
        <Outlet />
      </main>
      <nav className="tabbar" id="tabbar" aria-label="Sections">
        {TABS.map(([tab, label]) => (
          <NavLink key={tab} to={routePath(tab, true)} end={tab === "today"} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
            <NavIcon name={tab} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" className={"tab" + (moreActive ? " active" : "")} onClick={() => openSheet((close) => <MoreSheet close={close} />, { label: "More" })}>
          <NavIcon name="more" />
          <span>More</span>
          {alerts ? <span className="badge">{alerts}</span> : null}
        </button>
      </nav>
    </>
  );
}
