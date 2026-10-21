import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router";
import { isMobilePath } from "@/lib/routes";
import { Empty } from "@/ui/common";

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? String(error.status) + " " + error.statusText : error instanceof Error ? error.message : "Unknown error";
  return (
    <Empty icon="package">
      <h2>Something went wrong</h2>
      <p>{message}</p>
      <button type="button" className="btn primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </Empty>
  );
}

export function NotFound() {
  const location = useLocation();
  return (
    <div className="view">
      <Empty icon="package">
        <h2>Page not found</h2>
        <p className="muted">This page does not exist.</p>
        <Link className="btn primary" to={isMobilePath(location.pathname) ? "/m" : "/"}>
          Back to today
        </Link>
      </Empty>
    </div>
  );
}
