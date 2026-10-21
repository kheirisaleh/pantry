import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { DesktopShell } from "./DesktopShell";
import { MobileShell } from "./MobileShell";
import { Root } from "./Root";
import { NotFound, RouteError } from "./RouteError";

type Loader = () => Promise<Record<string, unknown>>;

function page(load: Loader, name: string): Pick<RouteObject, "lazy"> {
  return {
    lazy: async () => {
      const module = await load();
      return { Component: module[name] as ComponentType };
    },
  };
}

const pages = () => import("@/pages");

function sections(): RouteObject[] {
  return [
    { index: true, ...page(pages, "TodayPage") },
    { path: "plan", ...page(pages, "PlanPage") },
    { path: "recipes", ...page(pages, "RecipesPage") },
    { path: "pantry", ...page(pages, "PantryPage") },
    { path: "shop", ...page(pages, "ShopPage") },
    { path: "reports", ...page(pages, "ReportsPage") },
    { path: "alerts", ...page(pages, "AlertsPage") },
    { path: "settings", ...page(pages, "SettingsPage") },
    { path: "*", Component: NotFound },
  ];
}

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: Root,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      { path: "m", Component: MobileShell, children: sections() },
      { Component: DesktopShell, children: sections() },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
