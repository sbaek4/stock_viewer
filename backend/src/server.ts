import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import WebSocket from "ws";
import yahooFinance from "yahoo-finance2";
import { MACD, RSI } from "technicalindicators";

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
    const macdPoint = macdIndex >= 0 ? macdValues[macdIndex] : undefined;
    return {
      ...candle,
      volume: volumes[index],
      rsi: rsiIndex >= 0 ? Number(rsiValues[rsiIndex].toFixed(2)) : null,
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

async function getHistory(symbol: string, range = "5d", interval = "5m") {
  const result = await yahooFinance.chart(symbol, { range, interval });
  return withIndicators(toCandle(result));
}

export function createStockServer({ FRONTEND_ORIGIN, FINNHUB_API_KEY }: ServerConfig) {
  const app = express();
  app.use(cors({ origin: FRONTEND_ORIGIN }));
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: FRONTEND_ORIGIN } });

  const symbolSubscribers = new Map<string, number>();
  let finnhubWs: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

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
    });
  });

  app.get("/api/history/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const range = String(req.query.range ?? "5d");
      const interval = String(req.query.interval ?? "5m");
      const data = await getHistory(symbol, range, interval);
      res.json({ symbol, data });
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch historical data",
        error: (error as Error).message,
      });
    }
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
