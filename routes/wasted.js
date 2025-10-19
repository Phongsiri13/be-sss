// routes/waste.js
import express from "express";
import { fetchWastedRowsCached } from "../src/services/wastedFetcherCached.js";
import {
  monthKey,
  prevMonth,
  latestDistinctMonthsSet,
  filterRowsByMonths,
} from "../src/helpers/dateFilter.js";

const router = express.Router();

const PEOPLE_IN_BUILDING = 372; // ค่าคงที่ที่ SSS กำหนด
const UNIT_COST_WASTED = 2.28; // ✅ ค่าเฉลี่ยจากอัตราค่ากำจัดขยะของ กทม./เทศบาล

// GET /api/v1/wasted/json?gid=XXXX
router.get("/json", async (req, res) => {
  try {
    const { gid, month, year } = req.query;

    // ✅ ทำแบบนี้: ดึงค่าออกมาก่อน
    const { rows, cached, fetchedAt } = await fetchWastedRowsCached({
      gid,
      month,
      year,
    });

    res.json({
      count: rows.length,
      cached,
      fetched_at: new Date(fetchedAt).toISOString(),
      ttl_days: Number(process.env.CACHE_TTL_DAYS || 30),
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Display on SSS to user see
/**
 * GET /api/v1/wasted/latest_four-quarterly
 *
 * สรุป 4 ไตรมาสล่าสุด โดยเรียง "เก่าสุด -> ล่าสุด" จากวันที่สูงสุดในข้อมูล
 *
 * Query:
 *   - gid (string, optional): Google Sheet GID ของแท็บ (ถ้าไม่ส่งจะใช้แท็บหลัก)
 *
 * Behavior (ตามโค้ด):
 *   - ดึงข้อมูลด้วย fetchWastedRowsCached({ gid })
 *   - หา maxDate จากช่อง r.date (คาดว่าเป็น YYYY-MM-DD)
 *   - สร้างคีย์ของ 4 ไตรมาสล่าสุดจาก maxDate (เช่น ["Q4/2024","Q1/2025","Q2/2025","Q3/2025"])
 *   - รวมเฉพาะแถวที่ตกอยู่ใน 4 ไตรมาสดังกล่าว
 *   - การรวมค่า:
 *       • total_waste_kg: ถ้า r.total_waste_kg > 0 ใช้ค่านั้น
 *                         มิฉะนั้นคำนวณ = general + organic + recycle + hazardous
 *       • landfill_waste_kg: ถ้า r.landfill_waste_kg > 0 ใช้ค่านั้น
 *                            มิฉะนั้น fallback = general_waste_kg
 *       • carbon_emission_kgco2e: ถ้ามี r.carbon_emission_kgco2e ใช้ค่านั้น
 *                                 มิฉะนั้นใช้ r.carbon_emission_kgco2e_per_kg (ตรง ๆ)
 *   - เก็บเดือนที่เกี่ยวข้องในแต่ละไตรมาสเป็นรูปแบบ "YYYY-MM" (months_included)
 *
 * Response:
 * {
 *   "quarterly_summary": {
 *     "Q3/2024": {
 *       "months_included": ["2024-07", "2024-08", "2024-09"],
 *       "total_general_waste_kg": <number>,
 *       "total_organic_waste_kg": <number>,
 *       "total_recycle_waste_kg": <number>,
 *       "total_hazardous_waste_kg": <number>,
 *       "total_landfill_waste_kg": <number>,
 *       "total_waste_kg": <number>,
 *       "total_carbon_emission_kgco2e": <number>
 *     },
 *     "Q4/2024": { ... },
 *     "Q1/2025": { ... },
 *     "Q2/2025": { ... }
 *   }
 * }
 *
 * Notes:
 *   - ตัวเลขทั้งหมดถูกพาร์สแบบลบคอมมาแล้วเป็น number (เช่น "1,406.5" -> 1406.5)
 *   - ถ้าไม่มีข้อมูลเลย จะคืน { quarterly_summary: {} }
 *   - ไม่ส่ง fields "records" อีกต่อไป
 */
router.get("/wasted-latest_four-quarterly", async (req, res) => {
  try {
    const { gid } = req.query;
    // console.log("[latest_four-quarterly] gid =", gid);

    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) return res.json({ quarterly_summary: {} });

    // 🔹 Helper functions
    const num = (v) => {
      const n = Number(String(v ?? "").toString().replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    const q = (m) => Math.floor((m - 1) / 3) + 1; // 1..4
    const qKey = (d) => `Q${q(d.getMonth() + 1)}/${d.getFullYear()}`;
    const prevQ = ({ q, y }) => (q > 1 ? { q: q - 1, y } : { q: 4, y: y - 1 });
    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // 🔹 1) หา max date
    const maxDate = rows.reduce((mx, r) => {
      if (!r?.date) return mx;
      const d = new Date(r.date);
      return isNaN(d) ? mx : (mx === null || d > mx ? d : mx);
    }, null);
    if (!maxDate) return res.json({ quarterly_summary: {} });
    // console.log("[latest_four-quarterly] maxDate =", maxDate.toISOString());

    // 🔹 2) เตรียม 4 ไตรมาส (เก่าสุด -> ล่าสุด)
    const latest = { q: q(maxDate.getMonth() + 1), y: maxDate.getFullYear() };
    const list = [latest, prevQ(latest), prevQ(prevQ(latest)), prevQ(prevQ(prevQ(latest)))].reverse();
    const keys = list.map(({ q, y }) => `Q${q}/${y}`);
    // console.log("[latest_four-quarterly] allowedKeys =", keys);

    // 🔹 3) เตรียมโครงสร้างสะสม (ไม่รวม landfill/waste/carbon)
    const init = () => ({
      total_general_waste_kg: 0,
      total_organic_waste_kg: 0,
      total_recycle_waste_kg: 0,
      total_hazardous_waste_kg: 0,
      months: new Set(),
    });

    const accMap = new Map(keys.map((k) => [k, init()]));

    // 🔹 4) รวมค่ารายเดือน
    for (const r of rows) {
      if (!r?.date) { console.log("[SKIP] missing date", r); continue; }
      const d = new Date(r.date);
      if (isNaN(d)) { console.log("[SKIP] invalid date:", r.date); continue; }

      const key = qKey(d);
      const acc = accMap.get(key);
      if (!acc) continue;

      // ✅ ใช้เฉพาะ 4 หมวดหลัก
      const gw = num(r.general_waste_kg);
      const ow = num(r.organic_waste_kg);
      const rw = num(r.recycle_waste_kg);
      const hw = num(r.hazardous_waste_kg);

      acc.total_general_waste_kg += gw;
      acc.total_organic_waste_kg += ow;
      acc.total_recycle_waste_kg += rw;
      acc.total_hazardous_waste_kg += hw;

      // ✅ จดเดือนของ record นี้ไว้ในไตรมาส
      acc.months.add(monthKey(d));
    }

    // 🔹 5) สรุปผล (เก็บเฉพาะ 4 หมวด + เดือน)
    const summary = keys.reduce((o, k) => {
      const v = accMap.get(k) || init();
      const monthsArr = Array.from(v.months).sort(); // เรียงจากเก่า→ใหม่
      o[k] = {
        months_included: monthsArr, // เช่น ["2025-04","2025-05","2025-06"]
        total_general_waste_kg: v.total_general_waste_kg,
        total_organic_waste_kg: v.total_organic_waste_kg,
        total_recycle_waste_kg: v.total_recycle_waste_kg,
        total_hazardous_waste_kg: v.total_hazardous_waste_kg,
      };
      return o;
    }, {});

    // 🔹 6) ส่งผลลัพธ์กลับ
    return res.json({ quarterly_summary: summary });
  } catch (err) {
    console.error("[latest_four-quarterly] ERROR:", err);
    res.status(500).json({ error: `Server error: ${String(err.message || err)}` });
  }
});


// Display on SSS to user see
/**
 * GET /api/v1/wasted/widget
 *
 * 📊 สรุปข้อมูล 2 เดือนล่าสุดจาก Google Sheet (ผ่าน cache)
 * โดยรวมข้อมูลรายเดือนของ:
 *   ✅ organic_waste_kg
 *   ✅ hazardous_waste_kg
 *   ✅ landfill_waste_kg
 *
 * และคำนวณ:
 *   - (sum / PEOPLE_IN_BUILDING) * 1000 เพื่อหาค่าขยะต่อคนต่อ 1000 คน
 *   - ปัดค่าผลลัพธ์ขึ้น 1 ตำแหน่งทศนิยม (ceil1)
 *   - เปรียบเทียบ % เพิ่มขึ้นหรือลดลงจากเดือนก่อนหน้า (ปัดธรรมดา 2 ตำแหน่ง)
 *
 * 🧾 ตัวอย่างผลลัพธ์:
 * {
 *   "months_used": ["2025-05", "2025-06"],
 *   "organic_summary": [
 *     { "month": "2025-05", "total_kg": 224.0, "computed_value": 603.0 },
 *     { "month": "2025-06", "total_kg": 237.0, "computed_value": 637.0 }
 *   ],
 *   "hazardous_summary": [
 *     { "month": "2025-05", "total_kg": 8.0, "computed_value": 21.5 },
 *     { "month": "2025-06", "total_kg": 6.0, "computed_value": 16.1 }
 *   ],
 *   "landfill_summary": [
 *     { "month": "2025-05", "total_kg": 5400.0, "computed_value": 14516.0 },
 *     { "month": "2025-06", "total_kg": 5500.0, "computed_value": 14784.0 }
 *   ],
 *   "comparison": { ... },               // สำหรับ organic
 *   "hazardous_comparison": { ... },     // สำหรับ hazardous
 *   "landfill_comparison": { ... },      // สำหรับ landfill
 *   "total_rows": 48
 * }
 */
router.get("/widget", async (req, res) => {
  try {
    const { gid } = req.query;

    // 1️⃣ ดึงข้อมูลจาก Google Sheet ผ่าน cache
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) {
      return res.json({
        months_used: [],
        organic_summary: [],
        hazardous_summary: [],
        landfill_summary: [],
        comparison: null,
        hazardous_comparison: null,
        landfill_comparison: null,
        total_rows: 0,
      });
    }

    // 2️⃣ หา "2 เดือนล่าสุดที่มีข้อมูลจริง" เช่น ["2025-05", "2025-06"]
    const monthsSet = latestDistinctMonthsSet(rows, 2);
    const monthsSorted = Array.from(monthsSet).sort();

    if (monthsSorted.length < 2) {
      const filtered = filterRowsByMonths(rows, monthsSet);
      return res.json({
        months_used: monthsSorted,
        organic_summary: [],
        hazardous_summary: [],
        landfill_summary: [],
        comparison: null,
        hazardous_comparison: null,
        landfill_comparison: null,
        total_rows: filtered.length,
      });
    }

    // 3️⃣ กรองเฉพาะข้อมูลของ 2 เดือนล่าสุด
    const filtered = filterRowsByMonths(rows, monthsSet);

    /**
     * 4️⃣ ฟังก์ชันรวมค่ารายเดือน (field = ชื่อคอลัมน์ เช่น organic_waste_kg)
     * คืนค่าในรูปแบบ { "YYYY-MM": sum }
     */
    const monthKeySum = (field) => {
      const acc = {};
      for (const r of filtered) {
        if (!r?.date) continue;
        const d = new Date(r.date);
        if (isNaN(d)) continue;
        const key = monthKey(d); // เช่น "2025-06"
        const val = Number(r[field] ?? 0);
        acc[key] = (acc[key] ?? 0) + val;
      }
      return acc;
    };

    const organicMonthlySum = monthKeySum("organic_waste_kg");
    const hazardousMonthlySum = monthKeySum("hazardous_waste_kg");
    const landfillMonthlySum = monthKeySum("landfill_waste_kg");

    // 5️⃣ ฟังก์ชันปัดเลข
    const ceil1 = (n) => Math.ceil(n * 10) / 10;     // ปัดขึ้น 1 ตำแหน่ง
    const round2 = (n) => Math.round(n * 100) / 100;  // ปัดธรรมดา 2 ตำแหน่ง

    /**
     * 6️⃣ แปลงข้อมูลเป็น summary รายเดือน
     * formula: (sum / PEOPLE_IN_BUILDING) * 1000
     */
    const asSummary = (monthsSorted, monthlySum) =>
      monthsSorted.map((m) => {
        const total = Number(monthlySum[m] ?? 0);
        const perK = (total / PEOPLE_IN_BUILDING) * 1000;
        return {
          month: m,
          total_kg: ceil1(total),       // ปัดขึ้น 1 ตำแหน่ง
          computed_value: ceil1(perK),  // ปัดขึ้น 1 ตำแหน่ง
        };
      });

    const organic_summary = asSummary(monthsSorted, organicMonthlySum);
    const hazardous_summary = asSummary(monthsSorted, hazardousMonthlySum);
    const landfill_summary = asSummary(monthsSorted, landfillMonthlySum);

    /**
     * 7️⃣ ฟังก์ชันเปรียบเทียบ 2 เดือน (เพิ่มขึ้น/ลดลง)
     * diff ไม่ปัด, pct_change ปัด 2 ตำแหน่ง
     */
    const compareTwoMonths = (arr) => {
      const prev = arr[0];
      const curr = arr[1];
      const diff = curr.computed_value - prev.computed_value;
      const pct_change =
        prev.computed_value === 0 ? null : round2((diff / prev.computed_value) * 100);

      let direction = "flat";
      if (diff > 0) direction = "up";
      else if (diff < 0) direction = "down";

      return {
        previous_month: prev.month,
        current_month: curr.month,
        previous_value: prev.computed_value,
        current_value: curr.computed_value,
        diff,        // ไม่ปัด
        pct_change,  // ปัด 2 ตำแหน่ง
        direction,
      };
    };

    // ✅ hazardous_comparison — ใช้ total_kg, คำนวณ pct_change และ direction
    const prevVal = hazardous_summary?.[0]?.total_kg ?? 0;
    const currVal = hazardous_summary?.[1]?.total_kg ?? 0;

    // คำนวณ % เปลี่ยนแปลง
    let pct_change = null;
    if (prevVal !== 0) {
      pct_change = ((currVal - prevVal) / prevVal) * 100;
      pct_change = Math.round(pct_change * 100) / 100; // ✅ ปัด 2 ตำแหน่ง
    }

    // หาทิศทาง
    let direction = "flat";
    if (pct_change > 0) direction = "up";
    else if (pct_change < 0) direction = "down";

    const hazardous_comparison = {
      previous_month: hazardous_summary?.[0]?.month ?? null,
      current_month: hazardous_summary?.[1]?.month ?? null,
      previous_value: prevVal,
      current_value: currVal,
      diff: null,        // ❌ ยังไม่ต้องใช้ diff
      pct_change,        // ✅ คำนวณจาก total_kg
      direction,         // ✅ หาทิศทางเพิ่มขึ้น/ลดลง
    };

    const organic_trend = compareTwoMonths(organic_summary);
    const landfill_comparison = compareTwoMonths(landfill_summary);

    // 8️⃣ ส่งผลลัพธ์ทั้งหมดออก
    res.json({
      months_used: monthsSorted,
      organic_summary,
      hazardous_summary,
      landfill_summary,
      organic_trend,             // ของ organic
      hazardous_comparison,   // ของ hazardous
      landfill_comparison,    // ของ landfill
      // total_rows: filtered.length,
    });
  } catch (err) {
    console.error("[/widget] ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Display on SSS to user see
router.get("/wasted-floors", async (req, res) => {
  try {
    const { gid } = req.query;

    // 1️⃣ ดึงข้อมูลจาก Google Sheet (ผ่าน cache)
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) {
      return res.json({ month_used: null, month_name_th: null, total_rows: 0, floors: [] });
    }

    // 2️⃣ helpers
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    const round1 = (n) => Math.round(n * 10) / 10;
    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // 3️⃣ หา "เดือนก่อนหน้า" จากปัจจุบัน (เช่น วันนี้ ต.ค. 2025 -> ใช้ ก.ย. 2025)
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = monthKey(prevMonthDate); // "YYYY-MM"

    // 4️⃣ กรองเฉพาะข้อมูลของเดือนก่อนหน้าเท่านั้น
    const filtered = rows.filter((r) => {
      if (!r?.date) return false;
      const d = new Date(r.date);
      if (isNaN(d)) return false;
      return monthKey(d) === prevKey;
    });

    // 5️⃣ รวมค่า total_waste_kg ตาม floor (ข้าม "รวม"/"ALL")
    const agg = new Map(); // floor -> sum(total_waste_kg)
    for (const r of filtered) {
      const floorRaw = (r?.floor ?? "").toString().trim();
      if (!floorRaw) continue;
      if (floorRaw === "รวม" || floorRaw.toUpperCase() === "ALL") continue;

      const totalWaste = num(r.total_waste_kg);
      agg.set(floorRaw, (agg.get(floorRaw) ?? 0) + totalWaste);
    }

    // 6️⃣ แปลง Map -> Array และจัดเรียงชั้น
    let floors = Array.from(agg.entries())
      .map(([floor, total_waste_kg]) => ({ floor, total_waste_kg }))
      .sort((a, b) => {
        const an = Number(a.floor);
        const bn = Number(b.floor);
        const aNum = Number.isFinite(an);
        const bNum = Number.isFinite(bn);
        if (aNum && bNum) return an - bn;
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return 1;
        return String(a.floor).localeCompare(String(b.floor), "th");
      });

    // 7️⃣ ถ้ามี floor "0" -> แตกเป็น B1/B2 โดยหาร 2 แล้วปัดเป็นทศนิยม 1 ตำแหน่ง
    const floor0 = floors.find((f) => f.floor === "0");
    if (floor0) {
      const half = floor0.total_waste_kg / 2;
      floors = floors.filter((f) => f.floor !== "0");
      floors.unshift(
        { floor: "B1", total_waste_kg: round1(half) },
        { floor: "B2", total_waste_kg: round1(half) }
      );
    }

    // 8️⃣ ปัดค่าของทุก floor ให้เป็นทศนิยม 1 ตำแหน่งก่อนส่งออก
    floors = floors.map((f) => ({
      floor: f.floor,
      total_waste_kg: round1(f.total_waste_kg),
    }));

    // 🔹 แปลง month_used เป็นชื่อเดือนภาษาไทย
    const monthNamesTH = [
      "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    const [year, month] = prevKey.split("-").map(Number);
    const month_name_th = `${monthNamesTH[month - 1]} ${year + 543}`; // เช่น "กันยายน 2568"

    // 9️⃣ ส่งผลลัพธ์
    return res.json({
      month_used: prevKey,          // เช่น "2025-09"
      month_name_th,                // ✅ เพิ่มชื่อเดือนภาษาไทย เช่น "กันยายน 2568"
      total_rows: filtered.length,  // จำนวนแถวของเดือนนั้น
      floors,                       // รายการชั้นพร้อมค่า total_waste_kg
    });
  } catch (err) {
    console.error("[/wasted-floors] ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});


// Display on SSS to user see
/**
 * 📊 GET /api/v1/wasted/recycle-rate
 * ----------------------------------------
 * ดึงข้อมูลอัตราการรีไซเคิล (Recycle Rate) รายเดือนของปีที่กำหนด
 * สูตรคำนวณ: (recycle_waste_kg / total_waste_kg) * 100
 *
 * ✅ รองรับ query:
 *    - gid: Google Sheet GID (optional)
 *    - year: ปีที่ต้องการ (ค่าเริ่มต้น = ปีปัจจุบัน)
 *    - target: เป้าหมายร้อยละ (ค่าเริ่มต้น = 5)
 *
 * ✅ การทำงาน:
 *    1. ดึงข้อมูลทั้งหมดจาก Google Sheet ผ่าน cache
 *    2. กรองเฉพาะข้อมูลของปีที่กำหนด
 *    3. รวมค่าขยะรีไซเคิลและขยะรวมในแต่ละเดือน
 *    4. คำนวณอัตรารีไซเคิล (%) รายเดือน
 *    5. ส่งคืนผลลัพธ์ในรูปแบบที่อ่านง่ายสำหรับ Dashboard
 *
 * ✅ รูปแบบการตอบกลับ (Response):
 * {
 *   "RecycleRate": [
 *     { "year": 2025, "month": 1, "recycle_rate_percent": 35, "target": 5 },
 *     { "year": 2025, "month": 2, "recycle_rate_percent": 33, "target": 5 },
 *     ...
 *   ]
 * }
 */
router.get("/recycle-rate", async (req, res) => {
  try {
    const { gid } = req.query;

    // 1️⃣ อ่านปีและเป้าหมายจาก query
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JavaScript เดือนเริ่มที่ 0
    const year = Number(req.query.year ?? currentYear);
    const target = Number(req.query.target ?? 5); // เป้าหมายค่าเริ่มต้น = 5%

    // 2️⃣ ดึงข้อมูลจาก Google Sheet (ผ่าน cache)
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) {
      // ถ้าไม่มีข้อมูล ให้ส่ง array ว่าง
      return res.json({ RecycleRate: [] });
    }

    // 3️⃣ ฟังก์ชันแปลงค่าที่อาจเป็น string (มี comma) → number
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };

    // 4️⃣ ถ้าเป็นปีปัจจุบัน → คำนวณถึงเดือนก่อนปัจจุบันเท่านั้น
    const endMonth = (year === currentYear)
      ? Math.max(1, currentMonth - 1)
      : 12;

    // 5️⃣ เตรียมโครงสร้างเก็บข้อมูลรวมรายเดือน
    //    เช่น monthAgg[5] = { recycle: 123, total: 500 }
    const monthAgg = {};
    for (let m = 1; m <= endMonth; m++) {
      monthAgg[m] = { recycle: 0, total: 0 };
    }

    // 6️⃣ รวมค่า recycle_waste_kg และ total_waste_kg รายเดือน
    for (const r of rows) {
      if (!r?.date) continue;
      const d = new Date(r.date);
      if (isNaN(d)) continue;

      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      if (y !== year) continue;            // ข้ามถ้าไม่ตรงปี
      if (m < 1 || m > endMonth) continue; // ข้ามเดือนนอกช่วง

      // ✅ ดึงค่าขยะประเภทต่าง ๆ และ fallback ถ้า total_waste_kg = 0
      const gw = num(r.general_waste_kg);
      const ow = num(r.organic_waste_kg);
      const rw = num(r.recycle_waste_kg);
      const hw = num(r.hazardous_waste_kg);
      const tw = num(r.total_waste_kg);
      const total = tw > 0 ? tw : (gw + ow + rw + hw);

      monthAgg[m].recycle += rw;
      monthAgg[m].total   += total;
    }

    // 7️⃣ แปลงผลรวมเป็น array พร้อมคำนวณร้อยละ
    const RecycleRate = [];
    for (let m = 1; m <= endMonth; m++) {
      const { recycle, total } = monthAgg[m] ?? { recycle: 0, total: 0 };
      // สูตร: (recycle / total) * 100 → ปัดเป็นจำนวนเต็ม
      const percent = total > 0 ? (recycle / total) * 100 : 0;
      RecycleRate.push({
        year,
        month: m,
        recycle_rate_percent: Math.round(percent), // ปัดเป็นจำนวนเต็ม
        target, // ค่าเป้าหมาย (%)
      });
    }

    // 8️⃣ ส่งผลลัพธ์สุดท้าย
    res.json({ RecycleRate });

  } catch (err) {
    // 🔴 ถ้าเกิด error ให้ส่งข้อความกลับ client
    console.error("[/recycle-rate] ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Display on SSS to user see
router.get("/waste-management-information", async (req, res) => {
  try {
    const { gid } = req.query;
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) {
      return res.json({ months_used: [], landfill_rate: null, cost: null });
    }

    // --- Helper functions ---
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const round1 = (n) => Math.round(n * 10) / 10;
    const dirOf = (delta) => (delta > 0 ? "up" : delta < 0 ? "down" : "flat");

    // --- หา 2 เดือนล่าสุดจากฟิลด์ date ---
    const monthsPresent = new Set();
    for (const r of rows) {
      if (!r?.date) continue;
      const d = new Date(r.date);
      if (!isNaN(d)) monthsPresent.add(monthKey(d));
    }
    const monthsSorted = Array.from(monthsPresent).sort();
    if (monthsSorted.length < 2) {
      return res.json({ months_used: monthsSorted, landfill_rate: null, cost: null });
    }

    const [prevMonthKey, currMonthKey] = monthsSorted.slice(-2);

    // --- รวมเฉพาะฟิลด์ที่เกี่ยวข้อง (general, hazardous, landfill) ---
    const agg = {
      [prevMonthKey]: { landfill: 0 },
      [currMonthKey]: { landfill: 0 },
    };

    for (const r of rows) {
      if (!r?.date) continue;
      const d = new Date(r.date);
      if (isNaN(d)) continue;
      const mk = monthKey(d);
      if (!agg[mk]) continue;

      const gw = num(r.general_waste_kg);     // ขยะทั่วไป
      const hw = num(r.hazardous_waste_kg);   // ขยะอันตราย
      const lf = num(r.landfill_waste_kg);    // ขยะฝังกลบ (ถ้ามีใน row)

      const landfill = lf > 0 ? lf : (gw + hw); // ✅ ใช้ landfill_waste_kg หากมี
      agg[mk].landfill += landfill;
    }

    const prev = agg[prevMonthKey];
    const curr = agg[currMonthKey];

    // --- ส่วนต่างน้ำหนักขยะฝังกลบ (กก.)
    const landfill_diff_kg = curr.landfill - prev.landfill;

    // --- เปอร์เซ็นต์การเปลี่ยนแปลงของ “น้ำหนักขยะฝังกลบ”
    const percent_change_kg =
      prev.landfill === 0 ? null : round1(((curr.landfill - prev.landfill) / prev.landfill) * 100);

    // --- ปริมาณคาร์บอนไดออกไซด์เทียบเท่า (kgCO₂e)
    const wasted_kgco2e = round1(landfill_diff_kg * 2.32);

    // --- ต้นทุนขยะฝังกลบ (บาท)
    const prevCost = prev.landfill * UNIT_COST_WASTED;
    const currCost = curr.landfill * UNIT_COST_WASTED;
    const change_baht = round1(currCost - prevCost);
    const percent_change_cost =
      prevCost === 0 ? null : round1(((currCost - prevCost) / prevCost) * 100);
    const direction_cost = dirOf(change_baht);

    // --- แปลงชื่อเดือนเป็นภาษาไทย + พ.ศ. ---
    const monthNamesTH = [
      "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    const [prevYear, prevMonth] = prevMonthKey.split("-").map(Number);
    const [currYear, currMonth] = currMonthKey.split("-").map(Number);
    const previous_month_name = `${monthNamesTH[prevMonth - 1]} ${prevYear + 543}`;
    const current_month_name = `${monthNamesTH[currMonth - 1]} ${currYear + 543}`;

    // --- ✅ ผลลัพธ์หลัก ---
    const landfill_rate = {
      change_kg: round1(landfill_diff_kg),
      wasted_kgco2e,
      percent_change: percent_change_kg,
      direction_kg: dirOf(landfill_diff_kg),
    };

    const cost = {
      change_baht,
      percent_change: percent_change_cost,
      unit_cost_per_kg: UNIT_COST_WASTED,
      direction: direction_cost,
    };

    res.json({
      months_used: [prevMonthKey, currMonthKey],
      previous_month_name,
      current_month_name,
      landfill_rate,
      cost,
    });
  } catch (err) {
    console.error("[/total-cost] ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});


export default router;

