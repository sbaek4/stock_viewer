import request from "supertest";
import { describe, expect, it } from "vitest";
import { createStockServer } from "../src/server";

describe("backend api", () => {
  const config = {
    FRONTEND_ORIGIN: "http://localhost:5173",
    FINNHUB_API_KEY: "",
    FINNHUB_WEBHOOK_SECRET: "test-secret",
  };

  it("returns health status", async () => {
    const { app } = createStockServer(config);

    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.webhookReceiver).toBe("configured");
  });

  it("returns realtime compare payload", async () => {
    const { app } = createStockServer(config);
    const response = await request(app).get("/api/realtime/compare");

    expect(response.status).toBe(200);
    expect(response.body.websocket.enabled).toBe(false);
    expect(response.body.webhook.enabled).toBe(true);
    expect(Array.isArray(response.body.websocket.bestFor)).toBe(true);
  });

  it("rejects webhook requests with invalid secret", async () => {
    const { app } = createStockServer(config);
    const response = await request(app)
      .post("/api/webhooks/finnhub")
      .set("X-Finnhub-Secret", "wrong-secret")
      .send({ type: "trade" });

    expect(response.status).toBe(401);
  });

  it("accepts valid webhook and stores event", async () => {
    const { app } = createStockServer(config);

    const ack = await request(app)
      .post("/api/webhooks/finnhub")
      .set("X-Finnhub-Secret", "test-secret")
      .send({ eventType: "news", symbol: "AAPL" });

    expect(ack.status).toBe(202);

    const events = await request(app).get("/api/webhooks/events");
    expect(events.status).toBe(200);
    expect(events.body.events.length).toBeGreaterThan(0);
    expect(events.body.events[0].source).toBe("finnhub-webhook");
  });
});
