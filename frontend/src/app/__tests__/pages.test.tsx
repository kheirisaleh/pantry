import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { boot } from "@/app/session";
import { routes } from "@/app/router";
import { closeAllSheets } from "@/ui/modal";
import { calls, installFakeApi } from "@/test/fakeApi";

async function open(path: string) {
  window.localStorage.setItem("pantry:user", "1");
  installFakeApi();
  await boot();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  act(() => {
    closeAllSheets();
  });
});

describe("pages", () => {
  it("shows today with the dish carousel, the cycle and the week", async () => {
    await open("/");
    expect(await screen.findByRole("heading", { level: 1, name: /Leila/ })).toBeInTheDocument();
    expect(await screen.findByText("1 dish ready from your pantry")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("Not enough Basmati rice for Adas Polo")).toBeInTheDocument();
    expect(screen.getByText("1 item to buy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Notes/ })).toHaveTextContent("1");
  });

  it("plans by day and opens the meal menu", async () => {
    await open("/plan");
    const meal = await screen.findByRole("button", { name: /Adas Polo/ });
    expect(meal).toHaveAttribute("data-meal-id", "3");
    expect(screen.getByTitle("Added by Alexa")).toBeInTheDocument();
    await userEvent.click(meal);
    const dialog = await screen.findByRole("dialog", { name: "Adas Polo" });
    expect(within(dialog).getByRole("button", { name: "Cook" })).toBeInTheDocument();
  });

  it("lists dishes and filters them", async () => {
    await open("/recipes");
    expect(await screen.findByText("543 kcal each")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Find a dish"), "pizza");
    expect(screen.queryByText("Adas Polo")).not.toBeInTheDocument();
  });

  it("shows the pantry and the shopping list", async () => {
    const router = await open("/pantry");
    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Snacks" }));
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    await act(() => router.navigate("/shop"));
    expect(await screen.findByText("need 160 g")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start shopping" })).toBeInTheDocument();
  });

  it("dismisses notes", async () => {
    await open("/alerts");
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "POST" && call.path === "/api/alerts/5/dismiss")).toBe(true);
    });
  });

  it("renders settings and reports", async () => {
    const router = await open("/settings");
    expect(await screen.findByText("Home Gym")).toBeInTheDocument();
    expect(screen.getByText("Skill ID missing")).toBeInTheDocument();
    await act(() => router.navigate("/reports"));
    expect(await screen.findByText("shopping trips")).toBeInTheDocument();
  });

  it("uses the phone shell under /m", async () => {
    await open("/m/shop");
    expect(await screen.findByRole("navigation", { name: "Sections" })).toHaveClass("tabbar");
    await userEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(await screen.findByRole("link", { name: "Desktop view" })).toBeInTheDocument();
  });

  it("shows a not found page", async () => {
    await open("/somewhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
