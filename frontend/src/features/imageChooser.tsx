import { get } from "@/lib/api";
import { act } from "@/lib/offline";
import type { Recipe } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { useEffect } from "react";
import { changed } from "./changed";

function ChooserBody({ recipe, close, onDone }: { recipe: Recipe; close: () => void; onDone?: (() => void) | undefined }) {
  const fresh = useResource((signal) => get<Recipe>("/api/recipes/" + String(recipe.id), { signal }), [recipe.id]);
  const current = fresh.data ?? recipe;
  const searching = current.image_status === "searching";
  const { reload, setData } = fresh;

  useEffect(() => {
    if (!searching) return;
    const timer = window.setTimeout(reload, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searching, reload, current]);

  let content;
  if (searching)
    content = (
      <Empty icon="fork-and-knife-with-plate">
        <p>Looking for photos...</p>
      </Empty>
    );
  else if (!current.image_candidates.length)
    content = <Empty>{current.image_path ? "A photo is already chosen. Search again to see other options." : "No photos found yet."}</Empty>;
  else
    content = (
      <div className="image-grid">
        {current.image_candidates.map((candidate, index) => (
          <button
            key={candidate.url}
            type="button"
            aria-label={"Use photo " + String(index + 1) + " from " + candidate.source}
            onClick={() => {
              act("POST", "/api/recipes/" + String(recipe.id) + "/images/choose", { index }).then(
                () => {
                  toast("Photo saved");
                  close();
                  changed();
                  onDone?.();
                },
                () => undefined,
              );
            }}
          >
            <img src={candidate.thumb} alt="" loading="lazy" />
            <small>{candidate.source}</small>
          </button>
        ))}
      </div>
    );

  return (
    <SheetLayout title="Pick a photo" subtitle={recipe.display} onClose={close}>
      <div className="stack">
        {content}
        {!searching ? (
          <div className="row">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                act<Recipe>("POST", "/api/recipes/" + String(recipe.id) + "/images/refresh").then(setData, () => undefined);
              }}
            >
              <Icon name="refresh" />
              Search again
            </button>
          </div>
        ) : null}
      </div>
    </SheetLayout>
  );
}

export function openImageChooser(recipe: Recipe, onDone?: () => void): void {
  openSheet((close) => <ChooserBody recipe={recipe} close={close} onDone={onDone} />, { wide: true, label: "Pick a photo" });
}
