import { useEffect } from "react";
import { invalidateAll } from "@/lib/store";
import { hasOpenSheet } from "@/ui/modal";
import { refreshBoot } from "./session";

export function isBusy(): boolean {
  const active = document.activeElement;
  const typing = active instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  return hasOpenSheet() || typing;
}

export function useAutoRefresh(route: string): void {
  useEffect(() => {
    const boot = window.setInterval(() => {
      void refreshBoot();
    }, 30000);
    const data = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isBusy() && route !== "shop") invalidateAll();
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshBoot();
      if (!isBusy()) invalidateAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(boot);
      window.clearInterval(data);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [route]);
}

export function routeKey(pathname: string): string {
  const parts = pathname.replace(/^\/m(?=\/|$)/, "").split("/").filter(Boolean);
  return parts[0] ?? "today";
}
