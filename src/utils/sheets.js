export function getSheetCsvUrl(gid) {
  const sheetId = process.env.SHEET_ID || "1D3tgkPFNRIQ0UoZMK6U2WGJEmxrba98lypwzD4J-kWc";
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  return typeof gid !== "undefined" ? `${base}&gid=${gid}` : base;
}