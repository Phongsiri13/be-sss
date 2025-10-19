import express from "express";
import cors from "cors";
import wastedRoutes from "./routes/wasted.js";
import FootprintRoutes from "./routes/carbon_footprint.js";
import EnergyRoutes from "./routes/energy_consumption.js";
import IAQRoutes from "./routes/IAQ.js";
import reportRoutes from "./routes/report.js";
import "dotenv/config";
import { fetchWastedRowsCached } from "./src/services/wastedFetcherCached.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------
// ✅ 1. ตั้งค่าเส้นทาง static ให้ Express สามารถเข้าถึงไฟล์ฟอนต์ได้
// ------------------------------------------------------
app.use("/public", express.static(path.join(__dirname, "public")));

app.use("/api/v1/wasted", wastedRoutes);
app.use("/api/v1/carbon-footprint", FootprintRoutes);
app.use("/api/v1/energy_consumption", EnergyRoutes);
app.use("/api/v1/IAQ", IAQRoutes);
app.use("/api/v1/report", reportRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server started on http://localhost:${PORT}`);
    fetchWastedRowsCached()
        .then(() => {
            console.log(`   - Initial data fetch complete, rows loaded.`);
        })
        .catch((err) => {
            console.error("   - Initial data fetch error:", err);
        });
});
