export const DESKTOP_ROUTES = ["today", "plan", "recipes", "pantry", "shop", "reports", "alerts", "settings"] as const;
export type RouteKey = (typeof DESKTOP_ROUTES)[number];

export function isMobilePath(pathname: string): boolean {
  return pathname === "/m" || pathname.startsWith("/m/");
}

export function routePath(key: RouteKey, mobile: boolean): string {
  if (key === "today") return mobile ? "/m" : "/";
  return (mobile ? "/m/" : "/") + key;
}

export function legacyTarget(pathname: string, hash: string): string | null {
  const key = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const mobile = isMobilePath(pathname);
  if (!key) return pathname === "/m/" ? "/m" : null;
  if (!(DESKTOP_ROUTES as readonly string[]).includes(key)) return mobile ? "/m" : "/";
  return routePath(key as RouteKey, mobile);
}

export function shouldUsePhone(pathname: string, narrow: boolean, userAgent: string, stayDesktop: boolean): boolean {
  if (isMobilePath(pathname) || stayDesktop) return false;
  return narrow && /iPhone|Android/i.test(userAgent);
}

export function phonePath(pathname: string): string {
  return pathname === "/" ? "/m" : "/m" + pathname;
}
