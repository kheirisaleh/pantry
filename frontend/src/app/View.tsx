import { type ReactNode, useEffect, useState } from "react";
import { LoadError, Skeleton } from "@/ui/common";
import { useMobile } from "./mobile";

interface Props {
  route: string;
  ready: boolean;
  error?: Error | null;
  onRetry?: () => void;
  children: () => ReactNode;
}

export function View({ route, ready, error = null, onRetry, children }: Props) {
  const mobile = useMobile();
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    if (!ready || !entering) return;
    const timer = window.setTimeout(() => setEntering(false), 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, entering]);

  let content: ReactNode;
  if (error && !ready) content = <LoadError error={error} {...(onRetry ? { onRetry } : {})} />;
  else if (!ready) content = <Skeleton mobile={mobile} />;
  else content = children();
  return <div className={"view view-" + route + (entering && ready ? " entering" : "")}>{content}</div>;
}
