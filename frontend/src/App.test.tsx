import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => {
  const socketHandlers = new Map<string, (payload: unknown) => void>();
  const mockSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      socketHandlers.set(event, handler);
    }),
    off: vi.fn((event: string) => {
      socketHandlers.delete(event);
    }),
  };
  const mockGet = vi.fn((url: string) => {
    if (url.includes("/api/health")) {
      return Promise.resolve({ data: { realtimeProvider: "disabled" } });
    }
    if (url.includes("/api/orderbook/")) {
      return Promise.resolve({
        data: { bid: 100, ask: 101, bidVolume: 10, askVolume: 12, time: 1 },
      });
    }
    if (url.includes("/api/quote/")) {
      return Promise.resolve({ data: { price: 100, time: 1 } });
    }
    if (url.includes("/api/webhooks/events")) {
      return Promise.resolve({ data: { events: [] } });
    }
    return Promise.resolve({ data: { symbol: "AAPL", data: [] } });
  });
  return { mockSocket, mockGet };
});

vi.mock("socket.io-client", () => ({
  io: () => mocks.mockSocket,
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.mockGet,
  },
}));

describe("App", () => {
  it("renders dashboard title", async () => {
    render(<App />);
    expect(await screen.findByText("Realtime market tracker")).toBeInTheDocument();
  });

  it("allows indicator dropdown add/remove", async () => {
    render(<App />);
    const removeRsiButton = await screen.findByRole("button", { name: "RSI ×" });
    fireEvent.click(removeRsiButton);
    expect(screen.queryByRole("button", { name: "RSI ×" })).not.toBeInTheDocument();

    const select = await screen.findByLabelText("Indicator");
    fireEvent.change(select, { target: { value: "rsi" } });
    expect(await screen.findByRole("button", { name: "RSI ×" })).toBeInTheDocument();
  });

  it("shows webhook news feed empty state", async () => {
    render(<App />);
    expect(
      await screen.findByText("Webhook News Feed (Finnhub)")
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "아직 webhook 뉴스가 없습니다. Finnhub에서 webhook 이벤트가 전송되면 여기에 표시됩니다."
      )
    ).toBeInTheDocument();
  });
});
