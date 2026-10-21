import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FoodIcon, Names, Plate } from "../common";
import { IngredientPicker, UnitToggle } from "../controls";

describe("controls", () => {
  it("finds known ingredients and offers to add new ones", async () => {
    const found = [{ id: 4, display: "Basmati rice", name_fa: "برنج", icon: "cooked-rice", status: "ready", stock: 1500, unit: "g" }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(found)));
    const onPick = vi.fn();
    render(<IngredientPicker onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "ber");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Basmati rice/ })).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/ingredients/search?q=ber");
    expect(screen.getByText("1.5 kg")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ingredient_id: 4, name: "ber" }));
    expect(input).toHaveValue("");
    await userEvent.type(input, "zereshk");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenLastCalledWith({ name: "zereshk" });
  });

  it("toggles units", async () => {
    const onChange = vi.fn();
    render(<UnitToggle value="g" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "g" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "pcs" }));
    expect(onChange).toHaveBeenCalledWith("pcs");
  });

  it("renders names, plates and icons", () => {
    const { container } = render(
      <>
        <Names entity={{ display: "Rice", name_fa: "برنج" }} />
        <Plate recipe={{ image_path: "/media/recipes/1.jpg" }} cooked />
        <Plate recipe={null} />
        <FoodIcon name={null} />
      </>,
    );
    expect(screen.getByText("(برنج)")).toHaveClass("fa");
    expect(container.querySelector(".plate.cooked img")).toHaveAttribute("src", "/media/recipes/1.jpg");
    expect(container.querySelectorAll('img[src="/icons/shallow-pan-of-food.svg"]')).toHaveLength(1);
    expect(container.querySelector('img[src="/icons/package.svg"]')).toBeInTheDocument();
  });
});
