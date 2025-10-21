// server.js
import express from "express";
import cors from "cors";

import wastedRoutes from "./routes/wasted.js";
import FootprintRoutes from "./routes/carbon_footprint.js";
import EnergyRoutes from "./routes/energy_consumption.js";
import IAQRoutes from "./routes/IAQ.js";
import { fetchWastedRowsCached } from "./src/services/wastedFetcherCached.js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Routes
app.use("/api/v1/wasted", wastedRoutes);
app.use("/api/v1/carbon-footprint", FootprintRoutes);
app.use("/api/v1/energy_consumption", EnergyRoutes);
app.use("/api/v1/IAQ", IAQRoutes);

// Health check
app.get("/healthz", (req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT) || 3000;

// อุ่นแคชแบบ soft-fail (ไม่มี TLA)
const warmCache = async () => {
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error("warmup timeout")), 8000)
  );
  return Promise.race([fetchWastedRowsCached(), timeout]);
};

const startServer = async () => {
  try {
    console.log("Attempting to fetch initial data (cache)...");
    await warmCache();
    console.log("   - Initial data fetch complete.");
  } catch (err) {
    console.warn("! Warmup failed:", err.message, "-> continue without cache");
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`✅ Server started and listening on port ${PORT}`);
  });
};

startServer();
