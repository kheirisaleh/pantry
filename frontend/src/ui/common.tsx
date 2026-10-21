import type { CSSProperties, ReactNode } from "react";
import { displayName } from "@/lib/format";
import type { Named } from "@/lib/types";

export function FoodIcon({ name, size, pending = false }: { name: string | null | undefined; size?: "sm" | "lg" | "xl"; pending?: boolean }) {
  return (
    <img
      className={"ico" + (size ? " " + size : "") + (pending ? " pending" : "")}
      src={"/icons/" + (name || "package") + ".svg"}
      alt=""
      loading="lazy"
      onError={(event) => {
        const image = event.currentTarget;
        if (!image.src.endsWith("/icons/package.svg")) image.src = "/icons/package.svg";
      }}
    />
  );
}

export function IngredientIcon({ ingredient, size }: { ingredient: { icon?: string | null; status?: string } | null | undefined; size?: "sm" | "lg" | "xl" }) {
  return <FoodIcon name={ingredient?.icon} {...(size ? { size } : {})} pending={ingredient?.status === "pending"} />;
}

export function Names({ entity, block = false }: { entity: Named; block?: boolean }) {
  const display = displayName(entity);
  return (
    <span className={"names" + (block ? " stack tight" : "")}>
      <span className="en">{display}</span>
      {entity.name_fa && entity.name_fa !== display ? (
        <>
          {" "}
          <span className="fa">({entity.name_fa})</span>
        </>
      ) : null}
    </span>
  );
}

interface PlateProps {
  recipe: { image_path?: string | null } | null | undefined;
  size?: string;
  cooked?: boolean;
  short?: boolean;
}

export function Plate({ recipe, size = "64px", cooked = false, short = false }: PlateProps) {
  return (
    <div className={"plate" + (cooked ? " cooked" : "") + (short ? " short" : "")} style={{ width: size }}>
      {recipe?.image_path ? <img src={recipe.image_path} alt="" loading="lazy" draggable={false} /> : <FoodIcon name="shallow-pan-of-food" />}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle ? <p className="soft lede">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row wrap head-actions">{actions}</div> : null}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {icon ? <FoodIcon name={icon} /> : null}
      {children}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <FoodIcon name="package" />
      <p>{error.message || String(error)}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={"skeleton" + (mobile ? " mobile" : "")} aria-busy="true" aria-label="Loading">
      <i className="sk-title" />
      <div className="sk-row">
        <i />
        <i />
        <i />
      </div>
      <i className="sk-block" />
      <i className="sk-block short" />
    </div>
  );
}

export function Chip({ tone = "", children, title }: { tone?: "" | "good" | "bad" | "warn"; children: ReactNode; title?: string }) {
  return (
    <span className={"chip" + (tone ? " " + tone : "")} title={title}>
      {children}
    </span>
  );
}

export function Avatar({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: color,
    display: "grid",
    placeItems: "center",
    color: "#1a1020",
    fontWeight: 800,
    fontSize: size < 30 ? "12px" : undefined,
  };
  return (
    <span style={style} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}
