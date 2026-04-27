import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("socket.io-client", () => ({
  io: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { symbol: "AAPL", data: [] } }),
  },
}));

describe("App", () => {
  it("renders dashboard title", async () => {
    render(<App />);
    expect(await screen.findByText("Realtime market tracker")).toBeInTheDocument();
  });
});
