import { useEffect } from "react";
import { createStore, useStore } from "@/lib/store";

interface ToastItem {
  id: number;
  message: string;
  bad: boolean;
  leaving: boolean;
}

const toasts = createStore<ToastItem[]>([]);
let counter = 0;

function dismiss(id: number): void {
  toasts.set((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
  window.setTimeout(() => {
    toasts.set((list) => list.filter((item) => item.id !== id));
  }, 220);
}

export function toast(message: string, bad = false): void {
  counter += 1;
  const id = counter;
  toasts.set((list) => [...list, { id, message, bad, leaving: false }]);
  window.setTimeout(() => {
    dismiss(id);
  }, bad ? 5200 : 2600);
}

export function errorToast(error: unknown): void {
  toast(error instanceof Error ? error.message : String(error), true);
}

export function clearToasts(): void {
  toasts.set([]);
}

export function ToastHost() {
  const list = useStore(toasts);
  useEffect(() => clearToasts, []);
  return (
    <div className="toast-host" aria-live="polite" role="status">
      {list.map((item) => (
        <div key={item.id} className={"toast" + (item.bad ? " bad" : "") + (item.leaving ? " leaving" : "")}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
