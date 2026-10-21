import { type CSSProperties, useEffect, useRef, useState } from "react";
import { barLabel, cycleMessage, easeOut, lastCycleText, reelOffset, tierChip, wrapIndex } from "@/lib/kitchen";
import { fromIso, money, shortDate } from "@/lib/format";
import type { CycleStatus, Suggestion, Suggestions, WeekDay, WeekSummary } from "@/lib/types";
import { Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useCountUp(target: number, duration = 900): number {
  const [reduced] = useState(reducedMotion);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * easeOut(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, duration, reduced]);
  return reduced ? target : value;
}

export function StatusChip({ entry }: { entry: Suggestion }) {
  const chip = tierChip(entry);
  return <span className={"chip" + (chip.tone ? " " + chip.tone : "")}>{chip.text}</span>;
}

interface ReelProps {
  suggest: Suggestions;
  cycle: CycleStatus | null;
  mobile: boolean;
  onCook: (entry: Suggestion) => void;
  onChoose: () => void;
  onShop: () => void;
}

export function CookableReel({ suggest, cycle, mobile, onCook, onChoose, onShop }: ReelProps) {
  const ready = suggest.suggestions.filter((entry) => entry.tier === 0);
  const borrowing = suggest.suggestions.filter((entry) => entry.tier === 1);
  const deck = ready.concat(borrowing).slice(0, 12);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion() && deck.length > 1);
  const [held, setHeld] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const startX = useRef<number | null>(null);
  const length = deck.length;

  useEffect(() => {
    if (!playing || held || length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((current) => wrapIndex(current + 1, length));
    }, 3400);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, held, length]);

  if (!deck.length) {
    const empty = cycle?.empty_pantry ?? false;
    return (
      <div className="reel-alarm" role="alert">
        <div className="alarm-cart">
          <Icon name="cart" />
        </div>
        <div className="alarm-copy">
          <div className="eyebrow">{empty ? "The pantry is empty" : "Nothing left to cook"}</div>
          <h2>Time to go shopping</h2>
          <p className="soft">
            {empty
              ? "Log what you have at home or do your next shop, and the dishes you can cook will show up here."
              : "With what is at home right now, no dish in your recipe book can be made. Build a list for the next " + String(cycle?.default_days ?? 14) + " days."}
          </p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={onShop}>
              Open shopping
            </button>
            <button type="button" className="btn" onClick={onChoose}>
              Choose myself
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = Math.min(index, length - 1);
  const stop = () => {
    setPlaying(false);
    setAnnounce(true);
  };
  const go = (target: number) => setIndex(wrapIndex(target, length));
  const size = mobile ? "150px" : "210px";

  return (
    <div
      className={"reel" + (playing && !held ? " is-playing" : "")}
      role="region"
      aria-roledescription="carousel"
      aria-label="Dishes you can cook now"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          stop();
          go(current + 1);
        }
        if (event.key === "ArrowLeft") {
          stop();
          go(current - 1);
        }
      }}
    >
      <div className="reel-head">
        <div>
          <div className="eyebrow">{ready.length ? String(ready.length) + " dish" + (ready.length === 1 ? "" : "es") + " ready from your pantry" : "Possible, but uses food meant for other dishes"}</div>
          <div className="soft" style={{ fontSize: "var(--s-1)" }}>
            Tap a plate to cook it
          </div>
        </div>
        <div className="row">
          <span className="reel-count num">
            {current + 1} / {length}
          </span>
          <button
            type="button"
            className="btn icon small ghost reel-toggle"
            aria-label={playing ? "Stop rotating dishes" : "Start rotating dishes"}
            onClick={() => {
              setAnnounce(playing);
              setPlaying(!playing);
            }}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
        </div>
      </div>
      <div
        className="reel-track"
        onPointerDown={(event) => {
          startX.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (startX.current === null) return;
          const delta = event.clientX - startX.current;
          startX.current = null;
          if (Math.abs(delta) > 40) {
            stop();
            go(current + (delta < 0 ? 1 : -1));
            event.preventDefault();
          }
        }}
      >
        {deck.map((entry, position) => {
          const offset = reelOffset(position, current, length);
          return (
            <button
              key={entry.recipe_id}
              type="button"
              className={"reel-card" + (offset === 0 ? " is-current" : "") + (Math.abs(offset) === 1 ? " is-near" : "")}
              style={{ "--n": position, "--o": offset } as CSSProperties}
              tabIndex={offset === 0 ? 0 : -1}
              aria-hidden={offset !== 0}
              aria-label={"Cook " + entry.name}
              onClick={() => onCook(entry)}
            >
              <div className="reel-halo" />
              <Plate recipe={entry} size={size} />
              <div className="stage-caption">
                <h3>{entry.name}</h3>
                {entry.name_fa ? <div className="fa">{entry.name_fa}</div> : null}
                <div className="row wrap" style={{ justifyContent: "center", marginTop: "8px" }}>
                  <StatusChip entry={entry} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="reel-dots">
        {deck.map((entry, position) => (
          <button
            key={entry.recipe_id}
            type="button"
            className={"reel-dot" + (position === current ? " on" : "")}
            aria-label={"Show " + entry.name}
            onClick={() => {
              stop();
              go(position);
            }}
          >
            <i />
          </button>
        ))}
      </div>
      <div className="sr-only" aria-live={announce ? "polite" : "off"}>
        {deck[current]?.name}
      </div>
      <div className="row reel-actions">
        <button type="button" className="btn primary" onClick={onChoose}>
          Choose myself
        </button>
      </div>
    </div>
  );
}

export function CycleCard({ state }: { state: CycleStatus }) {
  const cycle = state.cycle;
  const radius = 52;
  const length = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(length);
  const days = useCountUp(Math.max(0, cycle?.elapsed_days ?? 0));
  const progress = cycle?.progress ?? 0;

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOffset(length * (1 - progress))));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [length, progress]);

  const message = cycleMessage(state);
  if (!cycle || !message) return null;
  const [title, body] = message;
  const last = lastCycleText(state);
  return (
    <section className={"panel cycle-card state-" + cycle.state}>
      <div className="cycle-ring-wrap">
        <svg viewBox="0 0 120 120" className="cycle-ring" aria-hidden="true">
          <circle cx="60" cy="60" r={radius} className="ring-base" />
          <circle cx="60" cy="60" r={radius} className={"ring-arc " + cycle.state} style={{ strokeDasharray: String(length), strokeDashoffset: String(offset) }} />
        </svg>
        <div className="ring-center">
          <b className="num">{days.toLocaleString("en-GB")}</b>
          <span>of {cycle.planned_days} days</span>
        </div>
      </div>
      <div className="cycle-copy">
        <div className="eyebrow">This shop</div>
        <h3>{title}</h3>
        <p className="soft">{body}</p>
        <div className="cycle-facts">
          <span className="chip">shopped {shortDate(cycle.start)}</span>
          <span className="chip">{state.meals_left >= 120 ? "plenty of meals left" : String(state.meals_left) + " meals left"}</span>
          {cycle.spend ? <span className="chip">{money(cycle.daily_spend)} a day</span> : null}
        </div>
        {last ? (
          <p className="muted" style={{ fontSize: "var(--s-1)", marginTop: "8px" }}>
            {last}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function WeekColumn({ entry, index, max, active, onSelect }: { entry: WeekDay; index: number; max: number; active: boolean; onSelect: () => void }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);
  const eaten = grown ? (entry.eaten_kcal / max) * 100 : 0;
  const planned = grown ? ((entry.eaten_kcal ? 0 : entry.planned_kcal) / max) * 100 : 0;
  return (
    <button
      type="button"
      className={"week-col" + (entry.is_today ? " is-today" : "") + (entry.is_future ? " is-future" : "") + (active ? " active" : "")}
      style={{ "--i": index } as CSSProperties}
      aria-label={fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="bar-value num">{barLabel(entry.eaten_kcal, entry.planned_kcal)}</span>
      <span className="bar-track">
        <i className="bar-planned" style={{ height: String(planned) + "%" }} />
        <i className="bar-eaten" style={{ height: String(eaten) + "%" }} />
      </span>
      <span className="bar-day">{fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
    </button>
  );
}

export function WeekCard({ week }: { week: WeekSummary }) {
  const max = Math.max(1, ...week.days.map((entry) => Math.max(entry.eaten_kcal, entry.planned_kcal)));
  const [selected, setSelected] = useState(() => week.days.findIndex((entry) => entry.is_today));
  const eatenKnown = week.average_kcal > 0;
  const average = useCountUp(eatenKnown ? week.average_kcal : week.average_planned_kcal || 0);
  const entry = week.days[selected];
  return (
    <section className="panel week-card">
      <div className="spread">
        <div>
          <h3>This week</h3>
          <div className="muted" style={{ fontSize: "var(--s-1)" }}>
            Calories per person, eaten and planned
          </div>
        </div>
        <div className="kpi" style={{ alignItems: "flex-end" }}>
          <b className="num">{average.toLocaleString("en-GB")}</b>
          <span>{eatenKnown ? "kcal a day eaten" : "kcal a day planned"}</span>
        </div>
      </div>
      <div className="week-bars">
        {week.days.map((day, index) => (
          <WeekColumn key={day.date} entry={day} index={index} max={max} active={index === selected} onSelect={() => setSelected(index)} />
        ))}
      </div>
      <div className="week-legend">
        <span>
          <i className="swatch eaten" />
          Eaten
        </span>
        <span>
          <i className="swatch planned" />
          Planned
        </span>
      </div>
      {entry ? (
        <div className="week-detail" key={entry.date}>
          <b>{fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</b>
          {entry.eaten_kcal ? (
            <>
              <span>
                {entry.eaten_kcal.toLocaleString("en-GB")} kcal each, {entry.eaten_protein} g protein
              </span>
              <span className="row wrap" style={{ gap: "6px" }}>
                {entry.people.map((person) => (
                  <span key={person.name} className="chip">
                    {person.name} {person.kcal.toLocaleString("en-GB")}
                  </span>
                ))}
              </span>
            </>
          ) : entry.planned_kcal ? (
            <span className="muted">Planned, about {entry.planned_kcal.toLocaleString("en-GB")} kcal each</span>
          ) : (
            <span className="muted">{entry.is_future ? "Nothing planned yet" : "Nothing logged"}</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
