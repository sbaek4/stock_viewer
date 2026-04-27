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

    return () => {
      socket.off("tick");
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

  return (
    <main className="app">
      <h1>Realtime Stock Viewer</h1>
      <p className="sub">
        실시간 체결 + 기술적 분석(RSI/MACD/Volume) 확인 대시보드
      </p>

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
          <button type="submit">심볼 변경</button>
        </form>
        <div className="toggles">
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

      <section className="headline">
        <strong>{symbol}</strong>
        <span>
          Last: {lastPrice ? `$${lastPrice.toFixed(2)}` : "-"}
        </span>
      </section>

      {error && <p className="error">{error}</p>}

      <article className="chart-card">
        <h2>Price</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={24} />
            <YAxis domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
            <Line dataKey="close" stroke="#2563eb" dot={false} strokeWidth={2} />
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
    </main>
  );
}

export default App;
