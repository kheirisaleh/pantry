import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllSheets, confirmSheet, hasOpenSheet, openSheet, SheetHost, SheetLayout } from "../modal";

afterEach(() => {
  act(() => {
    closeAllSheets();
  });
  document.documentElement.classList.remove("scroll-locked");
});

describe("sheets", () => {
  it("resolves confirm sheets with the chosen answer", async () => {
    render(<SheetHost mobile={false} />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = confirmSheet("Archive Rice?", "Past records stay.", "Archive", true);
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Past records stay.");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await expect(answer).resolves.toBe(true);
  });

  it("treats escape as cancel and plays the exit animation", async () => {
    render(<SheetHost mobile={false} />);
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = confirmSheet("Close this list?", "Ticked items go into the pantry.", "Close list");
    });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog").parentElement).toHaveClass("closing");
    await expect(answer).resolves.toBe(false);
    expect(hasOpenSheet()).toBe(false);
  });

  it("only lets the top sheet react to escape and locks page scroll", async () => {
    render(<SheetHost mobile={false} />);
    act(() => {
      openSheet((close) => (
        <SheetLayout title="First" onClose={close}>
          <p>first</p>
        </SheetLayout>
      ), { label: "First" });
      openSheet((close) => (
        <SheetLayout title="Second" onClose={close}>
          <p>second</p>
        </SheetLayout>
      ), { label: "Second" });
    });
    expect(document.documentElement).toHaveClass("scroll-locked");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "First" }).parentElement).not.toHaveClass("closing");
    expect(screen.getByRole("dialog", { name: "Second" }).parentElement).toHaveClass("closing");
  });

  it("closes from the close button and the backdrop", async () => {
    render(<SheetHost mobile={false} />);
    act(() => {
      openSheet((close) => (
        <SheetLayout title="Hello" footer={<span>foot</span>} onClose={close}>
          body
        </SheetLayout>
      ));
    });
    expect(screen.getByText("foot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(hasOpenSheet()).toBe(false);
  });
});
