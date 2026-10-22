import { type RefObject, useEffect, useRef } from "react";
import type { CalendarDay } from "@/lib/types";

export function moveMeal(days: CalendarDay[], mealId: number, date: string, index: number): CalendarDay[] {
  let moving = null;
  for (const day of days) {
    const found = day.meals.find((meal) => meal.id === mealId);
    if (found) moving = found;
  }
  if (!moving) return days;
  const meal = { ...moving, date };
  return days.map((day) => {
    const rest = day.meals.filter((entry) => entry.id !== mealId);
    if (day.date !== date) return rest.length === day.meals.length ? day : { ...day, meals: rest };
    const position = Math.max(0, Math.min(index, rest.length));
    return { ...day, meals: [...rest.slice(0, position), meal, ...rest.slice(position)] };
  });
}

type DropHandler = (mealId: number, date: string, index: number) => void;

export function useMealDrag(board: RefObject<HTMLElement | null>, onDrop: DropHandler, ready: boolean): void {
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });

  useEffect(() => {
    const root = board.current;
    if (!ready || !root) return;
    const element: HTMLElement = root;
    let suppressClick = false;

    const onClick = (event: MouseEvent) => {
      if (suppressClick) {
        event.stopPropagation();
        event.preventDefault();
        suppressClick = false;
      }
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();
    const onContext = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".meal[data-meal-id]")) event.preventDefault();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".meal[data-meal-id]") : null;
      if (!target || target.classList.contains("cooked") || event.button > 0) return;
      const card: HTMLElement = target;
      const touch = event.pointerType !== "mouse";
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let lastX = startX;
      let lastY = startY;
      let timer = 0;
      let frame = 0;
      let drag: { ghost: HTMLElement; slot: HTMLElement; offsetX: number; offsetY: number; left: number; top: number } | null = null;

      const blockScroll = (touchEvent: TouchEvent) => {
        if (drag) touchEvent.preventDefault();
      };

      function targetList(x: number, y: number): HTMLElement | null {
        if (!drag) return null;
        drag.ghost.style.visibility = "hidden";
        const under = document.elementFromPoint(x, y);
        drag.ghost.style.visibility = "";
        const list = under?.closest<HTMLElement>(".day-meals[data-date]");
        if (list) return list;
        return under?.closest(".day")?.querySelector<HTMLElement>(".day-meals[data-date]") ?? null;
      }

      function move(x: number, y: number) {
        if (!drag) return;
        lastX = x;
        lastY = y;
        drag.ghost.style.transform =
          "translate(" + String(x - drag.offsetX - drag.left) + "px," + String(y - drag.offsetY - drag.top) + "px) rotate(-2deg) scale(1.04)";
        const list = targetList(x, y);
        if (!list) return;
        const cards = [...list.querySelectorAll<HTMLElement>(".meal[data-meal-id]")].filter((entry) => entry !== card);
        const before = cards.find((entry) => {
          const box = entry.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        const anchor = before ?? list.querySelector(".snack-line, .day-add");
        if (anchor) {
          if (drag.slot.nextSibling !== anchor || drag.slot.parentElement !== list) list.insertBefore(drag.slot, anchor);
        } else if (drag.slot.parentElement !== list || drag.slot.nextSibling) list.appendChild(drag.slot);
        const day = list.closest(".day");
        for (const other of element.querySelectorAll(".day.drop-target")) if (other !== day) other.classList.remove("drop-target");
        day?.classList.add("drop-target");
      }

      function autoScroll() {
        if (!drag) return;
        const edge = 90;
        let speed = 0;
        if (lastY < edge) speed = -Math.ceil((edge - lastY) / 6);
        else if (lastY > window.innerHeight - edge - 40) speed = Math.ceil((lastY - (window.innerHeight - edge - 40)) / 6);
        if (speed) {
          window.scrollBy(0, speed);
          move(lastX, lastY);
        }
        frame = requestAnimationFrame(autoScroll);
      }

      function begin() {
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("drag-ghost");
        ghost.removeAttribute("data-meal-id");
        Object.assign(ghost.style, { width: String(rect.width) + "px", height: String(rect.height) + "px", left: String(rect.left) + "px", top: String(rect.top) + "px" });
        document.body.appendChild(ghost);
        const slot = document.createElement("div");
        slot.className = "drop-slot";
        slot.style.height = String(rect.height) + "px";
        card.after(slot);
        card.classList.add("drag-source");
        document.body.classList.add("is-dragging");
        drag = { ghost, slot, offsetX: lastX - rect.left, offsetY: lastY - rect.top, left: rect.left, top: rect.top };
        if ("vibrate" in navigator) navigator.vibrate(12);
        move(lastX, lastY);
        autoScroll();
      }

      function cleanup() {
        window.clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("touchmove", blockScroll);
        document.body.classList.remove("is-dragging");
        for (const other of element.querySelectorAll(".day.drop-target")) other.classList.remove("drop-target");
      }

      function finish(commit: boolean) {
        if (!drag) return;
        const { ghost, slot } = drag;
        const list = slot.parentElement;
        const date = list?.dataset.date;
        const index = list ? [...list.children].filter((entry) => (entry.matches(".meal[data-meal-id]") || entry === slot) && entry !== card).indexOf(slot) : -1;
        const from = card.parentElement?.dataset.date;
        const fromIndex = card.parentElement ? [...card.parentElement.querySelectorAll(".meal[data-meal-id]")].indexOf(card) : -1;
        const target = slot.getBoundingClientRect();
        ghost.classList.add("dropping");
        ghost.style.transform = "translate(" + String(target.left - drag.left) + "px," + String(target.top - drag.top) + "px)";
        const moved = commit && date !== undefined && index >= 0 && !(date === from && index === fromIndex);
        const mealId = Number(card.dataset.mealId);
        drag = null;
        window.setTimeout(() => {
          slot.remove();
          card.classList.remove("drag-source");
          ghost.remove();
          if (moved) handler.current(mealId, date, index);
        }, 220);
      }

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        if (!drag) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (touch) {
            if (distance > 10) cleanup();
            return;
          }
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          if (distance > 6) begin();
          return;
        }
        moveEvent.preventDefault();
        move(moveEvent.clientX, moveEvent.clientY);
      }

      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        const wasDragging = Boolean(drag);
        if (drag) finish(true);
        cleanup();
        if (wasDragging) {
          suppressClick = true;
          window.setTimeout(() => {
            suppressClick = false;
          }, 400);
        }
      }

      function onCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        if (drag) finish(false);
        cleanup();
      }

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", blockScroll, { passive: false });
      if (touch)
        timer = window.setTimeout(() => {
          if (!drag) begin();
        }, 360);
    };

    element.addEventListener("click", onClick, true);
    element.addEventListener("dragstart", onDragStart);
    element.addEventListener("contextmenu", onContext);
    element.addEventListener("pointerdown", onPointerDown);
    return () => {
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("dragstart", onDragStart);
      element.removeEventListener("contextmenu", onContext);
      element.removeEventListener("pointerdown", onPointerDown);
    };
  }, [board, ready]);
}
