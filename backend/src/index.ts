import dotenv from "dotenv";
import { createStockServer } from "./server";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const { httpServer } = createStockServer({ FRONTEND_ORIGIN, FINNHUB_API_KEY });

httpServer.listen(PORT, () => {
  console.log(`Stock backend listening on http://localhost:${PORT}`);
});
