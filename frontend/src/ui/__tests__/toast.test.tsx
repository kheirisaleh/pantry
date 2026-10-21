import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToasts, errorToast, toast, ToastHost } from "../toast";

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    clearToasts();
  });
});

describe("toasts", () => {
  it("shows messages and removes them after a while", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      toast("Saved");
      errorToast(new Error("Price cannot be negative"));
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Price cannot be negative")).toHaveClass("bad");
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    expect(screen.getByText("Saved")).toHaveClass("leaving");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Price cannot be negative")).not.toBeInTheDocument();
  });
});
