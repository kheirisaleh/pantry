import { useState } from "react";
import { useMobile } from "@/app/mobile";
import { View } from "@/app/View";
import { changed } from "@/features/changed";
import { openImageChooser } from "@/features/imageChooser";
import { openRecipeEditor } from "@/features/recipeEditor";
import { get } from "@/lib/api";
import { act } from "@/lib/offline";
import type { Recipe } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, IngredientIcon, PageHead, Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { confirmSheet } from "@/ui/modal";

let rememberedQuery = "";

export function matchesRecipe(recipe: Recipe, text: string): boolean {
  const query = text.toLowerCase();
  return !query || [recipe.display, recipe.name_fa ?? "", recipe.raw_name, ...recipe.tags].join(" ").toLowerCase().includes(query);
}

function DishCard({ recipe, mobile }: { recipe: Recipe; mobile: boolean }) {
  const kcal = recipe.nutrition_per_person.kcal;
  return (
    <article className="dish">
      <button
        type="button"
        className="dish-plate"
        aria-label={"Photo for " + recipe.display}
        onClick={() => (recipe.image_candidates.length || recipe.image_status === "searching" ? openImageChooser(recipe) : openRecipeEditor(recipe))}
      >
        <Plate recipe={recipe} size={mobile ? "88px" : "104px"} />
        {recipe.image_status === "choosing" ? <span className="chip warn dish-badge">pick a photo</span> : null}
      </button>
      <div className="dish-body">
        <h3>{recipe.display}</h3>
        {recipe.name_fa ? <div className="fa">{recipe.name_fa}</div> : null}
        {recipe.status === "pending" ? (
          <div className="muted" style={{ fontSize: "var(--s-1)" }}>
            Name, photo and details on the way
          </div>
        ) : null}
        <div className="row wrap" style={{ gap: "6px", marginTop: "8px" }}>
          {recipe.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
          {kcal ? <span className="chip">{String(Math.round(kcal)) + " kcal each" + (recipe.nutrition_complete ? "" : " approx")}</span> : null}
        </div>
        <div className="dish-ingredients">
          {recipe.slots.map((slot) => {
            const main = slot.items.find((item) => item.is_default) ?? slot.items[0];
            if (!main) return null;
            return (
              <span key={slot.slot} className={"ing-pill" + (main.optional ? " optional" : "")} title={slot.items.map((item) => item.ingredient.display).join(" or ")}>
                <IngredientIcon ingredient={main.ingredient} size="sm" />
                {main.ingredient.display}
                {slot.items.length > 1 ? " +" + String(slot.items.length - 1) : ""}
              </span>
            );
          })}
        </div>
        <div className="row wrap dish-actions" style={{ marginTop: "auto", paddingTop: "10px" }}>
          <button type="button" className="btn small" onClick={() => openRecipeEditor(recipe)}>
            <Icon name="edit" />
            Edit
          </button>
          <button type="button" className="btn small ghost" onClick={() => openImageChooser(recipe)}>
            <Icon name="image" />
            Photo
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              void confirmSheet("Archive " + recipe.display + "?", "It stops showing up in suggestions. Future planned meals with it are removed.", "Archive", true).then(async (ok) => {
                if (!ok) return;
                await act("POST", "/api/recipes/" + String(recipe.id) + "/archive", { archived: true });
                changed();
              });
            }}
          >
            Archive
          </button>
        </div>
      </div>
    </article>
  );
}

export function RecipesPage() {
  const mobile = useMobile();
  const [text, setText] = useState(rememberedQuery);
  const data = useResource((signal) => get<Recipe[]>("/api/recipes", { signal }), [], ["recipes", "plan"]);
  return (
    <View route="recipes" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => {
        const recipes = data.data!;
        const shown = recipes.filter((recipe) => matchesRecipe(recipe, text));
        return (
          <>
            <PageHead
              title="Dishes"
              subtitle={String(recipes.length) + " dish" + (recipes.length === 1 ? "" : "es") + ". Each one stores what a single person needs."}
              actions={
                <>
                  <input
                    className="input"
                    placeholder="Find a dish"
                    aria-label="Find a dish"
                    style={{ maxWidth: "280px" }}
                    value={text}
                    onChange={(event) => {
                      rememberedQuery = event.target.value;
                      setText(event.target.value);
                    }}
                  />
                  <button type="button" className="btn primary" onClick={() => openRecipeEditor(null)}>
                    <Icon name="plus" />
                    New dish
                  </button>
                </>
              }
            />
            <div className="dish-grid">
              {!recipes.length ? (
                <Empty icon="cooking">
                  <p>Add the dishes you cook at home. Type the name the way you say it.</p>
                  <button type="button" className="btn primary" onClick={() => openRecipeEditor(null)}>
                    Add a dish
                  </button>
                </Empty>
              ) : (
                shown.map((recipe) => <DishCard key={recipe.id} recipe={recipe} mobile={mobile} />)
              )}
            </div>
          </>
        );
      }}
    </View>
  );
}
