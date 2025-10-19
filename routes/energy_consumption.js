import express from "express";
import { fetchWastedRowsCached } from "../src/services/wastedFetcherCached.js";
import {
  monthKey,
  prevMonth,
  latestDistinctMonthsSet,
  filterRowsByMonths,
  monthNamesTH
} from "../src/helpers/dateFilter.js";

const router = express.Router();

router.get("/energy-floors", async (req, res) => {
  try {
    const { gid } = req.query;

    // 🔸 ไม่ดึงข้อมูลจาก Google Sheet อีกต่อไป (เอาออกตามคำขอ)
    // const fetched = await fetchWastedRowsCached({ gid });

    // 1) helpers คงเดิม
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    const round1 = (n) => Math.round(n * 10) / 10;
    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // 2) หา "เดือนก่อนหน้า" จากปัจจุบัน (เช่น วันนี้ ต.ค. 2025 -> ใช้ ก.ย. 2025)
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = monthKey(prevMonthDate); // "YYYY-MM"

    const [year, month] = prevKey.split("-").map(Number);
    const month_name_th = `${monthNamesTH[month - 1]} ${year + 543}`;

    // 4) ผลลัพธ์คงโครงสร้างเดิม แต่ใส่ค่า 0/ค่าว่าง (เพราะยังไม่มีข้อมูลพลังงานรายชั้น)
    // - total_rows = 0
    // - floors = [] (หรือจะใส่โครงชั้นพร้อมค่า 0 ก็ได้ในอนาคต)
    return res.json({
      month_used: prevKey,          // เช่น "2025-09"
      month_name_th,                // เช่น "กันยายน 2568"
      total_rows: 0,                // ยังไม่มีข้อมูล => 0
      floors: []                    // ยังไม่มีข้อมูลรายชั้น => แสดงเป็นลิสต์ว่าง
      // ตัวอย่างอนาคต: [{ floor: "1", total_waste_kg: 0 }, ...]
    });
  } catch (err) {
    console.error("[/carbonfootpint-floors] ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get("/energy-latest_four-quarterly", async (req, res) => {
  try {
    const { gid } = req.query; // ยังเก็บไว้เผื่อใช้ในอนาคต

    // 🔹 Helper functions
    const q = (m) => Math.floor((m - 1) / 3) + 1; // 1..4
    const qKey = (d) => `Q${q(d.getMonth() + 1)}/${d.getFullYear()}`;
    const prevQ = ({ q: qq, y }) => (qq > 1 ? { q: qq - 1, y } : { q: 4, y: y - 1 });
    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // 🔹 กำหนด 4 ไตรมาสล่าสุดอิงจากวันปัจจุบัน
    const now = new Date();
    const latest = { q: q(now.getMonth() + 1), y: now.getFullYear() };
    const list = [latest, prevQ(latest), prevQ(prevQ(latest)), prevQ(prevQ(prevQ(latest)))].reverse();
    const keys = list.map(({ q, y }) => `Q${q}/${y}`);

    // 🔹 สร้างรายชื่อเดือนในแต่ละไตรมาส
    const monthsOfQuarter = (quarter, year) => {
      const startMonthIdx = (quarter - 1) * 3;
      return [0, 1, 2].map((offset) => {
        const d = new Date(year, startMonthIdx + offset, 1);
        return monthKey(d);
      });
    };

    // 🔹 สร้างข้อมูลสรุป (ค่าเริ่มต้น = 0)
    const summary = keys.reduce((o, keyStr, idx) => {
      const { q: qq, y } = list[idx];
      o[keyStr] = {
        months_included: monthsOfQuarter(qq, y),
        lighting_system: 0,            // ✅ ระบบแสงสว่าง
        air_conditioning_system: 0,    // ✅ ระบบปรับอากาศ
        other_electrical_systems: 0    // ✅ ระบบไฟฟ้าอื่นๆ
      };
      return o;
    }, {});

    // 🔹 ส่งผลลัพธ์กลับ
    return res.json({ quarterly_summary: summary });
  } catch (err) {
    console.error("[/energy-latest_four-quarterly] ERROR:", err);
    res.status(500).json({ error: `Server error: ${String(err.message || err)}` });
  }
});


/**
 * @route GET /energy-eui
 * @desc แสดง "ค่าความเข้มการใช้พลังงาน (EUI: Energy Use Intensity)"
 *
 * สูตรคำนวณ:
 *     EUI = พลังงานที่ใช้ทั้งหมด (kWh) ÷ พื้นที่อาคาร (m²)
 *
 * หน่วย:
 *     kWh/m² ต่อเดือน
 *
 * หมายเหตุ:
 *     ปัจจุบันยังไม่มีข้อมูลจริง จึงใส่ค่าเริ่มต้นเป็น 0
 */
router.get("/energy-eui", async (req, res) => {
  try {
    // 1️⃣ วันที่ปัจจุบัน
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth(); // 0-based
    const month_key = monthKey(now);   // ใช้ helper เดิม

    // 2️⃣ ดึงชื่อเดือนภาษาไทยจาก monthNamesTH (helper)
    const month_name_th = monthNamesTH[monthIndex] || "";

    // 3️⃣ ค่าพื้นฐาน (ยังไม่มีข้อมูลจริง)
    const building_area_m2 = 0; // พื้นที่อาคารรวม (m²)
    const total_energy_kwh = 0; // พลังงานไฟฟ้าที่ใช้ทั้งหมด (kWh)
    const eui_kwh_per_m2 =
      building_area_m2 > 0 ? total_energy_kwh / building_area_m2 : 0;

    // 4️⃣ สร้างผลลัพธ์
    const eui_report = {
      year,
      month_name_th,
      building_area_m2,
      total_energy_kwh,
      eui_kwh_per_m2,
    //   note: "EUI = Total Energy (kWh) ÷ Building Area (m²)"
    };

    // 5️⃣ ส่งผลลัพธ์กลับ
    return res.json({ eui_report });
  } catch (err) {
    console.error("[/energy-eui] ERROR:", err);
    res
      .status(500)
      .json({ error: `Server error: ${String(err.message || err)}` });
  }
});


/**
 * @route GET /energy-yearly-comparison
 * @desc เปรียบเทียบการใช้พลังงานรายเดือน ปีปัจจุบันเทียบกับปีก่อนหน้า
 *
 * หมายเหตุ:
 * - ไม่มี difference และ percent_change อีกต่อไป
 * - econ ใช้แทนเป้าหมายรวม (131177.0)
 */
router.get("/energy-yearly-comparison", async (req, res) => {
  try {
    const round1 = (n) => Math.round(n * 10) / 10;
    const pad2 = (n) => String(n).padStart(2, "0");
    const monthStartEpochBKK = (year, monthIndex0) => {
      const iso = `${year}-${pad2(monthIndex0 + 1)}-01T00:00:00+07:00`;
      return Math.floor(new Date(iso).getTime() / 1000);
    };

    const now = new Date();
    const currentYear = now.getFullYear();
    const prevYear = currentYear - 1;
    const currentMonthIndex = now.getMonth();

    // 🔹 ข้อมูลจำลอง (คุณสามารถเชื่อมข้อมูลจริงได้ภายหลัง)
    const mockLastYear = [
      137571, 134294, 146991, 137148, 146681, 133828,
      135507.9, 145008, 138121, 132131.8, 0, 0
    ];
    const mockCurrentYear = [
      113941.4, 121612.1, 135974, 156997.1, 141046.5, 126615,
      65848.5, 148453, 94997.5, 154559, 0, 0
    ];

    // 🎯 เป้าหมายรวม
    const ECON_TARGET = 131177.0;

    // 🔹 Map เดือนต่อเดือน
    const energy_yearly_comparison = [];
    for (let m = 0; m <= currentMonthIndex; m++) {
      const ts = monthStartEpochBKK(currentYear, m);
      const lastVal = mockLastYear[m] ?? 0;
      const currVal = mockCurrentYear[m] ?? 0;

      energy_yearly_comparison.push({
        month_name_th: monthNamesTH[m],
        timestamp: ts,
        last_year_energy_used: round1(lastVal),
        current_year_energy_used: round1(currVal)
      });
    }

    // ✅ ส่งผลลัพธ์กลับ
    return res.json({
      energy_yearly_comparison,
      econ: ECON_TARGET
    });
  } catch (err) {
    console.error("[/energy-yearly-comparison] ERROR:", err);
    res
      .status(500)
      .json({ error: `Server error: ${String(err.message || err)}` });
  }
});


router.get("/energy-solar", async (req, res) => {
    return res.json({
        solar_energy_generated_kwh: 0,
        solar_energy_unit: "kWh",
        current_month: "",
    });
});

/**
 * @route GET /widget
 * @desc ส่งข้อมูลการ์ดสรุปพลังงาน 3 ใบสำหรับหน้าแดชบอร์ด ตามภาพตัวอย่าง
 *
 * โครงสร้างข้อมูล:
 * {
 *   key: "building" | "hvac" | "lighting",
 *   title_th: "พลังงานรวมทั้งอาคาร" | "พลังงานประเภทระบบปรับอากาศ" | "พลังงานประเภทระบบแสงสว่าง",
 *   value_kwh: number,
 *   value_display: string,
 *   unit: "kWh",
 *   change_percent: number,
 *   direction: "up" | "down" | "flat",
 *   compare_to_th: "จากปีที่แล้ว"
 * }
 */
router.get("/widget", async (req, res) => {
  try {
    const widgets = [
      {
        key: "building",
        title_th: "พลังงานรวมทั้งอาคาร",
        value_kwh: 1500621.3,
        value_display: "1,500,621.3",
        unit: "kWh",
        change_percent: 8.5,
        direction: "up",
        compare_to_th: "จากปีที่แล้ว"
      },
      {
        key: "hvac",
        title_th: "พลังงานประเภทระบบปรับอากาศ",
        value_kwh: 828305.9,
        value_display: "828,305.9",
        unit: "kWh",
        change_percent: 49.0,
        direction: "up",
        compare_to_th: "จากปีที่แล้ว"
      },
      {
        key: "lighting",
        title_th: "พลังงานประเภทระบบแสงสว่าง",
        value_kwh: 238225.7,
        value_display: "238,225.7",
        unit: "kWh",
        change_percent: 66.1,
        direction: "up",
        compare_to_th: "จากปีที่แล้ว"
      }
    ];

    return res.json({
      updated_at: new Date().toISOString(),
      widgets
    });
  } catch (err) {
    console.error("[/widget] ERROR:", err);
    res.status(500).json({
      error: `Server error: ${String(err.message || err)}`
    });
  }
});

export default router;