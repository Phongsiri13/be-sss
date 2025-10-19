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


router.get("/carbonfootpint-floors", async (req, res) => {
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


// display 12 monthly printing data
/**
 * @route GET /monthly-printing
 * @desc ดึงข้อมูลสรุปการปล่อยก๊าซเรือนกระจก (GHG Emission)
 *       รายเดือนจากขยะและพลังงาน ย้อนหลัง 12 เดือน + เดือนปัจจุบัน
 * @returns JSON object ที่มี monthly_emission_report + emission_factors
 * @example
 * {
 *   "monthly_emission_report": [...],
 *   "emission_factors": {
 *     "energy_factor_kgco2e_per_kwh": 0.4999,
 *     "waste_factor_kgco2e_per_kg": 2.3200,
 *     "data_source_reference": "องค์การบริหารจัดการก๊าซเรือนกระจก (อบก.) มีนาคม 2567"
 *   }
 * }
 */
router.get("/monthly-printing", async (req, res) => {
  try {
    const { gid } = req.query;
    console.log("[monthly-printing] gid =", gid);

    // 1️⃣ ดึงข้อมูลจาก Google Sheet (ผ่าน cache)
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);
    if (!rows.length) {
      return res.json({
        monthly_emission_report: [],
        emission_factors: {
          energy_factor_kgco2e_per_kwh: 0.4999,
          waste_factor_kgco2e_per_kg: 2.3200,
          data_source_reference: "องค์การบริหารจัดการก๊าซเรือนกระจก (อบก.) มีนาคม 2567"
        }
      });
    }

    // 2️⃣ Helper สำหรับแปลงค่าเป็นตัวเลข
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };

    // 3️⃣ สร้างรายการ 12 เดือนย้อนหลัง + เดือนปัจจุบัน (รวม 13 เดือน)
    const now = new Date();
    const monthsList = [];
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsList.push(monthKey(dt));
    }

    // 4️⃣ สร้าง Map สำหรับเก็บค่าคาร์บอนรายเดือน
    const accMap = new Map(monthsList.map((m) => [m, 0]));

    // 5️⃣ รวมค่า carbon_emission_kgco2e ต่อเดือน
    for (const r of rows) {
      if (!r?.date) continue;
      const d = new Date(r.date);
      if (isNaN(d)) continue;

      const key = monthKey(d);
      if (!accMap.has(key)) continue;

      const carbon = num(r.carbon_emission_kgco2e);
      accMap.set(key, accMap.get(key) + carbon);
    }

    // 6️⃣ สร้างผลลัพธ์รายเดือน
    const monthly_emission_report = monthsList.map((key) => {
      const [year, month] = key.split("-").map(Number);
      const month_name_th = monthNamesTH[month - 1];
      const carbon = accMap.get(key) || 0;

      return {
        month_name_th, // เช่น "พฤศจิกายน"
        year,          // เช่น 2024
        carbon_emission_kgco2e: Math.round(carbon * 10) / 10,
        energy_emission_kgco2e: 0 // ค่า placeholder
      };
    });

    // 7️⃣ ค่าการปล่อยก๊าซเรือนกระจก (Emission Factors)
    const emission_factors = {
      energy_factor_kgco2e_per_kwh: 0.4999, // พลังงานไฟฟ้า (กก.CO₂e/หน่วยไฟ)
      waste_factor_kgco2e_per_kg: 2.3200,   // ขยะ (กก.CO₂e/กก.)
      data_source_reference:
        "องค์การบริหารจัดการก๊าซเรือนกระจก (อบก.) มีนาคม 2567"
    };

    // 8️⃣ ส่งผลลัพธ์กลับ
    return res.json({
      emission_factors,
      monthly_emission_report
    });
  } catch (err) {
    console.error("[monthly-printing] ERROR:", err);
    res.status(500).json({
      error: `Server error: ${String(err.message || err)}`
    });
  }
});


/**
 * @route GET /carbon-reduction-info
 * @desc ข้อมูลการลดการปล่อยคาร์บอน (เทียบเดือนปัจจุบันกับเดือนก่อนหน้า)
 *
 * นิยาม/สูตร:
 * - อัตราการปล่อยคาร์บอน (เปอร์เซ็นต์การเปลี่ยนแปลง) =
 *   (คาร์บอนเดือนนี้ - คาร์บอนเดือนที่แล้ว) / คาร์บอนเดือนที่แล้ว * 100
 *   ใช้บอกว่าเดือนนี้ "เพิ่มขึ้น/ลดลง" เมื่อเทียบเดือนก่อน
 *
 * - ต้นไม้ทดแทน (ต้น) = |คาร์บอนที่เพิ่มขึ้นหรือลดลง (kgCO2e)| / 9.5
 *   (อ้างอิง 9.5 kgCO2e/ต้น จากข้อมูลวิจัยของ องค์การบริหารจัดการก๊าซเรือนกระจก (อบก.) มี.ค. 67)
 *
 * ผลลัพธ์ถูกจัดตามหัวข้อที่ร้องขอ:
 * 1) อัตราการปล่อยคาร์บอน → “ลดลง 2 ค่า” = change_kgco2e และ percent_change
 * 2) เทียบเท่าการปลูกต้นไม้ทดแทน → “ลดลง 1 ค่า” = trees_equivalent พร้อม factor อ้างอิง
 */
router.get("/carbon-reduction-info", async (req, res) => {
  try {
    const { gid } = req.query;

    // 1) ดึงข้อมูล (ผ่าน cache)
    const fetched = await fetchWastedRowsCached({ gid });
    const rows = Array.isArray(fetched) ? fetched : (fetched?.rows ?? []);

    // helper: แปลงเลข
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    const round1 = (x) => Math.round(x * 10) / 10;

    // 2) สร้างเดือน "ปัจจุบัน" และ "เดือนก่อนหน้า" ตามปฏิทิน (แม้ไม่มีข้อมูลให้ถือว่า = 0)
    const now = new Date();
    const currKey = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));         // YYYY-MM
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));     // YYYY-MM

    // 3) รวมคาร์บอนต่อเดือน จากฟิลด์ carbon_emission_kgco2e
    let currCarbon = 0;
    let prevCarbon = 0;
    for (const r of rows) {
      if (!r?.date) continue;
      const d = new Date(r.date);
      if (isNaN(d)) continue;
      const key = monthKey(d);
      const c = num(r.carbon_emission_kgco2e);
      if (key === currKey) currCarbon += c;
      if (key === prevKey) prevCarbon += c;
    }

    // 4) คำนวณการเปลี่ยนแปลง
    const change_kgco2e = round1(currCarbon - prevCarbon); // ค่าที่ "ลดลง/เพิ่มขึ้น"
    const percent_change =
      prevCarbon === 0 ? null : round1(((currCarbon - prevCarbon) / prevCarbon) * 100);
    const direction = change_kgco2e > 0 ? "up" : change_kgco2e < 0 ? "down" : "flat";

    // 5) เทียบเท่าการปลูกต้นไม้ทดแทน (ใช้ค่าสัมบูรณ์ของการเปลี่ยนแปลง)
    const TREE_FACTOR = 9.5; // kgCO2e/ต้น (อบก. มี.ค. 67)
    const trees_equivalent = round1(Math.abs(change_kgco2e) / TREE_FACTOR);

    // 6) ชื่อเดือนภาษาไทย
    const [prevY, prevM] = prevKey.split("-").map(Number);
    const [currY, currM] = currKey.split("-").map(Number);
    const previous_month_name_th = `${monthNamesTH[prevM - 1]} ${prevY + 543}`;
    const current_month_name_th  = `${monthNamesTH[currM - 1]} ${currY + 543}`;

    // 7) จัดรูปผลลัพธ์ตามหัวข้อที่ระบุ
    const payload = {
      period: {
        months_used: [prevKey, currKey],
        previous_month_name_th,
        current_month_name_th,
        previous_month_carbon_kgco2e: round1(prevCarbon),
        current_month_carbon_kgco2e: round1(currCarbon),
      },

      // 1) อัตราการปล่อยคาร์บอน (ลดลง 2 ค่า: kgCO2e และ %)
      carbon_emission_rate: {
        change_kgco2e,     // คาร์บอนที่เปลี่ยนแปลง (ค่าบวก=เพิ่มขึ้น / ค่าลบ=ลดลง)
        percent_change,    // % การเปลี่ยนแปลงเทียบเดือนก่อน (null ถ้าเดือนก่อน = 0)
        direction          // "up" | "down" | "flat"
      },

      // 2) เทียบเท่าการปลูกต้นไม้ทดแทน (ลดลง 1 ค่า: จำนวนต้นไม้)
      trees_replacement_equivalent: {
        trees_equivalent,           // จำนวนต้นไม้ที่ต้องปลูกทดแทนตามการเปลี่ยนแปลงคาร์บอน
        per_tree_factor_kgco2e: TREE_FACTOR, // 9.5 kgCO2e/ต้น
        reference: "องค์การบริหารจัดการก๊าซเรือนกระจก (อบก.), มีนาคม 2567"
      }
    };

    return res.json(payload);
  } catch (err) {
    console.error("[/carbon-reduction-info] ERROR:", err);
    res.status(500).json({ error: `Server error: ${String(err.message || err)}` });
  }
});


export default router;
