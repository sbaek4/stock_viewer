import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io, Socket } from "socket.io-client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

type DataPoint = {
  time: number;
  close: number;
  volume: number;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  sma20?: number | null;
  sma50?: number | null;
  bbUpper?: number | null;
  bbLower?: number | null;
};
type IndicatorKey = "volume" | "rsi" | "macd" | "sma20" | "sma50" | "bollinger";

type WebhookEvent = {
  id: string;
  receivedAt: number;
  source: string;
  payload: unknown;
};

type NewsEvent = {
  id: string;
  receivedAt: number;
  source: string;
  headline: string;
  summary: string;
  related: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const RANGE_OPTIONS = ["1d", "5d", "1mo", "3mo", "1y"] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];
const RANGE_LABELS: Record<RangeOption, string> = {
  "1d": "1D",
  "5d": "1W",
  "1mo": "1M",
  "3mo": "3M",
  "1y": "1Y",
};
const INTERVAL_BY_RANGE: Record<RangeOption, string> = {
  "1d": "5m",
  "5d": "5m",
  "1mo": "15m",
  "3mo": "60m",
  "1y": "1d",
};

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatXAxisByRange(unix: number, range: RangeOption) {
  const date = new Date(unix * 1000);
  if (range === "1d") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "5d") return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  if (range === "1mo" || range === "3mo") return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleDateString([], { year: "2-digit", month: "short" });
}

function toNewsEvent(event: WebhookEvent): NewsEvent {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return {
    id: event.id,
    receivedAt: event.receivedAt,
    source: event.source,
    headline: String(payload.headline ?? payload.title ?? "Webhook News Event"),
    summary: String(payload.summary ?? payload.description ?? payload.message ?? "No summary provided."),
    related: String(payload.related ?? payload.symbol ?? payload.category ?? "-"),
  };
}

function pickLatestTradingDay(data: DataPoint[]) {
  if (data.length === 0) return [];
  const sorted = [...data].sort((a, b) => a.time - b.time);
  const latestDay = new Date(sorted[sorted.length - 1].time * 1000).toISOString().slice(0, 10);
  return sorted.filter((d) => new Date(d.time * 1000).toISOString().slice(0, 10) === latestDay);
}

function getPriceDomain(data: DataPoint[]) {
  if (data.length === 0) return [0, 1] as const;
  const min = Math.min(...data.map((d) => d.close));
  const max = Math.max(...data.map((d) => d.close));
  const margin = Math.max(0.5, (max - min) * 0.12);
  return [min - margin, max + margin] as const;
}

function enrichIndicators(data: DataPoint[]) {
  return data.map((point, idx, arr) => {
    const window20 = arr.slice(Math.max(0, idx - 19), idx + 1).map((d) => d.close);
    const window50 = arr.slice(Math.max(0, idx - 49), idx + 1).map((d) => d.close);
    const sma20 = window20.length === 20 ? window20.reduce((s, v) => s + v, 0) / 20 : null;
    const sma50 = window50.length === 50 ? window50.reduce((s, v) => s + v, 0) / 50 : null;
    let bbUpper: number | null = null;
    let bbLower: number | null = null;
    if (window20.length === 20 && sma20 !== null) {
      const variance = window20.reduce((s, v) => s + (v - sma20) ** 2, 0) / window20.length;
      const stdDev = Math.sqrt(variance);
      bbUpper = sma20 + 2 * stdDev;
      bbLower = sma20 - 2 * stdDev;
    }
    return { ...point, sma20, sma50, bbUpper, bbLower };
  });
}

function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [inputSymbol, setInputSymbol] = useState("AAPL");
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorKey[]>([
    "volume",
    "rsi",
    "macd",
    "sma20",
  ]);
  const [error, setError] = useState("");
  const [dataStatus, setDataStatus] = useState("");
  const [range, setRange] = useState<RangeOption>("5d");
  const [newsEvents, setNewsEvents] = useState<NewsEvent[]>([]);
  const [realtimeProvider, setRealtimeProvider] = useState<"finnhub-websocket" | "disabled">("disabled");
  const [orderbook, setOrderbook] = useState<{
    bid: number;
    ask: number;
    bidVolume: number;
    askVolume: number;
    time: number;
  } | null>(null);

  const socket: Socket = useMemo(() => io(API_URL), []);

  useEffect(() => {
    socket.emit("watch", symbol);
    socket.on("webhook-event", (event: WebhookEvent) => {
      setNewsEvents((prev) => [toNewsEvent(event), ...prev].slice(0, 20));
    });
    return () => {
      socket.off("webhook-event");
    };
  }, [socket, symbol]);

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const health = await axios.get<{ realtimeProvider: "finnhub-websocket" | "disabled" }>(
          `${API_URL}/api/health`
        );
        setRealtimeProvider(health.data.realtimeProvider);
      } catch {
        setRealtimeProvider("disabled");
      }
    };
    loadHealth();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        setDataStatus("");
        const interval = INTERVAL_BY_RANGE[range];
        const res = await axios.get<{ symbol: string; data: DataPoint[] }>(
          `${API_URL}/api/history/${symbol}?range=${range}&interval=${interval}`
        );
        let nextData = res.data.data;
        if (range === "1d" && nextData.length === 0) {
          const fallback = await axios.get<{ symbol: string; data: DataPoint[] }>(
            `${API_URL}/api/history/${symbol}?range=5d&interval=5m`
          );
          nextData = pickLatestTradingDay(fallback.data.data);
          if (nextData.length > 0) setDataStatus("1D 실시간 데이터가 비어 최근 거래일 데이터로 표시 중");
        }
        setPoints(nextData);
        if (nextData.length > 0) setLastPrice(nextData[nextData.length - 1].close);
      } catch {
        setError("데이터를 불러오지 못했습니다. 심볼 또는 서버 상태를 확인해주세요.");
      }
    };
    load();
  }, [symbol, range]);

  useEffect(() => {
    const intervalMs = realtimeProvider === "finnhub-websocket" ? 1000 : 5000;
    const poll = async () => {
      try {
        const quote = await axios.get<{ price: number; time: number }>(`${API_URL}/api/quote/${symbol}`);
        if (!quote.data.price || !quote.data.time) return;
        setLastPrice(quote.data.price);
        setPoints((prev) => [
          ...prev.slice(-299),
          {
            time: quote.data.time,
            close: Number(quote.data.price.toFixed(2)),
            volume: 0,
            rsi: null,
            macd: null,
            signal: null,
            histogram: null,
          },
        ]);
      } catch {
        // ignore transient errors
      }
    };
    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
  }, [symbol, realtimeProvider]);

  useEffect(() => {
    const loadWebhookEvents = async () => {
      const eventsRes = await axios.get<{ events: WebhookEvent[] }>(
        `${API_URL}/api/webhooks/events`
      );
      setNewsEvents(eventsRes.data.events.map(toNewsEvent).slice(0, 20));
    };
    loadWebhookEvents().catch(() => undefined);
    const timer = setInterval(() => {
      loadWebhookEvents().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadOrderbook = async () => {
      try {
        const res = await axios.get<{
          bid: number;
          ask: number;
          bidVolume: number;
          askVolume: number;
          time: number;
        }>(`${API_URL}/api/orderbook/${symbol}`);
        setOrderbook(res.data);
      } catch {
        setOrderbook(null);
      }
    };
    loadOrderbook();
    const timer = setInterval(loadOrderbook, 5000);
    return () => clearInterval(timer);
  }, [symbol]);

  const technicalData = enrichIndicators(points);
  const [apiYMin, apiYMax] = getPriceDomain(points);
  const priceDelta =
    points.length > 1 ? (lastPrice ?? points[points.length - 1].close) - points[Math.max(0, points.length - 2)].close : 0;
  const priceDeltaPct =
    points.length > 1 && lastPrice ? (priceDelta / points[Math.max(0, points.length - 2)].close) * 100 : 0;

  const indicatorOptions: { key: IndicatorKey; label: string }[] = [
    { key: "volume", label: "Volume" },
    { key: "rsi", label: "RSI" },
    { key: "macd", label: "MACD" },
    { key: "sma20", label: "SMA20" },
    { key: "sma50", label: "SMA50" },
    { key: "bollinger", label: "Bollinger" },
  ];
  const addableIndicators = indicatorOptions.filter(
    (item) => !activeIndicators.includes(item.key)
  );
  const isActive = (key: IndicatorKey) => activeIndicators.includes(key);

  return (
    <main className="app">
      <header className="hero">
        <p className="eyebrow">Realtime market tracker</p>
        <h1>{symbol}</h1>
        <div className="price-row">
          <strong>{lastPrice ? `$${lastPrice.toFixed(2)}` : "-"}</strong>
          <span className={priceDelta >= 0 ? "up" : "down"}>
            {priceDelta >= 0 ? "+" : ""}
            {priceDelta.toFixed(2)} ({priceDeltaPct.toFixed(2)}%)
          </span>
        </div>
      </header>

      <section className="controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSymbol(inputSymbol.trim().toUpperCase());
          }}
        >
          <input
            value={inputSymbol}
            onChange={(e) => setInputSymbol(e.target.value)}
            placeholder="AAPL, TSLA, NVDA..."
          />
          <button type="submit">Search</button>
        </form>
        <div className="toggles robinhood-toggle">
          <label htmlFor="indicator-select">Indicator</label>
          <select
            id="indicator-select"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value as IndicatorKey | "";
              if (!value) return;
              setActiveIndicators((prev) =>
                prev.includes(value) ? prev : [...prev, value]
              );
              e.target.value = "";
            }}
          >
            <option value="">+ Add indicator</option>
            {addableIndicators.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {dataStatus && <p className="subtle">{dataStatus}</p>}
      <p className="subtle">
        realtime refresh: {realtimeProvider === "finnhub-websocket" ? "every 1s pull (free tier max-safe)" : "every 5s fallback pull"}
      </p>

      <article className="chart-card">
        <div className="chart-header">
          <h2>API Key Realtime Chart</h2>
          <div className="range-pills">
            {RANGE_OPTIONS.map((item) => (
              <button
                key={item}
                type="button"
                className={`pill ${range === item ? "active" : ""}`}
                onClick={() => setRange(item)}
              >
                {RANGE_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points} key={`${symbol}-${range}`}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="2 3" />
            <XAxis
              dataKey="time"
              tickFormatter={(v) => formatXAxisByRange(Number(v), range)}
              minTickGap={24}
            />
            <YAxis domain={[apiYMin, apiYMax]} />
            <Tooltip labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()} />
            <Line dataKey="close" stroke="#18c964" dot={false} strokeWidth={2.5} />
          </LineChart>
        </ResponsiveContainer>
      </article>

      <article className="chart-card">
        <h2>Technical Overlay (toggle on/off)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={technicalData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tickFormatter={(v) => formatXAxisByRange(Number(v), range)} minTickGap={24} />
            <YAxis yAxisId="volume" hide />
            <YAxis yAxisId="rsi" domain={[0, 100]} hide />
            <YAxis yAxisId="macd" hide />
            <YAxis yAxisId="price" hide />
            <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
            {isActive("volume") && (
              <Bar yAxisId="volume" dataKey="volume" fill="#374151" barSize={10} />
            )}
            {isActive("rsi") && <Line yAxisId="rsi" dataKey="rsi" stroke="#16a34a" dot={false} />}
            {isActive("macd") && <Line yAxisId="macd" dataKey="macd" stroke="#9333ea" dot={false} />}
            {isActive("macd") && <Line yAxisId="macd" dataKey="signal" stroke="#f97316" dot={false} />}
            {isActive("sma20") && <Line yAxisId="price" dataKey="sma20" stroke="#f59e0b" dot={false} />}
            {isActive("sma50") && <Line yAxisId="price" dataKey="sma50" stroke="#22d3ee" dot={false} />}
            {isActive("bollinger") && <Line yAxisId="price" dataKey="bbUpper" stroke="#a855f7" dot={false} />}
            {isActive("bollinger") && <Line yAxisId="price" dataKey="bbLower" stroke="#a855f7" dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
        <div className="toggles robinhood-toggle" style={{ marginTop: 12 }}>
          {activeIndicators.length === 0 ? (
            <span className="subtle">추가된 인디케이터가 없습니다.</span>
          ) : (
            activeIndicators.map((key) => {
              const label = indicatorOptions.find((item) => item.key === key)?.label ?? key;
              return (
                <button
                  key={key}
                  type="button"
                  className="pill active"
                  onClick={() =>
                    setActiveIndicators((prev) => prev.filter((item) => item !== key))
                  }
                >
                  {label} ×
                </button>
              );
            })
          )}
        </div>
      </article>

      <article className="chart-card">
        <h2>Orderbook (best bid/ask)</h2>
        {orderbook &&
        Number.isFinite(orderbook.bid) &&
        Number.isFinite(orderbook.ask) &&
        Number.isFinite(orderbook.bidVolume) &&
        Number.isFinite(orderbook.askVolume) ? (
          <div className="events">
            <div className="event-item"><strong>Bid</strong><span>${orderbook.bid.toFixed(2)} ({orderbook.bidVolume})</span></div>
            <div className="event-item"><strong>Ask</strong><span>${orderbook.ask.toFixed(2)} ({orderbook.askVolume})</span></div>
          </div>
        ) : (
          <p className="subtle">FINNHUB API key가 없거나 free tier 권한 범위에서 호가 조회가 제한될 수 있습니다.</p>
        )}
      </article>

      <article className="chart-card">
        <div className="chart-header">
          <h2>Webhook News Feed (Finnhub)</h2>
          <span className="subtle">{newsEvents.length} events</span>
        </div>
        <p className="subtle">
          endpoint: <code>/api/webhooks/finnhub</code> | header:{" "}
          <code>X-Finnhub-Secret</code>
        </p>
        <div className="events">
          {newsEvents.length === 0 ? (
            <p className="subtle">
              아직 webhook 뉴스가 없습니다. Finnhub에서 webhook 이벤트가 전송되면 여기에 표시됩니다.
            </p>
          ) : (
            newsEvents.map((event) => (
              <div className="event-item" key={event.id}>
                <div>
                  <strong>{event.headline}</strong>
                  <p className="event-summary">{event.summary}</p>
                  <span className="event-meta">
                    related: {event.related} | source: {event.source}
                  </span>
                </div>
                <span>{new Date(event.receivedAt).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </article>
    </main>
  );
}

export default App;
