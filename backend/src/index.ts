import dotenv from "dotenv";
import { createStockServer } from "./server";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const FINNHUB_WEBHOOK_SECRET = process.env.FINNHUB_WEBHOOK_SECRET ?? "";
const { httpServer } = createStockServer({
  FRONTEND_ORIGIN,
  FINNHUB_API_KEY,
  FINNHUB_WEBHOOK_SECRET,
});

httpServer.listen(PORT, () => {
  console.log(`Stock backend listening on http://localhost:${PORT}`);
});
