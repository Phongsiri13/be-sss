import {Router} from "express";
import { fetchWastedRowsCached } from "../src/services/wastedFetcherCached.js";
import {
  monthKey,
  prevMonth,
  latestDistinctMonthsSet,
  filterRowsByMonths,
} from "../src/helpers/dateFilter.js";


const router = Router();

/**
 * @route GET /iaq/current
 * @desc แสดงข้อมูลคุณภาพอากาศ (Indoor Air Quality - IAQ)
 * ประกอบด้วย:
 * - สภาพอากาศวันนี้ (อุณหภูมิ, สภาพท้องฟ้า)
 * - PM 2.5
 * - PM 10
 * - CO₂
 * - ความชื้นสัมพัทธ์ (%RH)
 * - สารประกอบอินทรีย์ระเหย (VOC)
 *
 * หมายเหตุ:
 *   ขณะนี้ใช้ค่าจำลอง (mock data) สามารถต่อยอดเชื่อมข้อมูลจาก sensor ภายหลังได้
 */
router.get("/iaq/current", async (req, res) => {
  try {
    // ✅ mock data (ตัวอย่างตามภาพ)
    const data = {
      weather: {
        label_th: "สภาพอากาศวันนี้",
        temperature_c: 32,
        condition: "sunny", // sunny / cloudy / rainy
      },
      pm25: {
        label_th: "PM 2.5",
        value: 7.1,
        unit: "µg/m³",
        status: "ยอดเยี่ยม",
      },
      pm10: {
        label_th: "PM 10",
        value: 8,
        unit: "µg/m³",
        status: "ยอดเยี่ยม",
      },
      co2: {
        label_th: "CO₂",
        value: 403,
        unit: "ppm",
        status: "ยอดเยี่ยม",
      },
      humidity: {
        label_th: "ความชื้น",
        value_percent: 70,
        unit: "%",
        status: "ปานกลาง",
      },
      voc: {
        label_th: "สารประกอบอินทรีย์ระเหย",
        value_ppb: 500,
        unit: "ppb",
        status: "ปานกลาง",
      },
      updated_at: new Date().toISOString(),
    };

    // ✅ คืนข้อมูล JSON
    return res.json(data);
  } catch (err) {
    console.error("[/iaq/current] ERROR:", err);
    res
      .status(500)
      .json({ error: `Server error: ${String(err.message || err)}` });
  }
});


export default router;