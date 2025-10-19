
import { fetchWastedRows } from "./wastedFetcher.js";

const CACHE = Object.create(null);
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 วัน

export async function fetchWastedRowsCached({ sheetId, gid, month, year } = {}) {
  const sid = sheetId || process.env.SHEET_ID;
  const key = `${sid}|${gid || "default"}`;
  const now = Date.now();

  // ✅ ถ้ามีใน cache และยังไม่หมดอายุ
  if (CACHE[key] && now - CACHE[key].fetchedAt < TTL_MS) {
    console.log("♻️ Using cached data");
    return { fetchedAt: CACHE[key].fetchedAt, rows: CACHE[key].rows, cached: true };
  }

  // 🔄 ดึงใหม่จาก Google Sheet
  const rows = await fetchWastedRows({ sheetId, gid, month, year });

  // ✅ เก็บใน cache
  CACHE[key] = { rows, fetchedAt: now };

  return { rows, cached: false, fetchedAt: now };
}

// ต้องทำ clear cache ด้วย
// export function clearWastedCache({ gid } = {}) {
//   // ...
// }    