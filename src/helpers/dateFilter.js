// helpers/dateFilter.js

export const monthNamesTH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

/**
 * แปลง Date → คีย์เดือนแบบ "YYYY-MM"
 */
export function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * หาคีย์เดือนก่อนหน้า (เช่น prevMonth(2025, 3) -> { y:2025, m:2 })
 */
export function prevMonth(y, m) {
  if (m > 1) return { y, m: m - 1 };
  return { y: y - 1, m: 12 };
}

/**
 * หาชุดเดือนล่าสุดที่มีข้อมูลจริง (จำนวน k เดือน)
 * - ใช้ maxDate เป็นฐาน แล้วไล่ย้อนกลับ
 * - คืนค่าเป็น Set(["YYYY-MM", "YYYY-MM"])
 */
export function latestDistinctMonthsSet(rows, k = 2) {
  const presentMonths = new Set();
  let maxDate = null;

  for (const r of rows) {
    if (!r?.date) continue;
    const d = new Date(r.date);
    if (isNaN(d)) continue;
    presentMonths.add(monthKey(d));
    if (!maxDate || d > maxDate) maxDate = d;
  }

  if (!maxDate) return new Set();

  const wanted = new Set();
  let cy = maxDate.getFullYear();
  let cm = maxDate.getMonth() + 1;

  // ไล่ย้อนสูงสุดไม่เกิน 24 เดือน
  for (let i = 0; i < 24 && wanted.size < k; i++) {
    const key = `${cy}-${String(cm).padStart(2, "0")}`;
    if (presentMonths.has(key)) wanted.add(key);
    ({ y: cy, m: cm } = prevMonth(cy, cm));
  }
  return wanted;
}

/**
 * กรอง rows ให้เหลือเฉพาะเดือนที่อยู่ใน monthsSet (เช่น Set(["2025-05","2025-06"]))
 */
export function filterRowsByMonths(rows, monthsSet) {
  if (!monthsSet || monthsSet.size === 0) return [];
  return rows.filter((r) => {
    if (!r?.date) return false;
    const d = new Date(r.date);
    if (isNaN(d)) return false;
    return monthsSet.has(monthKey(d));
  });
}
