import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import WebSocket from "ws";
import yahooFinance from "yahoo-finance2";
import { MACD, RSI } from "technicalindicators";
const yf = new yahooFinance();

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ServerConfig = {
  FRONTEND_ORIGIN: string;
  FINNHUB_API_KEY: string;
  FINNHUB_WEBHOOK_SECRET: string;
};

const SUPPORTED_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y"] as const;
const SUPPORTED_INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1d"] as const;
type SupportedRange = (typeof SUPPORTED_RANGES)[number];
type SupportedInterval = (typeof SUPPORTED_INTERVALS)[number];

const RANGE_TO_DAYS: Record<SupportedRange, number> = {
  "1d": 1,
  "5d": 5,
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  "1y": 365,
};

type WebhookEvent = {
  id: string;
  receivedAt: number;
  source: string;
  payload: unknown;
  tick?: {
    symbol: string;
    price: number;
    volume: number;
    time: number;
  };
};

function toCandle(raw: any): Candle[] {
  const quote = raw?.quotes ?? [];
  return quote
    .filter((item: any) => item.open && item.high && item.low && item.close)
    .map((item: any) => ({
      time: Math.floor(new Date(item.date).getTime() / 1000),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Number(item.volume ?? 0),
    }));
}

function withIndicators(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const rsiPeriod = 14;
  const rsiValues = RSI.calculate({ period: rsiPeriod, values: closes });
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  return candles.map((candle, index) => {
    const rsiIndex = index - (rsiPeriod - 1);
    const macdIndex = index - (26 - 1);
    const rsiPoint = rsiIndex >= 0 ? rsiValues[rsiIndex] : undefined;
    const macdPoint = macdIndex >= 0 ? macdValues[macdIndex] : undefined;
    return {
      ...candle,
      volume: volumes[index],
      rsi: rsiPoint !== undefined ? Number(rsiPoint.toFixed(2)) : null,
      macd:
        macdPoint?.MACD !== undefined ? Number(macdPoint.MACD.toFixed(4)) : null,
      signal:
        macdPoint?.signal !== undefined
          ? Number(macdPoint.signal.toFixed(4))
          : null,
      histogram:
        macdPoint?.histogram !== undefined
          ? Number(macdPoint.histogram.toFixed(4))
          : null,
    };
  });
}

async function getHistory(
  symbol: string,
  range: SupportedRange = "5d",
  interval: SupportedInterval = "5m"
) {
  const period2 = new Date();
  const period1 = new Date(
    period2.getTime() - RANGE_TO_DAYS[range] * 24 * 60 * 60 * 1000
  );
  const result = await (yf as any).chart(symbol, { period1, period2, interval });
  return withIndicators(toCandle(result));
}

function toSupportedRange(value: string): SupportedRange {
  if ((SUPPORTED_RANGES as readonly string[]).includes(value)) {
    return value as SupportedRange;
  }
  return "5d";
}

function toSupportedInterval(value: string): SupportedInterval {
  if ((SUPPORTED_INTERVALS as readonly string[]).includes(value)) {
    return value as SupportedInterval;
  }
  return "5m";
}

export function createStockServer({
  FRONTEND_ORIGIN,
  FINNHUB_API_KEY,
  FINNHUB_WEBHOOK_SECRET,
}: ServerConfig) {
  const app = express();
  app.use(cors({ origin: FRONTEND_ORIGIN }));
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: FRONTEND_ORIGIN } });

  const symbolSubscribers = new Map<string, number>();
  let finnhubWs: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const webhookEvents: WebhookEvent[] = [];
  let lastWebhookAt: number | null = null;

  function trimWebhookEvents() {
    if (webhookEvents.length > 50) {
      webhookEvents.splice(50);
    }
  }

  function verifyWebhookSecret(secret: string | undefined) {
    if (!FINNHUB_WEBHOOK_SECRET) return true;
    return secret === FINNHUB_WEBHOOK_SECRET;
  }

  function extractTick(payload: any): WebhookEvent["tick"] | undefined {
    if (!payload || typeof payload !== "object") return undefined;

    if (
      typeof payload.symbol === "string" &&
      typeof payload.price === "number" &&
      typeof payload.time === "number"
    ) {
      return {
        symbol: payload.symbol.toUpperCase(),
        price: payload.price,
        volume: Number(payload.volume ?? 0),
        time: payload.time,
      };
    }

    const firstTrade = Array.isArray(payload.data) ? payload.data[0] : undefined;
    if (
      firstTrade &&
      typeof firstTrade.s === "string" &&
      typeof firstTrade.p === "number"
    ) {
      return {
        symbol: firstTrade.s.toUpperCase(),
        price: firstTrade.p,
        volume: Number(firstTrade.v ?? 0),
        time: Math.floor((firstTrade.t ?? Date.now()) / 1000),
      };
    }

    return undefined;
  }

  function ensureFinnhubConnection() {
    if (!FINNHUB_API_KEY) return;
    if (finnhubWs && finnhubWs.readyState === WebSocket.OPEN) return;

    finnhubWs = new WebSocket(
      `wss://ws.finnhub.io?token=${encodeURIComponent(FINNHUB_API_KEY)}`
    );

    finnhubWs.on("open", () => {
      for (const symbol of symbolSubscribers.keys()) {
        finnhubWs?.send(JSON.stringify({ type: "subscribe", symbol }));
      }
    });

    finnhubWs.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload.type !== "trade" || !Array.isArray(payload.data)) return;
        for (const trade of payload.data) {
          io.to(trade.s).emit("tick", {
            symbol: trade.s,
            price: trade.p,
            volume: trade.v,
            time: Math.floor(trade.t / 1000),
          });
        }
      } catch {
        // ignore malformed payloads
      }
    });

    finnhubWs.on("close", () => {
      finnhubWs = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(ensureFinnhubConnection, 3000);
    });

    // Prevent process crash when websocket auth/token fails.
    finnhubWs.on("error", (error) => {
      console.error("Finnhub websocket error:", (error as Error).message);
    });
  }

  function subscribeSymbol(symbol: string) {
    const upper = symbol.toUpperCase();
    const count = symbolSubscribers.get(upper) ?? 0;
    symbolSubscribers.set(upper, count + 1);

    if (FINNHUB_API_KEY) {
      ensureFinnhubConnection();
      if (finnhubWs?.readyState === WebSocket.OPEN && count === 0) {
        finnhubWs.send(JSON.stringify({ type: "subscribe", symbol: upper }));
      }
    }
  }

  function unsubscribeSymbol(symbol: string) {
    const upper = symbol.toUpperCase();
    const count = symbolSubscribers.get(upper) ?? 0;
    if (count <= 1) {
      symbolSubscribers.delete(upper);
      if (finnhubWs?.readyState === WebSocket.OPEN) {
        finnhubWs.send(JSON.stringify({ type: "unsubscribe", symbol: upper }));
      }
      return;
    }
    symbolSubscribers.set(upper, count - 1);
  }

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      realtimeProvider: FINNHUB_API_KEY ? "finnhub-websocket" : "disabled",
      webhookReceiver: FINNHUB_WEBHOOK_SECRET ? "configured" : "not-configured",
    });
  });

  app.get("/api/realtime/compare", (_req, res) => {
    res.json({
      websocket: {
        enabled: Boolean(FINNHUB_API_KEY),
        transport: "finnhub websocket + api key",
        bestFor: ["high-frequency tick stream", "chart updates in near real-time"],
      },
      webhook: {
        enabled: Boolean(FINNHUB_WEBHOOK_SECRET),
        transport: "incoming HTTP event callback",
        bestFor: ["server-side event trigger", "alerts/automation pipelines"],
      },
      recentWebhookCount: webhookEvents.length,
      lastWebhookAt,
    });
  });

  app.get("/api/history/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const range = toSupportedRange(String(req.query.range ?? "5d"));
      const interval = toSupportedInterval(String(req.query.interval ?? "5m"));
      const data = await getHistory(symbol, range, interval);
      res.json({ symbol, data });
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch historical data",
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();

      if (FINNHUB_API_KEY) {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
          symbol
        )}&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
        const response = await fetch(url);
        if (!response.ok) {
          return res.status(502).json({ message: "Failed to fetch Finnhub quote" });
        }
        const data = (await response.json()) as { c?: number; t?: number };
        return res.json({
          symbol,
          price: Number(data.c ?? 0),
          time: Number(data.t ?? Math.floor(Date.now() / 1000)),
          source: "finnhub-quote",
        });
      }

      const fallback = await (yf as any).chart(symbol, {
        period1: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: "1m",
      });
      const candles = toCandle(fallback);
      const latest = candles[candles.length - 1];
      if (!latest) {
        return res.status(404).json({ message: "No quote data available" });
      }
      return res.json({
        symbol,
        price: latest.close,
        time: latest.time,
        source: "yahoo-quote-fallback",
      });
    } catch (error) {
      return res.status(500).json({
        message: "Failed to fetch realtime quote",
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/orderbook/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      if (!FINNHUB_API_KEY) {
        return res.status(400).json({
          message: "Orderbook endpoint requires FINNHUB_API_KEY",
        });
      }
      const url = `https://finnhub.io/api/v1/stock/bidask?symbol=${encodeURIComponent(
        symbol
      )}&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).json({ message: "Failed to fetch orderbook" });
      }
      const data = (await response.json()) as {
        a?: number;
        b?: number;
        av?: number;
        bv?: number;
        t?: number;
      };
      return res.json({
        symbol,
        ask: Number(data.a ?? 0),
        bid: Number(data.b ?? 0),
        askVolume: Number(data.av ?? 0),
        bidVolume: Number(data.bv ?? 0),
        time: Number(data.t ?? Math.floor(Date.now() / 1000)),
      });
    } catch (error) {
      return res.status(500).json({
        message: "Failed to fetch orderbook",
        error: (error as Error).message,
      });
    }
  });

  app.post("/api/webhooks/finnhub", (req, res) => {
    const secret = String(req.headers["x-finnhub-secret"] ?? "");
    if (!verifyWebhookSecret(secret)) {
      return res.status(401).json({ message: "Invalid webhook secret" });
    }

    // Finnhub expects fast 2xx acknowledgement to keep endpoint healthy.
    res.status(202).json({ ok: true, accepted: true });

    const event: WebhookEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      receivedAt: Date.now(),
      source: "finnhub-webhook",
      payload: req.body,
      tick: extractTick(req.body),
    };
    setImmediate(() => {
      webhookEvents.unshift(event);
      trimWebhookEvents();
      lastWebhookAt = event.receivedAt;
      io.emit("webhook-event", event);
    });
    return;
  });

  app.post("/api/webhooks/finnhub/test", (req, res) => {
    const secret = String(req.query.secret ?? req.headers["x-webhook-secret"] ?? "");
    if (!verifyWebhookSecret(secret)) {
      return res.status(401).json({ message: "Invalid webhook secret" });
    }
    const event: WebhookEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      receivedAt: Date.now(),
      source: "local-test-webhook",
      payload: {
        symbol: req.body?.symbol ?? "AAPL",
        price: Number(req.body?.price ?? (270 + Math.random() * 5).toFixed(2)),
        time: Math.floor(Date.now() / 1000),
        volume: Number(req.body?.volume ?? Math.floor(Math.random() * 5000)),
        message: "Simulated webhook event",
        ...req.body,
      },
    };
    event.tick = extractTick(event.payload);
    webhookEvents.unshift(event);
    trimWebhookEvents();
    lastWebhookAt = event.receivedAt;
    io.emit("webhook-event", event);
    return res.json({ ok: true, event });
  });

  app.get("/api/webhooks/events", (_req, res) => {
    res.json({ events: webhookEvents });
  });

  io.on("connection", (socket) => {
    let activeSymbol = "";

    socket.on("watch", (symbol: string) => {
      const normalized = (symbol ?? "").toUpperCase();
      if (!normalized) return;

      if (activeSymbol) {
        socket.leave(activeSymbol);
        unsubscribeSymbol(activeSymbol);
      }
      activeSymbol = normalized;
      socket.join(activeSymbol);
      subscribeSymbol(activeSymbol);
    });

    socket.on("disconnect", () => {
      if (activeSymbol) unsubscribeSymbol(activeSymbol);
    });
  });

  return { app, httpServer };
}
