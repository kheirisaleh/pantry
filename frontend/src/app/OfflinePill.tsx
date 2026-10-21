import { network } from "@/lib/api";
import { pending } from "@/lib/offline";
import { useStore } from "@/lib/store";

export function offlineText(online: boolean, waiting: number): string | null {
  if (online && !waiting) return null;
  const changes = (count: number) => String(count) + " change" + (count === 1 ? "" : "s");
  if (online) return "Syncing " + (waiting === 1 ? "1 saved change" : String(waiting) + " saved changes");
  return "Offline" + (waiting ? ", " + changes(waiting) + " waiting" : "");
}

export function OfflinePill() {
  const { online } = useStore(network);
  const waiting = useStore(pending);
  const text = offlineText(online, waiting);
  if (!text) return null;
  return (
    <div className="offline-pill" role="status">
      {text}
    </div>
  );
}
