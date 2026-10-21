import { useEffect, useLayoutEffect } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { setNotifier } from "@/lib/offline";
import { isMobilePath } from "@/lib/routes";
import { Empty, Skeleton } from "@/ui/common";
import { SheetHost } from "@/ui/modal";
import { toast, ToastHost } from "@/ui/toast";
import { OfflinePill } from "./OfflinePill";
import { useBootState } from "./session";

export function Root() {
  const state = useBootState();
  const location = useLocation();
  const mobile = isMobilePath(location.pathname);

  useLayoutEffect(() => {
    document.body.classList.toggle("mobile", mobile);
  }, [mobile]);

  useEffect(() => {
    setNotifier(toast);
  }, []);

  let content;
  if (state.kind === "ready") content = <Outlet />;
  else if (state.kind === "failed")
    content = (
      <Empty icon="package">
        <p>Pantry could not load: {state.message}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </Empty>
    );
  else content = <Skeleton mobile={mobile} />;

  return (
    <>
      {content}
      <SheetHost mobile={mobile} />
      <ToastHost />
      <OfflinePill />
      <ScrollRestoration getKey={(location) => location.pathname} />
    </>
  );
}
