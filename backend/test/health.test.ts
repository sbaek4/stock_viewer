import request from "supertest";
import { describe, expect, it } from "vitest";
import { createStockServer } from "../src/server";

describe("GET /api/health", () => {
  it("returns health status", async () => {
    const { app } = createStockServer({
      FRONTEND_ORIGIN: "http://localhost:5173",
      FINNHUB_API_KEY: "",
    });

    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
