// routes/report.js
import express from "express";
import fs from "fs";
import path from "path";
import PdfPrinter from "pdfmake";
import { fileURLToPath } from "url";

// ✅ ECharts SSR (ใช้ในไฟล์นี้ไฟล์เดียว)
import { init, use } from "echarts/core";
import { BarChart } from "echarts/charts";
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { LegacyGridContainLabel } from "echarts/features"; // แก้เตือน containLabel
import { Resvg } from "@resvg/resvg-js";
// ✅ เพิ่มบรรทัด import นี้ไว้ด้านบนไฟล์ (ร่วมกับ import อื่น ๆ)
import puppeteer from "puppeteer";


// หาไฟล์ dist ที่ถูกต้องจาก node_modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ ใช้ import.meta.resolve หาไฟล์ ECharts ใน node_modules
const echartsUrl = await import.meta.resolve("echarts/dist/echarts.min.js");
const echartsPath = fileURLToPath(echartsUrl);

// ✅ อ่านไฟล์
const echartsJs = fs.readFileSync(echartsPath, "utf8");

console.log("โหลด echarts สำเร็จจาก:", echartsPath);



// ลงทะเบียนโมดูลครั้งเดียว
use([BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, SVGRenderer, LegacyGridContainLabel]);

const router = express.Router();

/* -----------------------------
 * 0) Paper Utilities (ISO A-series, Thai = A4)
 * ----------------------------- */
const ISO_A_MM = {
    A3: { w: 297, h: 420 },
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
};

const PT_PER_MM = 72 / 25.4; // mm -> pt
const PX_PER_MM = 3.78;      // mm -> px (สำหรับ ECharts)

function makePaperCtx({
    pageSize = "A4",
    pageOrientation = "portrait",
    marginsMm = [25, 25, 25, 25], // [L, T, R, B] ตามมาตรฐานไทยนิยม
} = {}) {
    const base = ISO_A_MM[pageSize] || ISO_A_MM.A4;
    const isLandscape = pageOrientation === "landscape";
    const pageWidthMm = isLandscape ? base.h : base.w;
    const pageHeightMm = isLandscape ? base.w : base.h;

    const [ml, mt, mr, mb] = marginsMm;
    const innerWidthMm = pageWidthMm - ml - mr;
    const innerHeightMm = pageHeightMm - mt - mb;

    return {
        pageSize,
        pageOrientation,
        marginsMm,
        pageWidthMm,
        pageHeightMm,
        innerWidthMm,
        innerHeightMm,
        mm: (v) => v * PT_PER_MM,             // mm -> pt
        px: (v) => Math.round(v * PX_PER_MM), // mm -> px
        marginsPt: [ml, mt, mr, mb].map((m) => m * PT_PER_MM),
    };
}

/* -----------------------------
 * 1) Fonts
 * ----------------------------- */
const FONT_PATHS = {
    regular: path.join(process.cwd(), "public", "fonts", "THSarabunNew.ttf"),
    bold: path.join(process.cwd(), "public", "fonts", "THSarabunNew Bold.ttf"),
    italic: path.join(process.cwd(), "public", "fonts", "THSarabunNew Italic.ttf"),
    boldItalic: path.join(process.cwd(), "public", "fonts", "THSarabunNew BoldItalic.ttf"),
};

const printer = new PdfPrinter({
    THSarabunNew: {
        normal: FONT_PATHS.regular,
        bold: FONT_PATHS.bold,
        italics: FONT_PATHS.italic,
        bolditalics: FONT_PATHS.boldItalic,
    },
});

/* -----------------------------
 * 4) Route
 * ----------------------------- */
// ✅ เพิ่ม route ใหม่ (วางต่อท้ายไฟล์ได้เลย โดย "ไม่ต้องลบ" route เดิม)
router.get("/generate-full-report", async (req, res) => {
    let browser;
    try {
        // ใช้บริบทกระดาษเดิมของโปรเจกต์คุณ
        const paperCtx = makePaperCtx({
            pageSize: "A4",
            pageOrientation: "portrait",
            marginsMm: [25, 25, 25, 25],
        });

        // ฝังฟอนต์ TH Sarabun New (4 ไฟล์) แบบ base64 เพื่อให้รองรับสระ/วรรณยุกต์ไทย 100%
        const fontRegBase64 = fs.readFileSync(FONT_PATHS.regular).toString("base64");
        const fontBoldBase64 = fs.readFileSync(FONT_PATHS.bold).toString("base64");
        const fontItBase64 = fs.readFileSync(FONT_PATHS.italic).toString("base64");
        const fontBIBase64 = fs.readFileSync(FONT_PATHS.boldItalic).toString("base64");

        // ==== ข้อมูล/ตัวเลข จากไฟล์ PDF แนบ (อ้างอิง) ====
        // I. Summary
        const summaryParas = [
            "อาคารแสดงแนวโน้มเชิงบวกในด้านการปล่อยคาร์บอน โดยการใช้พลังงานเพิ่มขึ้น 18.8% เมื่อเทียบกับปี 2567",
            "การเกิดขยะโดยรวมลดลง 9.9% เมื่อเทียบกับเดือนมิถุนายน 2568 และการปล่อยคาร์บอนรวมลดลง 45.1% เมื่อเทียบกับเดือนมิถุนายน 2568",
            "คุณภาพอากาศยังคงอยู่ในระดับที่ควรปรับปรุงเล็กน้อยตลอดทั้งเดือน โดยค่าพารามิเตอร์ที่วัดผ่านกว่าเกณฑ์ที่แนะนำบางส่วน",
            "รายงานฉบับนี้จะนำเสนอข้อมูลตามหัวข้อที่ปรากฏในหน้า Dashboard ดังต่อไปนี้"
        ];

        // II. Energy Consumption
        const euiCurrent = 169.9; // kWh/m²-y (อยู่ระดับ BEC)
        const euiTargets = [
            { label: "REF", value: 219, color: "#e74c3c", textColor: "#fff" },
            { label: "BEC", value: 171, color: "#f1c40f", textColor: "#111" },
            { label: "HEPS", value: 141, color: "#2ea8df", textColor: "#fff" },
            { label: "ECON", value: 82, color: "#1f5ca8", textColor: "#fff" },
            { label: "ZEB", value: 57, color: "#b26ae2", textColor: "#fff" },
        ];

        // Energy by floor (ก.ค. 2568) — ตามย่อหน้าในไฟล์
        const energyByFloor = [
            { name: "B2", kwh: 29812.0 },
            { name: "B1", kwh: 8046.8 },
            { name: "1", kwh: 5078.8 },
            { name: "2", kwh: 4406.2 },
            { name: "3", kwh: 4244.0 },
            { name: "4", kwh: 3415.6 },
            { name: "5", kwh: 7164.9 },
            { name: "6", kwh: 2160.9 },
            { name: "Roof", kwh: 7463.2 },
        ];

        // Monthly energy 2567 vs 2568 (ใช้ placeholder เส้นจำนวนเดือนเพื่อแสดง layout + เส้นเป้าหมาย 131,177)
        // ถ้าคุณมีข้อมูลทั้งปีอยู่แล้วสามารถแทนที่ได้เลย
        const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const energy2024 = [120000, 118000, 122000, 130000, 110000, 98000, 105000, 0, 0, 0, 0, 0]; // ตัวอย่าง
        const energy2025 = [115000, 119000, 112000, 108000, 99000, 96000, 65848.5, 0, 0, 0, 0, 0]; // ก.ค. = 65,848.50
        const energyTarget = 131177; // เส้นเป้าหมายคงที่ (เส้นประสีส้ม)
        const solarJuly = 2306.7; // kWh

        // Quarterly by system (ไตรมาสที่ 3 ถึงปัจจุบัน)
        const energyQuarterCats = ["Q4/2024", "Q1/2025", "Q2/2025", "Q3/2025"];
        const seriesLight = [65434.5, 106008.5, 64463.6, 9674.2];
        const seriesHVAC = [153343.3, 306521.1, 231646.7, 41288.0];
        const seriesOthers = [187992.2, 151234.9, 139098.6, 20830.2];

        // “การเปรียบเทียบการใช้พลังงาน” (เพิ่มขึ้นเมื่อเทียบปีก่อน)
        const energyCompare = {
            total: 998973.4, // kWh (+18.8%)
            hvac: 538167.8, // kWh (+60.0%)
            light: 170472.1, // kWh (+100%)
        };

        // III. Waste
        const wasteByFloor = [
            { name: "B2", kg: 106 }, { name: "B1", kg: 106 }, { name: "1", kg: 1018 }, { name: "2", kg: 355 },
            { name: "3", kg: 176 }, { name: "4", kg: 552 }, { name: "5", kg: 271 }, { name: "6", kg: 100 }
        ];
        const wasteQuarterCats = ["Q1/2025", "Q2/2025", "Q3/2025", "Q4/2025"];
        // สมมติค่าบางเดือนเป็น 0 เพื่อโฟกัส “ไตรมาสล่าสุดมีค่า”: ทั่วไป 6,384 สูงสุด, อันตราย 0 ต่ำสุด (จากคำอธิบาย)
        const wasteGeneral = [4000, 6384, 0, 0];
        const wasteRecycle = [2000, 3200, 0, 0];
        const wasteOrganic = [1500, 1800, 0, 0];
        const wasteHazard = [0, 0, 0, 0];

        // “การเปรียบเทียบขยะที่เกิดขึ้น”
        const wasteCompare = {
            total_gpp: 5311.8, // กรัมต่อคน
            organic_gpp: 637.1,
            hazard_gpp: 0,
            landfill_down_pct: 9.9,
            cost_down_baht: 494.8,
        };

        const recycleRate = {
            july: 29.6, // %
            target: 5.0 // เส้นประ
        };

        // IV. Carbon
        const carbonByFloor = [
            { name: "B2", kg: 14599.7 }, { name: "B1", kg: 4028.3 }, { name: "1", kg: 2886.8 }, { name: "2", kg: 2522.1 },
            { name: "3", kg: 2269.3 }, { name: "4", kg: 2250.0 }, { name: "5", kg: 3777.0 }, { name: "6", kg: 1158.5 }, { name: "Roof", kg: 3624.9 }
        ];
        const carbonMonthlyCats = months;
        // ใส่ค่าคร่าว ๆ ให้ “ภาพรวม” ตรงใจความ: เม.ย. สูงสุด, ก.ค. ต่ำสุด (37195.60 รวม)
        const carbonEnergyMonthly = [50000, 52000, 54000, 60000, 48000, 45000, 31982.6, 0, 0, 0, 0, 0];
        const carbonWasteMonthly = [5000, 4800, 4600, 4300, 4200, 4100, 4584.3, 0, 0, 0, 0, 0];
        const carbonTotalJuly = 37195.6;

        const carbonCompare = {
            total: 36566.9,
            energy: 31982.6,
            waste: 4584.3,
            total_down_pct: 45.1,
            energy_down_pct: 48.0,
            waste_down_pct: 9.9,
        };
        const carbonReduce = {
            rate_down_pct: 43.1,
            trees_eq: 3195.6, // ต้น
            absorb_per_tree: 9.5 // kgCO2e/ปี
        };

        // V. Air Quality — ใช้การ์ดตัวชี้วัดตามข้อความ
        const air = [
            { name: "PM2.5", note: "อยู่ในเกณฑ์ดี" },
            { name: "PM10", note: "อยู่ในเกณฑ์ยอดเยี่ยม" },
            { name: "CO2", note: "อยู่ในเกณฑ์ยอดเยี่ยม" },
            { name: "ความชื้น", value: "74%", note: "ไม่ดีต่อกลุ่มเสี่ยง" },
            { name: "VOC", value: "73 ppb", note: "อยู่ในเกณฑ์ดี" },
        ];

        // เตรียม HTML: มี 3 หน้าเหมือนเดิม (page-break), ฝัง ECharts ที่หน้า 3
        // หมายเหตุ: ใช้ ECharts ผ่าน CDN; ถ้าสภาพแวดล้อมไม่มีเน็ต ให้เสิร์ฟไฟล์ echarts เองจาก public/
        const html = `
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8"/>
  <title>Monthly Report</title>
  <style>
  /* ฟอนต์ไทยแบบฝังในหน้า (base64) */
  @font-face {
    font-family: 'THSarabunNew';
    src: url(data:font/ttf;base64,${fontRegBase64}) format('truetype');
    font-weight: 400; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'THSarabunNew';
    src: url(data:font/ttf;base64,${fontBoldBase64}) format('truetype');
    font-weight: 700; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'THSarabunNew';
    src: url(data:font/ttf;base64,${fontItBase64}) format('truetype');
    font-weight: 400; font-style: italic; font-display: swap;
  }
  @font-face {
    font-family: 'THSarabunNew';
    src: url(data:font/ttf;base64,${fontBIBase64}) format('truetype');
    font-weight: 700; font-style: italic; font-display: swap;
  }

  html, body { margin: 0; padding: 0; }
  body { font-family: THSarabunNew, 'Noto Sans Thai', sans-serif; color: #111827; }

  /* A4 + margin 25mm ให้ตรงกับ pdfmake เดิม */
  @page {
    size: A4 portrait;
    margin: ${paperCtx.marginsMm[1]}mm ${paperCtx.marginsMm[2]}mm ${paperCtx.marginsMm[3]}mm ${paperCtx.marginsMm[0]}mm;
  }

  /* พื้นที่ใช้งาน A4 หลังหัก margin: ~247mm */
  :root { --page-inner-mm: 247mm; }

  /* โครงหน้า */
  .page { max-height: var(--page-inner-mm); }

  /* ระยะตัวอักษรทั่วไปให้กระชับ */
  .page p { margin: 0 0 3mm 0; font-size: 14pt; line-height: 1.15; }
  .page h1 { font-weight:700; font-size:22pt; text-align:center; margin:8mm 0 10mm; }
  .page h2 { font-weight:700; font-size:14pt; margin:0 0 3mm 0; }
  .page h3 { font-weight:700; font-size:13pt; margin:6mm 0 3mm 0; }

  /* รายการหัวข้อ */
  .page ul { padding-left:7mm; margin:0 0 8mm 0; font-size:13pt; line-height:1.05; }
  .page ul li { margin:0 0 2.2mm 0; }

  /* ป้องกันการตัดข้ามหน้า */
  /* --- Force 1 section = 1 page --- */
@media print {
  /* เริ่มหน้าใหม่ก่อนทุก .page */
  .page {
    display: block;
    break-before: page !important;         /* สมัยใหม่ */
    page-break-before: always !important;  /* fallback เก่า */
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    break-after: auto !important;
    page-break-after: auto !important;
  }
  /* ยกเว้นหน้าแรก ไม่ต้องขึ้นหน้าใหม่ก่อน */
  .page:first-of-type {
    break-before: auto !important;
    page-break-before: auto !important;
  }

  /* กันหัวข้อ/กล่องสำคัญไม่ให้ถูกตัด */
  h1, h2, h3,
  .chart, .chart-wrap, figure, table, .card, img {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
}

/* พื้นที่ใช้งานต่อหน้า A4 หลังหัก margin ~247mm */
:root { --page-inner-mm: 247mm; }
.page { max-height: var(--page-inner-mm); }

/* ปรับความสูงกราฟให้พอดี 1 หน้า (ถ้าหน้า 3) */
.page:nth-of-type(3) #chart-monthly { height: 80mm !important; }
.page:nth-of-type(3) #chart-system  { height: 70mm !important; }

/* รูปกราฟหน้า 2 ให้ไม่สูงเกินหน้า */
.page:nth-of-type(2) img[alt="กราฟการใช้พลังงานรายชั้น"] {
  max-height: 60mm; width: auto; height: auto;
}
</style>

</head>
<body>

  <!-- Page 1 -->
  <section class="page page1">
  <h1 style="font-weight:700;font-size:22pt;text-align:center;margin:8mm 0 10mm;">
    รายงานประจำเดือน - กรกฎาคม 2568
  </h1>

  <h2 style="font-weight:700;font-size:14pt;margin:0 0 4mm 0;">
    I. บทสรุปประจำเดือนกรกฎาคม 2568
  </h2>
  <p style="font-size:14pt;line-height:1.15;margin:0 0 2.8mm 0;">
    อาคารแสดงแนวโน้มเชิงบวกในด้านการปล่อยคาร์บอน โดยการใช้พลังงานเพิ่มขึ้น 18.8% เมื่อเทียบกับปี 2567
  </p>
  <p style="font-size:14pt;line-height:1.15;margin:0 0 2.8mm 0;">
    การเกิดขยะโดยรวมลดลง 9.9% เมื่อเทียบกับเดือนมิถุนายน 2568 และการปล่อยคาร์บอนรวมลดลง 45.1% เมื่อเทียบกับเดือนมิถุนายน 2568
  </p>
  <p style="font-size:14pt;line-height:1.15;margin:0 0 2.8mm 0;">
    คุณภาพอากาศยังคงอยู่ในระดับที่ดีมากตลอดทั้งเดือน โดยค่าพารามิเตอร์ที่วัดผ่านกว่าเกณฑ์ที่แนะนำทั้งหมด
  </p>

  <p style="font-size:14pt;line-height:1.15;margin:0 0 8mm 0;">
    รายงานฉบับนี้จะนำเสนอข้อมูลตามหัวข้อที่ปรากฏในหน้า Dashboard ดังต่อไปนี้
  </p>

  <h2 style="font-weight:700;font-size:14pt;margin:0 0 3mm 0;">
    II. การใช้พลังงาน (Energy Consumption)
  </h2>
  <ul style="padding-left:7mm;margin:0 0 8mm 0;font-size:13pt;line-height:1.05;">
    <li style="margin:0 0 2.2mm 0;">การใช้พลังงานภายใต้แต่ละระดับความสามารถในการอนุรักษ์พลังงาน</li>
    <li style="margin:0 0 2.2mm 0;">การใช้พลังงานรายเดือนแยกตามชั้นของอาคาร</li>
    <li style="margin:0 0 2.2mm 0;">การใช้พลังงานรวมของอาคารรายเดือนต่อปี</li>
    <li style="margin:0 0 2.2mm 0;">การใช้พลังงาน แยกตามระบบปรับอากาศ, แสงสว่าง และอื่น ๆ รายไตรมาส</li>
    <li style="margin:0 0 2.2mm 0;">การเปรียบเทียบการใช้พลังงาน</li>
  </ul>

  <h2 style="font-weight:700;font-size:14pt;margin:0 0 3mm 0;">
    III. การจัดการขยะ (Waste Management)
  </h2>
  <ul style="padding-left:7mm;margin:0 0 8mm 0;font-size:13pt;line-height:1.05;">
    <li style="margin:0 0 2.2mm 0;">ขยะที่เกิดขึ้นรายเดือนแยกตามชั้นของอาคาร</li>
    <li style="margin:0 0 2.2mm 0;">ขยะที่เกิดขึ้นของอาคารแยกตามประเภทต่อปี</li>
    <li style="margin:0 0 2.2mm 0;">การเปรียบเทียบขยะที่เกิดขึ้น</li>
    <li style="margin:0 0 2.2mm 0;">ข้อมูลการจัดการขยะ</li>
    <li style="margin:0 0 2.2mm 0;">อัตราขยะที่ถูกรีไซเคิลแล้ว</li>
  </ul>

  <h2 style="font-weight:700;font-size:14pt;margin:0 0 3mm 0;">
    IV. คาร์บอนฟุตพริ้นต์ (Carbon Footprint)
  </h2>
  <ul style="padding-left:7mm;margin:0 0 8mm 0;font-size:13pt;line-height:1.05;">
    <li style="margin:0 0 2.2mm 0;">คาร์บอนฟุตพริ้นต์รายชั้น</li>
    <li style="margin:0 0 2.2mm 0;">เปรียบเทียบคาร์บอนฟุตพรินต์รายเดือน</li>
    <li style="margin:0 0 2.2mm 0;">การเปรียบเทียบการปล่อยคาร์บอน</li>
    <li style="margin:0 0 2.2mm 0;">ข้อมูลการลดการปล่อยคาร์บอน</li>
  </ul>

  <h2 style="font-weight:700;font-size:14pt;margin:0;">
    V. คุณภาพอากาศ (Air Quality)
  </h2>
</section>

<!-- =======================
     PAGE 2 : ENERGY (ต่อจากหน้า 1)
======================= -->
<section class="page page2">
  <h2 style="font-weight:700;font-size:14pt;margin:0 0 3mm 0;">
    II. Energy Consumption
  </h2>

  <p style="font-size:14pt;line-height:1.15;margin:0 0 4mm 0;">
    การใช้พลังงานภายใต้แต่ละระดับความสามารถในการอนุรักษ์พลังงาน
  </p>

  <!-- กล่องกราฟ EUI -->
  <div style="border:1px solid #10a7b5;border-radius:8px;padding:8mm;margin:4mm 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4mm;">
      <p style="font-size:14pt;font-weight:700;margin:0;">ค่าความเข้มการใช้พลังงาน (EUI)</p>
      <div style="text-align:center;">
        <div style="font-size:22pt;font-weight:700;color:#0f766e;">169.9</div>
        <div style="font-size:12pt;color:#6b7280;">kWh/m²-y</div>
      </div>
    </div>

    <p style="font-size:12pt;margin:0 0 2mm 0;">since Jan 1, 2025</p>

    <div style="display:grid;grid-template-columns:24fr 20fr 18fr 16fr 22fr;margin-bottom:4mm;">
      <div style="background:#e74c3c;color:#fff;text-align:center;padding:6px 0;">REF</div>
      <div style="background:#f1c40f;color:#111;text-align:center;padding:6px 0;">BEC</div>
      <div style="background:#2ea8df;color:#fff;text-align:center;padding:6px 0;">HEPS</div>
      <div style="background:#1f5ca8;color:#fff;text-align:center;padding:6px 0;">ECON</div>
      <div style="background:#b26ae2;color:#fff;text-align:center;padding:6px 0;">ZEB</div>
    </div>

    <ol style="font-size:13pt;line-height:1.2;margin:0 0 4mm 6mm;color:#065f46;">
      <li>REF (219): อาคารอ้างอิง ใช้เป็นมาตรฐานเปรียบเทียบ</li>
      <li>BEC (171): ประสิทธิภาพต่ำสุด อาคารใช้พลังงานมาก</li>
      <li>HEPS (141): ดีขึ้นเล็กน้อย แต่ยังใช้พลังงานมาก</li>
      <li>ECON (82): ประสิทธิภาพสูงขึ้น ใช้พลังงานน้อยลง</li>
      <li>ZEB (57): ประสิทธิภาพสูงมาก ใช้พลังงานเกือบเป็นศูนย์</li>
    </ol>

    <p style="font-size:12pt;color:#0f766e;line-height:1.25;margin:0;">
      ภาพนี้แสดงค่าความเข้มการใช้พลังงาน (EUI) ของอาคารฯ ตั้งแต่วันที่ 1 มกราคม 2568 โดยค่าปัจจุบันของ EUI อาคารอยู่ที่ 169.9 kWh/m²-y ซึ่งอยู่ในระดับ BEC แสดงถึงการใช้พลังงานที่เป็นไปตามเกณฑ์ขั้นต่ำ แต่ยังมีโอกาสในการพัฒนาให้ดีขึ้น
      ด้วยค่ามาตรฐาน (171, 141, 82, 57) แสดงระดับประสิทธิภาพพลังงานต่าง ๆ ซึ่งชี้ให้เห็นว่าอาคารฯ ยังมีช่องว่างในการปรับปรุงการใช้พลังงานให้ประสิทธิภาพมากขึ้นได้อีก โดยเฉพาะเมื่อเปรียบเทียบกับระดับ HEPS, ECON และ ZEB
    </p>
  </div>

  <h3 style="font-weight:700;font-size:13pt;margin:6mm 0 3mm 0;">
    การใช้พลังงานรายเดือนแยกตามชั้นของอาคาร
  </h3>

  <!-- ภาพกราฟแทนรูป -->
  <div style="text-align:center;margin:4mm 0;">
    <img src="cid:energy_by_floor.png" alt="กราฟการใช้พลังงานรายชั้น" style="width:100%;max-width:180mm;">
  </div>

  <p style="font-size:14pt;line-height:1.15;margin:4mm 0 0 0;">
    รายงานการวิเคราะห์ค่าการใช้พลังงานรายเดือนของอาคาร ณ เดือนกรกฎาคม 2568 แสดงให้เห็นลักษณะการกระจายตัวของการใช้พลังงานที่แตกต่างกันของแต่ละชั้น โดยพบว่าชั้นล่างสุดของอาคาร (B2) มีการใช้พลังงานสูงสุดอยู่ที่ 29,812 kWh 
    ขณะที่ชั้น B1 ใช้พลังงาน 8,046.80 kWh ชั้น 1 ใช้พลังงาน 5,078.80 kWh ชั้น 2 ใช้พลังงาน 4,406.20 kWh ชั้น 3 ใช้พลังงาน 4,244 kWh 
    ชั้น 4 ใช้พลังงาน 3,415.60 kWh ชั้น 5 ใช้พลังงาน 7,164.90 kWh ชั้น 6 ใช้พลังงาน 2,160.90 kWh และชั้น Roof ใช้พลังงาน 7,463.20 kWh 
    ซึ่งอยู่ในพื้นที่ชั้นเปิดโล่งที่สามารถปรับปรุงประสิทธิภาพการใช้พลังงานได้
  </p>
</section>

<!-- =======================
     PAGE 3 : ENERGY (ต่อจากหน้า 2)
======================= -->
<section class="page">
  <h3>การใช้พลังงานรวมของอาคารรายเดือนต่อปี</h3>

  <!-- กล่องกราฟ 1 -->
  <div style="margin:4mm 0;">
    <div style="font-size:12pt;color:#374151;background:#F9FAFB;border:1px solid #E5E7EB;padding:4mm;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
      <span>การใช้พลังงานโดยเฉลี่ยต่อเดือนเทียบค่าเป้าหมายประจำปี</span>
      <span style="background:#fff3cd;border:1px solid #fde68a;padding:2mm 4mm;border-radius:6px;font-weight:bold;">2,306.70 kWh</span>
    </div>
    <div id="chart-monthly" style="width:100%;height:85mm;"></div>
  </div>

  <p>
    การใช้พลังงานรวมของอาคารรายเดือนในหน่วยกิโลวัตต์-ชั่วโมง (kWh)
    แสดงการเปรียบเทียบระหว่างปี 2567 (แท่งสีเหลือง) และ 2568 (แท่งสีเขียว)
    โดยเส้นประสีส้มแสดงเป้าหมายค่าเฉลี่ยรายเดือน 131,177 kWh ต่อเดือน (131,177 kWh คงที่ต่อปี)
    ที่สอดคล้องกับมาตรฐานการใช้พลังงานของอาคาร ซึ่งคำนวณจากค่าความเข้มการใช้พลังงาน (EUI) ที่ 141 kWh/m²-y
    ในเดือนกรกฎาคม มีการใช้พลังงาน 65,848.50 kWh โดยรวมแล้วมีเดือนที่ค่าใช้พลังงานต่ำกว่าค่าเป้าหมายเกินกว่าครึ่งของปี 
    ซึ่งเป็นสัญญาณบวก ความสามารถในการบริหารจัดการพลังงานของอาคารมีประสิทธิภาพมากขึ้นตามการประหยัดพลังงานที่ตั้งไว้
    นอกจากนี้อาคารยังมีการใช้พลังงานแสงอาทิตย์ประจำเดือนกรกฎาคม อยู่ที่ 2,306.70 kWh
  </p>

  <h3 style="margin-top:8mm;">การใช้พลังงานแยกตามระบบปรับอากาศ, แสงสว่าง และ อื่นๆ รายไตรมาส</h3>

  <!-- กล่องกราฟ 2 -->
  <div id="chart-system" style="width:100%;height:85mm;margin-top:4mm;"></div>

  <p>
    กราฟแสดงการใช้พลังงานแยกเป็น 3 ระบบหลัก ได้แก่ ระบบแสงสว่าง (สีส้ม),
    ระบบปรับอากาศ (ฟ้า) และ ระบบไฟฟ้าอื่นๆ (เขียว)
    ในหน่วยกิโลวัตต์-ชั่วโมง (kWh) ไตรมาสที่ 3 ถึงปัจจุบัน ระบบแสงสว่างมีการใช้พลังงาน 9,674.20 kWh 
    ระบบปรับอากาศมีการใช้พลังงาน 41,288 kWh และ ระบบไฟฟ้าอื่นๆ มีการใช้พลังงาน 20,830.20 kWh
  </p>
</section>


<!-- =======================
     PAGE 4 : ENERGY COMPARISON
======================= -->
<section class="page page4" style="break-inside:avoid; page-break-inside:avoid;">
  <h3 style="font-weight:700;font-size:13pt;margin:0 0 6mm 0;">การเปรียบเทียบการใช้พลังงาน</h3>

  <!-- กล่องสรุป 3 แถว -->
  <div style="border:1px solid #E5E7EB;border-radius:10px;padding:6mm; margin:0 0 6mm 0; break-inside:avoid;">
    <div style="font-weight:700;font-size:12pt;margin:0 0 4mm 0;">การเปรียบเทียบการใช้พลังงาน</div>

    <!-- แถว 1 : รวมทั้งอาคาร (เขียว) -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:#E6F4EA;border:1px solid #B7E0C2;border-radius:10px;padding:6mm 6mm;margin:0 0 3mm 0;">
      <div style="display:flex;align-items:center;gap:4mm;">
        <div style="width:22px;height:22px;border-radius:999px;background:#D1D5DB;display:flex;align-items:center;justify-content:center;font-size:12pt;">🏢</div>
        <div>
          <div style="font-size:11pt;color:#374151;">พลังงานรวมทั้งอาคาร</div>
          <div style="font-weight:700;font-size:12pt;">998,973.4 kWh</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2mm;background:#DCFCE7;border:1px solid #86EFAC;color:#065F46;border-radius:8px;padding:2mm 4mm;font-size:11pt;white-space:nowrap;">
        <span style="color:#DC2626;font-weight:700;">↑</span>
        <span style="font-weight:700;">เพิ่มขึ้น 18.8 %</span>
        <span style="color:#6B7280;">เทียบปีก่อน</span>
      </div>
    </div>

    <!-- แถว 2 : ระบบปรับอากาศ (ส้ม) -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:6mm 6mm;margin:0 0 3mm 0;">
      <div style="display:flex;align-items:center;gap:4mm;">
        <div style="width:22px;height:22px;border-radius:999px;background:#D1D5DB;display:flex;align-items:center;justify-content:center;font-size:12pt;">❄️</div>
        <div>
          <div style="font-size:11pt;color:#374151;">พลังงานในระบบปรับอากาศ</div>
          <div style="font-weight:700;font-size:12pt;">538,167.8 kWh</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2mm;background:#FFF7ED;border:1px solid #FDBA74;color:#92400E;border-radius:8px;padding:2mm 4mm;font-size:11pt;white-space:nowrap;">
        <span style="color:#DC2626;font-weight:700;">↑</span>
        <span style="font-weight:700;">เพิ่มขึ้น 60.0 %</span>
        <span style="color:#6B7280;">เทียบปีก่อน</span>
      </div>
    </div>

    <!-- แถว 3 : ระบบแสงสว่าง (ฟ้า) -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:#E0F2FE;border:1px solid #7DD3FC;border-radius:10px;padding:6mm 6mm;">
      <div style="display:flex;align-items:center;gap:4mm;">
        <div style="width:22px;height:22px;border-radius:999px;background:#D1D5DB;display:flex;align-items:center;justify-content:center;font-size:12pt;">💡</div>
        <div>
          <div style="font-size:11pt;color:#374151;">พลังงานในระบบแสงสว่าง</div>
          <div style="font-weight:700;font-size:12pt;">170,472.1 kWh</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2mm;background:#F0F9FF;border:1px solid #7DD3FC;color:#0C4A6E;border-radius:8px;padding:2mm 4mm;font-size:11pt;white-space:nowrap;">
        <span style="color:#DC2626;font-weight:700;">↑</span>
        <span style="font-weight:700;">เพิ่มขึ้น 100 %</span>
        <span style="color:#6B7280;">เทียบปีก่อน</span>
      </div>
    </div>
  </div>

  <!-- ย่อหน้าอธิบาย -->
  <p style="font-size:14pt;line-height:1.15;margin:0;">
    รายงานการวิเคราะห์การใช้พลังงานแยกตามประเภท แสดงให้เห็นถึงการเพิ่มและลดลงของการใช้พลังงานในทุกด้าน
    เมื่อเทียบกับปีก่อน โดยพลังงานรวมทั้งอาคารมีการใช้สูงสุดที่ <b>998,973.40 kWh</b> เพิ่มขึ้น <b>18.8%</b> 
    พลังงานในระบบปรับอากาศมีการใช้ <b>538,167.80 kWh</b> เพิ่มขึ้น <b>60.0%</b> 
    และพลังงานในระบบแสงสว่างมี <b>170,472.10 kWh</b> เพิ่มขึ้น <b>100%</b>
    ข้อมูลนี้ชี้ถึงแนวโน้มการใช้พลังงานที่เพิ่มขึ้นในด้านระบบปรับอากาศ และ แสงสว่าง
  </p>
</section>

<!-- =======================
     PAGE 5 : WASTE MANAGEMENT (ปรับขนาดกราฟและจัด Legend กลาง)
======================= -->
<section class="page page5" style="break-inside:avoid; page-break-inside:avoid;">
  <h2 style="font-weight:700;font-size:14pt;margin:0 0 6mm 0;">III. Waste Management</h2>

  <h3 style="font-weight:700;font-size:13pt;margin:0 0 3mm 0;">ขยะที่เกิดขึ้นรายเดือนแยกตามชั้นของอาคาร</h3>

  <!-- ภาพอินโฟกราฟขยะรายชั้น -->
  <div style="text-align:center;margin:2mm 0 6mm 0;">
    <img src="cid:waste_by_floor.png" alt="ขยะรายเดือนแยกตามชั้นของอาคาร" style="width:80%;max-width:160mm;height:auto;">
  </div>

  <p style="font-size:14pt;line-height:1.15;margin:0 0 8mm 0;">
    รายงานการวิเคราะห์ปริมาณขยะที่เกิดขึ้นตามชั้นของอาคาร ณ เดือนมิถุนายน 2568
    แสดงให้เห็นถึงการกระจายตัวของขยะที่เกิดขึ้นตามตำแหน่งอาคารที่มีลักษณะใช้งานแตกต่างกัน
    โดยชั้น B2 มีปริมาณขยะ <b>106 kg</b>, ชั้น B1 <b>106 kg</b>, ชั้น 1 <b>1,018 kg</b>,
    ชั้น 2 <b>355 kg</b>, ชั้น 3 <b>176 kg</b>, ชั้น 4 <b>552 kg</b>, ชั้น 5 <b>271 kg</b>
    และ ชั้น 6 <b>100 kg</b>
  </p>

  <h3 style="font-weight:700;font-size:13pt;margin:0 0 3mm 0;">เปรียบเทียบขยะที่เกิดขึ้นแยกตามประเภทไตรมาส</h3>

  <!-- กราฟ ECharts: ขยะตามประเภทไตรมาส -->
  <div style="text-align:center;">
    <div id="waste-quarter" style="display:inline-block;width:80%;height:65mm;margin:2mm auto 6mm auto;"></div>
  </div>

  <p style="font-size:14pt;line-height:1.15;margin:0;">
    กราฟแสดงการเปรียบเทียบปริมาณขยะที่เกิดขึ้นแยกตามประเภทตลอดไตรมาสในปี 2568
    โดยแบ่งเป็น 4 ประเภท ได้แก่ <b>ทั่วไป</b> (สีน้ำเงิน), <b>รีไซเคิล</b> (สีเขียว),
    <b>อินทรีย์</b> (สีส้ม) และ <b>อันตราย</b> (สีเทา)
    ในไตรมาสที่ 2 มีปริมาณขยะประเภททั่วไปสูงสุดที่ <b>6,384 kg</b>
    และขยะอันตรายมีค่าต่ำสุดที่ <b>0 kg</b>
  </p>
</section>

   <!-- ฝังตัว ECharts ลงไปโดยตรง -->
  <script>${echartsJs.replace(/<\/script>/g, "<\\/script>")}</script>

  <!-- สคริปต์สร้างกราฟ -->
  <script>
(async function(){
  // ✅ Chart 1 : Monthly energy (bar compare + target line)
  const el1 = document.getElementById('chart-monthly');
  const chart1 = echarts.init(el1, null, {renderer:'svg'});
  chart1.setOption({
    grid:{left:60,right:30,top:40,bottom:40,containLabel:true},
    legend:{bottom:8,textStyle:{fontSize:12}},
    tooltip:{trigger:'axis'},
    xAxis:{type:'category',data:['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
           axisTick:{show:false},axisLine:{lineStyle:{color:'#9ca3af'}},axisLabel:{color:'#6b7280'}},
    yAxis:{type:'value',splitLine:{lineStyle:{color:'#e5e7eb'}},axisLabel:{color:'#6b7280'}},
    series:[
      {name:'ปี 2567',type:'bar',barGap:0,itemStyle:{color:'#fcd34d'},data:[120000,118000,122000,130000,110000,98000,105000,0,0,0,0,0]},
      {name:'ปี 2568',type:'bar',itemStyle:{color:'#4ade80'},data:[115000,119000,112000,108000,99000,96000,65848.5,0,0,0,0,0]},
      {name:'เป้าหมาย 131,177 kWh',type:'line',symbol:'none',lineStyle:{type:'dashed',color:'#f97316'},data:Array(12).fill(131177)}
    ]
  });
  chart1.on('finished',()=>{window.__chartsRendered=(window.__chartsRendered||0)+1;});

  // ✅ Chart 2 : Energy by system (Q)
  const el2 = document.getElementById('chart-system');
  const chart2 = echarts.init(el2, null, {renderer:'svg'});
  chart2.setOption({
    grid:{left:60,right:30,top:40,bottom:40,containLabel:true},
    legend:{bottom:8,textStyle:{fontSize:12}},
    tooltip:{trigger:'axis'},
    xAxis:{type:'category',data:['Q4/2024','Q1/2025','Q2/2025','Q3/2025'],
           axisTick:{show:false},axisLine:{lineStyle:{color:'#9ca3af'}},axisLabel:{color:'#6b7280'}},
    yAxis:{type:'value',splitLine:{lineStyle:{color:'#e5e7eb'}},axisLabel:{color:'#6b7280'}},
    series:[
      {name:'ระบบแสงสว่าง',type:'bar',barWidth:24,itemStyle:{color:'#f0a11a'},data:[65434.5,106008.5,64463.6,9674.2]},
      {name:'ระบบปรับอากาศ',type:'bar',barWidth:24,itemStyle:{color:'#07a1bd'},data:[153343.3,306521.1,231646.7,41288.0]},
      {name:'ระบบไฟฟ้าอื่นๆ',type:'bar',barWidth:24,itemStyle:{color:'#69be45'},data:[187992.2,151234.9,139098.6,20830.2]}
    ]
  });
  chart2.on('finished',()=>{window.__chartsRendered=(window.__chartsRendered||0)+1;});

  
    // ----- page 5 -----
      const el = document.getElementById('waste-quarter');
  if (!el) return;
  const chart = echarts.init(el, null, { renderer: 'svg' });

  const cats = ['Q1/2025','Q2/2025','Q3/2025','Q4/2025'];
  const general = [4000, 6384, 0, 0];
  const recycle = [2000, 3200, 0, 0];
  const organic = [1500, 1800, 0, 0];
  const hazard  = [0, 0, 0, 0];

  chart.setOption({
    textStyle: { fontFamily: "THSarabunNew, 'Noto Sans Thai', sans-serif" },
    grid: { left: '8%', right: '8%', top: 40, bottom: 80, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: {
      bottom: 20,
      left: 'center',
      orient: 'horizontal',
      itemWidth: 16,
      itemHeight: 10,
      textStyle: { fontSize: 12, color: '#374151' }
    },
    xAxis: {
      type: 'category',
      data: cats,
      axisTick:{show:false},
      axisLine:{lineStyle:{color:'#9ca3af'}},
      axisLabel:{ color:'#6b7280', fontSize: 12 }
    },
    yAxis: {
      type: 'value',
      splitLine:{ lineStyle:{ color:'#e5e7eb' } },
      axisLabel:{ color:'#6b7280', fontSize: 12 }
    },
    series: [
      { name: 'ทั่วไป',   type: 'bar', barWidth: 20, itemStyle:{color:'#3B82F6'}, data: general },
      { name: 'รีไซเคิล', type: 'bar', barWidth: 20, itemStyle:{color:'#22C55E'}, data: recycle },
      { name: 'อินทรีย์', type: 'bar', barWidth: 20, itemStyle:{color:'#F59E0B'}, data: organic },
      { name: 'อันตราย',  type: 'bar', barWidth: 20, itemStyle:{color:'#9CA3AF'}, data: hazard }
    ]
  });

  chart.on('finished', ()=> { window.__chartsRendered = (window.__chartsRendered||0)+1; });


})();
</script>
</body>
</html>
    `;

        // เปิด Chromium
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        });
        const page = await browser.newPage();
        // ✅ จำเป็น: โหมดพิมพ์ เพื่อให้ @page / background ทำงานตาม CSS
        await page.emulateMediaType("print");

        // โหลด HTML
        await page.setContent(html, { waitUntil: "networkidle0" });
        // รอให้กราฟวาดเสร็จ
        // await page.waitForFunction(() => window.__chartReady === true, { timeout: 10000 });

        // ✅ จำเป็น: รอฟอนต์ (กันฟอนต์ไทยเพี้ยน) — ไม่ให้ล้มถ้าไม่มี
        try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch { }

        // สร้าง PDF (A4 + เคารพ @page จาก CSS)
        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'inline; filename="report_puppeteer.pdf"');
        res.end(pdf);
    } catch (err) {
        console.error("Puppeteer PDF error:", err);
        if (!res.headersSent) res.status(500).send("Server Error: " + err.message);
    } finally {
        // ปิด browser เสมอ ป้องกันค้าง/กิน RAM
        if (browser) { try { await browser.close(); } catch { } }
    }
});

export default router;
