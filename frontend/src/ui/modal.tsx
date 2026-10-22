import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createStore, useStore } from "@/lib/store";
import { Icon } from "./icons";

export interface SheetOptions {
  wide?: boolean;
  onClose?: () => void;
  label?: string;
}

interface SheetEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  options: SheetOptions;
  leaving: boolean;
}

export interface SheetHandle {
  close: () => void;
}

const sheets = createStore<SheetEntry[]>([]);
let counter = 0;
let mobileMode = false;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function closeSheet(id: number): void {
  const entry = sheets.get().find((item) => item.id === id);
  if (!entry || entry.leaving) return;
  sheets.set((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
  window.setTimeout(
    () => {
      sheets.set((list) => list.filter((item) => item.id !== id));
      entry.options.onClose?.();
    },
    reducedMotion() ? 0 : 200,
  );
}

export function openSheet(render: (close: () => void) => ReactNode, options: SheetOptions = {}): SheetHandle {
  counter += 1;
  const id = counter;
  sheets.set((list) => [...list, { id, render, options, leaving: false }]);
  return {
    close: () => {
      closeSheet(id);
    },
  };
}

export function closeAllSheets(): void {
  sheets.set([]);
}

export function hasOpenSheet(): boolean {
  return sheets.get().some((item) => !item.leaving);
}

export function useSheetOpen(): boolean {
  return useStore(sheets).some((item) => !item.leaving);
}

interface LayoutProps {
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function SheetLayout({ title, subtitle, footer, onClose, children }: LayoutProps) {
  return (
    <>
      <header>
        <div className="grow">
          {typeof title === "string" ? <h3>{title}</h3> : title}
          {subtitle ? <div className="muted">{subtitle}</div> : null}
        </div>
        <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="body">{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </>
  );
}

interface ConfirmProps {
  title: string;
  message: string;
  action: string;
  danger: boolean;
  onAnswer: (value: boolean) => void;
}

function ConfirmBody({ title, message, action, danger, onAnswer }: ConfirmProps) {
  return (
    <SheetLayout
      title={title}
      onClose={() => onAnswer(false)}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className={"btn " + (danger ? "danger" : "primary")} data-autofocus onClick={() => onAnswer(true)}>
            {action}
          </button>
        </>
      }
    >
      <p className="soft">{message}</p>
    </SheetLayout>
  );
}

export function confirmSheet(title: string, message: string, action: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const handle = openSheet(
      () => (
        <ConfirmBody
          title={title}
          message={message}
          action={action}
          danger={danger}
          onAnswer={(value) => {
            answered = true;
            resolve(value);
            handle.close();
          }}
        />
      ),
      {
        onClose: () => {
          if (!answered) resolve(false);
        },
      },
    );
  });
}

let locks = 0;
let lockedScroll = 0;

function lockScroll(): void {
  locks += 1;
  if (locks > 1) return;
  lockedScroll = window.scrollY;
  document.documentElement.classList.add("scroll-locked");
  if (mobileMode) document.body.style.top = String(-lockedScroll) + "px";
}

function unlockScroll(): void {
  locks = Math.max(0, locks - 1);
  if (locks) return;
  document.documentElement.classList.remove("scroll-locked");
  if (mobileMode) {
    document.body.style.top = "";
    window.scrollTo(0, lockedScroll);
  }
}

function useSwipeToClose(sheet: RefObject<HTMLDivElement | null>, close: () => void, enabled: boolean) {
  useEffect(() => {
    const element = sheet.current;
    const handle = element?.querySelector("header");
    if (!enabled || !element || !handle) return;
    let startY: number | null = null;
    let delta = 0;
    const onStart = (event: TouchEvent) => {
      startY = event.touches[0]?.clientY ?? null;
      delta = 0;
      element.style.transition = "none";
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      delta = Math.max(0, (event.touches[0]?.clientY ?? startY) - startY);
      element.style.transform = "translateY(" + String(delta) + "px)";
    };
    const onEnd = () => {
      element.style.transition = "";
      if (delta > 110) {
        element.style.transform = "translateY(100%)";
        close();
      } else element.style.transform = "";
      startY = null;
    };
    handle.addEventListener("touchstart", onStart, { passive: true });
    handle.addEventListener("touchmove", onMove, { passive: true });
    handle.addEventListener("touchend", onEnd);
    return () => {
      handle.removeEventListener("touchstart", onStart);
      handle.removeEventListener("touchmove", onMove);
      handle.removeEventListener("touchend", onEnd);
    };
  }, [sheet, close, enabled]);
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
    (element) => !element.hasAttribute("disabled") && element.offsetParent !== null,
  );
}

function SheetFrame({ entry, top, mobile }: { entry: SheetEntry; top: boolean; mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [previous] = useState<Element | null>(() => document.activeElement);
  const [close] = useState(() => () => {
    closeSheet(entry.id);
  });

  useLayoutEffect(() => {
    lockScroll();
    return unlockScroll;
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const timer = window.setTimeout(() => {
      const explicit = element.querySelector<HTMLElement>("[data-autofocus]");
      const field = mobile ? null : element.querySelector<HTMLElement>("input, select, textarea");
      (explicit ?? field ?? element.querySelector<HTMLElement>("header button"))?.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.clearTimeout(timer);
      if (!mobile && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [previous, mobile]);

  useEffect(() => {
    if (!top) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSheet(entry.id);
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = focusables(ref.current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [top, entry.id]);

  useSwipeToClose(ref, close, mobile);

  return (
    <div
      className={"overlay" + (entry.leaving ? " closing" : "")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={ref} className={"sheet" + (entry.options.wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={entry.options.label}>
        {entry.render(close)}
      </div>
    </div>
  );
}

export function SheetHost({ mobile }: { mobile: boolean }) {
  const list = useStore(sheets);
  useLayoutEffect(() => {
    mobileMode = mobile;
  }, [mobile]);
  useEffect(() => closeAllSheets, []);
  const lastOpen = [...list].reverse().find((item) => !item.leaving);
  return (
    <div id="sheet-root">
      {list.map((entry) => (
        <SheetFrame key={entry.id} entry={entry} top={entry === lastOpen} mobile={mobile} />
      ))}
    </div>
  );
}
