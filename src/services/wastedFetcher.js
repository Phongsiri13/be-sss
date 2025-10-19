// src/services/wastedFetcher.js
import { TH_TO_EN_KEYS } from "./mappings.js";

function toIsoDate(dmy) {
  if (!dmy) return "";
  const [d, m, y] = String(dmy).split("/");
  if (!d || !m || !y) return dmy;
  const iso = new Date(Number(y), Number(m) - 1, Number(d));
  if (isNaN(iso)) return dmy;
  const pad = (n) => String(n).padStart(2, "0");
  return `${iso.getFullYear()}-${pad(iso.getMonth() + 1)}-${pad(iso.getDate())}`;
}

function toNum(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeRowThai(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const nk = TH_TO_EN_KEYS[k] || k;
    out[nk] = v;
  }

  // 🔹 แปลงวันที่
  if (out.date) out.date = toIsoDate(out.date);

  // 🔹 แปลง floor เป็นตัวเลข
  if (out.floor !== undefined) out.floor = toNum(out.floor);

  // 🔹 แปลงฟิลด์ตัวเลข
  const numFields = [
    "general_waste_kg", // ขยะทั่วไป
    "organic_waste_kg", // ขยะอินทรีย์
    "recycle_waste_kg", // ขยะรีไซเคิล
    "hazardous_waste_kg", // ขยะอันตราย
    "total_waste_kg", // รวมขยะทั้งหมด
    "landfill_waste_kg", // รวมขยะฝังกลบ
    "carbon_emission_kgco2e", // คาร์บอน (kgCO2e/kg)
  ];
  numFields.forEach((f) => {
    if (out[f] !== undefined) out[f] = toNum(out[f]);
  });

  // 🔹 ตรวจว่าชั้นเป็น “รวม” หรือไม่ (ตัดออก)
  const floorRaw = String(row["ชั้นที่"] || "").trim();
  if (floorRaw === "รวม" || floorRaw.toUpperCase() === "ALL" || floorRaw === "0") {
    return null; // ❌ ตัดแถวที่ชั้น = รวม
  }

  // 🔹 ตรวจว่าเป็นแถวว่างหรือไม่ (ข้อมูลทุกช่องเป็น 0 หรือว่าง)
  const isEmpty =
    (!out.date || out.date === "") &&
    (!out.submitted_by || out.submitted_by === "") &&
    (out.floor === 0 || out.floor === "") &&
    numFields.every((f) => (out[f] ?? 0) === 0);

  if (isEmpty) {
    return null; // ❌ แถวว่างทั้งหมด
  }

  return out; // ✅ คืนค่าปกติ
}

/**
 * Fetches waste management data from a Google Sheet and converts it to JSON format.
 *
 * This function will:
 *  - Fetch CSV data from Google Sheets via the export link
 *  - Convert Thai column names to English (e.g. "วัน/เดือน/ปี" → "date")
 *  - Convert data types such as dates → ISO format, numeric strings → numbers
 *  - Remove empty rows or rows where "floor" equals "รวม" (total)
 *  - Optionally filter the results by a specific month and year
 *
 * @async
 * @function fetchWastedRows
 * @param {Object} [options={}] - Optional parameters
 * @param {string} [options.sheetId] - The Google Sheet ID (e.g. `"1D3tgkPFNRIQ0UoZMK6U2WGJEmxrba98lypwzD4J-kWc"`).
 * If not provided, the function will use the value from `process.env.SHEET_ID`.
 * @param {string|number} [options.gid] - The sheet tab ID (gid) within the spreadsheet. If omitted, the first tab will be used.
 * @param {string|number} [options.month] - Month to filter (e.g. `8` for August).
 * @param {string|number} [options.year] - Year to filter (e.g. `2025`).
 *
 * @returns {Promise<Array<Object>>} A JSON array of cleaned and normalized waste data.
 *
 * @example
 * // 🔹 Fetch all data
 * const allRows = await fetchWastedRows();
 *
 * // 🔹 Fetch data from a specific tab
 * const tabRows = await fetchWastedRows({ gid: "123456789" });
 *
 * // 🔹 Fetch only data for September 2025
 * const septRows = await fetchWastedRows({ month: 9, year: 2025 });
 */
export async function fetchWastedRows({ sheetId, gid, month, year } = {}) {
  // ------------------------------------------------------------------
  // 1) เตรียม URL สำหรับดึง CSV จาก Google Sheets
  // ------------------------------------------------------------------
  const sid = sheetId || process.env.SHEET_ID;
  if (!sid) throw new Error("Missing SHEET_ID");

  const base = `https://docs.google.com/spreadsheets/d/${sid}/export?format=csv`;
  const url = gid ? `${base}&gid=${gid}` : base;

  // ------------------------------------------------------------------
  // 2) ดึงไฟล์ CSV จาก Google Sheets
  // ------------------------------------------------------------------
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google Sheet error: ${resp.status}`);

  const text = await resp.text();

  // ------------------------------------------------------------------
  // 3) แปลง CSV เป็น array ของบรรทัด
  // ------------------------------------------------------------------
  const lines = text.trim().split("\n").filter(Boolean);
  if (!lines.length) return [];

  // ------------------------------------------------------------------
  // 4) ตัวช่วย: แยกค่าจาก 1 บรรทัด CSV อย่างถูกต้อง
  //    - รองรับค่าที่อยู่ในเครื่องหมายอัญประกาศ ("…")
  //    - รองรับการมีคอมมาภายในค่า เช่น "1,406.75"
  // ------------------------------------------------------------------
  const parseCSVLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  // ------------------------------------------------------------------
  // 5) อ่านหัวตารางจากบรรทัดแรก และแปลงข้อมูลทุกบรรทัดให้เป็น Object
  // ------------------------------------------------------------------
  const headers = parseCSVLine(lines[0]);
  let rows = lines
    .slice(1)
    .map((line) => {
      const values = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => (obj[h] = (values[i] ?? "").trim()));
      return normalizeRowThai(obj);
    })
    .filter(Boolean);

  // ------------------------------------------------------------------
  // 6) ตัวช่วย: แปลงค่าที่เป็น “เลขมีคอมมา” → ทศนิยม (float)
  //    - "1,406.75" → 1406.75
  //    - "2,500" → 2500
  //    - "" / null / undefined / NaN → 0
  // ------------------------------------------------------------------
  const toFloat = (v) => {
    const cleaned = String(v ?? "").replace(/,/g, "").trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  // ------------------------------------------------------------------
  // 7) รายชื่อฟิลด์ตัวเลขที่ต้องแปลงเป็น “ทศนิยม”
  // ------------------------------------------------------------------
  const NUM_FIELDS = [
    "floor",
    "general_waste_kg",
    "organic_waste_kg",
    "recycle_waste_kg",
    "hazardous_waste_kg",
    "total_waste_kg",
    "landfill_waste_kg",
    "carbon_emission_kgco2e" // ✅ เหลือเฉพาะฟิลด์นี้
  ];

  // ------------------------------------------------------------------
  // 8) แปลงค่าทั้งหมดในแต่ละแถวให้เป็นทศนิยมตามฟิลด์ข้างบน
  // ------------------------------------------------------------------
  rows = rows.map((r0) => {
    const r = { ...r0 };
    for (const f of NUM_FIELDS) {
      if (f in r) r[f] = toFloat(r[f]);
    }
    return r;
  });

  // ------------------------------------------------------------------
  // 9) กรองทิ้งแถวที่เป็น “รวม” หรือแถวว่าง
  // ------------------------------------------------------------------
  rows = rows.filter((r) => {
    const isTotal =
      String(r.floor).trim() === "รวม" ||
      String(r.floor).trim().toUpperCase() === "ALL";

    const isEmpty =
      (!r.date || r.date === "") &&
      (!r.submitted_by || r.submitted_by === "") &&
      (r.floor === 0 || r.floor === "") &&
      r.general_waste_kg === 0 &&
      r.organic_waste_kg === 0 &&
      r.recycle_waste_kg === 0 &&
      r.hazardous_waste_kg === 0 &&
      r.total_waste_kg === 0 &&
      r.landfill_waste_kg === 0 &&
      r.carbon_emission_kgco2e === 0;

    return !isTotal && !isEmpty;
  });

  // ------------------------------------------------------------------
  // 10) กรองเฉพาะเดือนและปี (ถ้ามี)
  // ------------------------------------------------------------------
  if (month && year) {
    rows = rows.filter((r) => {
      if (!r.date) return false;
      const d = new Date(r.date);
      return (
        d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year)
      );
    });
  }

  // ------------------------------------------------------------------
  // 11) คืนผลลัพธ์ทั้งหมด (ข้อมูลพร้อมใช้งาน)
  // ------------------------------------------------------------------
  return rows;
}




