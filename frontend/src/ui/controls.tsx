import { type ReactNode, useEffect, useRef, useState } from "react";
import { get, query } from "@/lib/api";
import { BASE_UNITS, qty, RECIPE_UNITS, SHOP_UNITS, UNIT_LABELS } from "@/lib/format";
import type { Ingredient } from "@/lib/types";
import { FoodIcon, IngredientIcon, Names } from "./common";
import { Icon } from "./icons";
import { toast } from "./toast";

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function UnitSelect<T extends string>({ value, onChange, className = "input unit-select" }: SelectProps<T>) {
  return (
    <select className={className} aria-label="Unit" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {RECIPE_UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {UNIT_LABELS[unit]}
        </option>
      ))}
    </select>
  );
}

export function ShopUnitSelect<T extends string>({ value, onChange, className = "input unit-select" }: SelectProps<T>) {
  return (
    <select className={className} aria-label="Unit" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {SHOP_UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {unit}
        </option>
      ))}
    </select>
  );
}

export function UnitToggle<T extends string>({ value, onChange, units = BASE_UNITS as unknown as readonly T[] }: SelectProps<T> & { units?: readonly T[] }) {
  return (
    <div className="unit-toggle" role="group" aria-label="Unit">
      {units.map((unit) => (
        <button key={unit} type="button" aria-pressed={unit === value} onClick={() => onChange(unit)}>
          {unit}
        </button>
      ))}
    </div>
  );
}

export interface Picked {
  ingredient_id?: number;
  ingredient?: Ingredient;
  name: string;
}

interface PickerProps {
  placeholder?: string;
  onPick: (picked: Picked) => void;
  keepText?: boolean;
  autoFocus?: boolean;
}

export function IngredientPicker({ placeholder = "Type any name, in any language", onPick, keepText = false, autoFocus = false }: PickerProps) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Ingredient[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = text.trim();
  const results = trimmed ? found : [];

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      get<Ingredient[]>("/api/ingredients/search" + query({ q: trimmed }), { signal: controller.signal }).then(setFound, () => {
        if (!controller.signal.aborted) setFound([]);
      });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => input.current?.focus(), 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoFocus]);

  function choose(index: number) {
    if (!trimmed) return;
    const entry = results[index];
    onPick(entry ? { ingredient_id: entry.id, ingredient: entry, name: trimmed } : { name: trimmed });
    if (!keepText) setText("");
    setFound([]);
    setOpen(false);
  }

  const options: ReactNode[] = results.map((entry, index) => (
    <button
      key={entry.id}
      type="button"
      role="option"
      aria-selected={index === active}
      onMouseDown={(event) => {
        event.preventDefault();
        choose(index);
      }}
    >
      <IngredientIcon ingredient={entry} size="sm" />
      <span className="grow ellipsis">
        <Names entity={entry} />
      </span>
      {entry.stock ? <span className="muted num">{qty(entry.stock, entry.unit)}</span> : null}
    </button>
  ));

  return (
    <div className="picker">
      <input
        ref={input}
        className="input"
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open && Boolean(trimmed)}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            setActive((value) => Math.min(results.length, value + 1));
            event.preventDefault();
          } else if (event.key === "ArrowUp") {
            setActive((value) => Math.max(0, value - 1));
            event.preventDefault();
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(active);
          } else if (event.key === "Escape" && open && trimmed) {
            setOpen(false);
            event.stopPropagation();
          }
        }}
      />
      {open && trimmed ? (
        <div className="picker-menu" role="listbox">
          {options}
          <button
            type="button"
            role="option"
            aria-selected={active === results.length}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(results.length);
            }}
          >
            <FoodIcon name="package" size="sm" />
            <span className="grow">{"Add “" + trimmed + "” as new"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn small ghost"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast("Copied"),
          () => toast("Copy did not work, select it by hand", true),
        );
      }}
    >
      <Icon name="copy" />
      {label}
    </button>
  );
}

export function CodeLine({ value }: { value: string }) {
  return (
    <div className="code-line">
      <code>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}
