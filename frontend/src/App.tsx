import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io, Socket } from "socket.io-client";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
};

type WebhookEvent = {
  id: string;
  receivedAt: number;
  source: string;
  payload: unknown;
};

type CompareResponse = {
  websocket: { enabled: boolean; transport: string; bestFor: string[] };
  webhook: { enabled: boolean; transport: string; bestFor: string[] };
  recentWebhookCount: number;
  lastWebhookAt: number | null;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [inputSymbol, setInputSymbol] = useState("AAPL");
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [error, setError] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);

  const socket: Socket = useMemo(() => io(API_URL), []);

  useEffect(() => {
    socket.emit("watch", symbol);

    socket.on("tick", (tick: { price: number; time: number; volume: number }) => {
      setLastPrice(tick.price);
      setPoints((prev) => {
        const recent = prev.slice(-149);
        return [
          ...recent,
          {
            time: tick.time,
            close: Number(tick.price.toFixed(2)),
            volume: tick.volume,
            rsi: null,
            macd: null,
            signal: null,
            histogram: null,
          },
        ];
      });
    });

    socket.on("webhook-event", (event: WebhookEvent) => {
      setWebhookEvents((prev) => [event, ...prev].slice(0, 10));
    });

    return () => {
      socket.off("tick");
      socket.off("webhook-event");
    };
  }, [socket, symbol]);

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        const res = await axios.get<{ symbol: string; data: DataPoint[] }>(
          `${API_URL}/api/history/${symbol}?range=5d&interval=5m`
        );
        setPoints(res.data.data);
        if (res.data.data.length > 0) {
          setLastPrice(res.data.data[res.data.data.length - 1].close);
        }
      } catch {
        setError("데이터를 불러오지 못했습니다. 심볼 또는 서버 상태를 확인해주세요.");
      }
    };
    load();
  }, [symbol]);

  useEffect(() => {
    const loadCompare = async () => {
      const [compareRes, eventsRes] = await Promise.all([
        axios.get<CompareResponse>(`${API_URL}/api/realtime/compare`),
        axios.get<{ events: WebhookEvent[] }>(`${API_URL}/api/webhooks/events`),
      ]);
      setCompare(compareRes.data);
      setWebhookEvents(eventsRes.data.events.slice(0, 10));
    };
    loadCompare().catch(() => {
      // skip compare panel on connectivity errors
    });
  }, []);

  const submitTestWebhook = async () => {
    try {
      await axios.post(
        `${API_URL}/api/webhooks/finnhub/test`,
        { symbol, triggeredFromUi: true },
        {
          params: { secret: webhookSecret || undefined },
          headers: webhookSecret ? { "x-webhook-secret": webhookSecret } : undefined,
        }
      );
    } catch {
      setError("웹훅 테스트 호출 실패: secret 또는 서버 설정을 확인해주세요.");
    }
  };

  const priceDelta =
    points.length > 1 ? lastPrice! - points[Math.max(0, points.length - 2)].close : 0;
  const priceDeltaPct =
    points.length > 1 && lastPrice
      ? (priceDelta / points[Math.max(0, points.length - 2)].close) * 100
      : 0;

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
          <label>
            <input
              type="checkbox"
              checked={showRsi}
              onChange={(e) => setShowRsi(e.target.checked)}
            />
            RSI
          </label>
          <label>
            <input
              type="checkbox"
              checked={showMacd}
              onChange={(e) => setShowMacd(e.target.checked)}
            />
            MACD
          </label>
          <label>
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
            />
            Volume
          </label>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <article className="chart-card">
        <div className="chart-header">
          <h2>Price Chart</h2>
          <div className="range-pills">
            <span className="pill active">1D</span>
            <span className="pill">1W</span>
            <span className="pill">1M</span>
            <span className="pill">3M</span>
            <span className="pill">YTD</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="2 3" />
            <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={24} />
            <YAxis domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
            <Line dataKey="close" stroke="#18c964" dot={false} strokeWidth={2.5} />
          </LineChart>
        </ResponsiveContainer>
      </article>

      {showVolume && (
        <article className="chart-card">
          <h2>Volume</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={24} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
              <Bar dataKey="volume" fill="#4b5563" />
            </BarChart>
          </ResponsiveContainer>
        </article>
      )}

      {showRsi && (
        <article className="chart-card">
          <h2>RSI (14)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={24} />
              <YAxis domain={[0, 100]} />
              <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
              <Line dataKey="rsi" stroke="#16a34a" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>
      )}

      {showMacd && (
        <article className="chart-card">
          <h2>MACD (12,26,9)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={24} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
              <Line dataKey="macd" stroke="#9333ea" dot={false} />
              <Line dataKey="signal" stroke="#f97316" dot={false} />
              <Line dataKey="histogram" stroke="#0ea5e9" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>
      )}

      <article className="chart-card compare-card">
        <h2>API Key vs Webhook</h2>
        <p className="subtle">
          API key는 클라이언트가 실시간 스트림을 당겨오는 방식이고, webhook은 외부 이벤트가 서버로 들어오는 방식입니다.
        </p>
        <div className="compare-grid">
          <div className="compare-box">
            <h3>API Key (WebSocket)</h3>
            <p>Status: {compare?.websocket?.enabled ? "Enabled" : "Disabled"}</p>
            <p>Use case: 초단위 가격 업데이트/차트 반영</p>
          </div>
          <div className="compare-box">
            <h3>Webhook (HTTP callback)</h3>
            <p>Status: {compare?.webhook?.enabled ? "Enabled" : "Disabled"}</p>
            <p>Use case: 알림/신호 수신, 자동 매매 파이프라인 트리거</p>
          </div>
        </div>

        <div className="webhook-tools">
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Webhook secret (optional)"
          />
          <button type="button" onClick={submitTestWebhook}>
            Send test webhook
          </button>
        </div>

        <div className="events">
          {webhookEvents.length === 0 ? (
            <p className="subtle">아직 수신된 webhook 이벤트가 없습니다.</p>
          ) : (
            webhookEvents.map((event) => (
              <div className="event-item" key={event.id}>
                <strong>{event.source}</strong>
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
