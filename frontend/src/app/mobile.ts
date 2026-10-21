import { useLocation } from "react-router";
import { isMobilePath, type RouteKey, routePath } from "@/lib/routes";

export function useMobile(): boolean {
  return isMobilePath(useLocation().pathname);
}

export function usePath(): (key: RouteKey) => string {
  const mobile = useMobile();
  return (key) => routePath(key, mobile);
}
