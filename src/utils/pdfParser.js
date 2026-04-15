import * as pdfjsLib from "pdfjs-dist";

// Use CDN worker to avoid bundling issues with Vite
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

/**
 * Extract structured text lines from a PDF File object.
 * Reconstructs visual rows by grouping text items within ±4px on the Y axis.
 */
export async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allItems = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (item.str.trim()) {
        allItems.push({
          x: item.transform[4],
          y: item.transform[5],
          text: item.str.trim(),
        });
      }
    }
  }

  // Sort top-to-bottom (PDF y-axis is inverted), then left-to-right
  allItems.sort((a, b) => b.y - a.y || a.x - b.x);

  // Group into visual rows
  const rows = [];
  let currentRow = [];
  let currentY = null;

  for (const item of allItems) {
    if (currentY === null || Math.abs(item.y - currentY) <= 4) {
      currentRow.push(item);
      if (currentY === null) currentY = item.y;
    } else {
      rows.push(currentRow);
      currentRow = [item];
      currentY = item.y;
    }
  }
  if (currentRow.length) rows.push(currentRow);

  return rows.map((row) => row.map((i) => i.text).join(" "));
}

/**
 * Parse Spanish number format: "1.202.400,00" → 1202400
 */
function parseNum(str) {
  if (!str) return 0;
  const clean = str.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

/**
 * Pick first regex match from text, trimmed.
 */
function grab(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

/**
 * Parse invoice lines into structured metadata + products.
 * Handles CJX S.A. invoice format.
 */
export function parseInvoice(lines) {
  const full = lines.join("\n");

  // ── Metadata ────────────────────────────────────────────────────────────
  const metadata = {
    fecha:
      grab(full, /fecha\s+emisi[oó]n[:\s]+([^\n\r]+)/i) ||
      grab(full, /(\d{2}[-\/][A-Za-z]{3}[-\/]\d{4})/i) ||
      grab(full, /(\d{2}[-\/]\d{2}[-\/]\d{4})/i),

    numero_documento:
      grab(full, /documento[:\s]+(CRE\s+[\d\-\.]+)/i) ||
      grab(full, /documento[:\s]+([^\n\r]+)/i) ||
      grab(full, /nro\.?reg[:\s]+([^\n\r]+)/i),

    cliente:
      grab(full, /nombre\s+cliente[:\s]+([^\n\r]+)/i) ||
      grab(full, /cliente[:\s]+([^\n\r]+)/i),

    ruc: grab(full, /ruc[:\s]+([\d\-]+)/i),

    direccion: grab(full, /direcci[oó]n[:\s]+([^\n\r]+)/i),

    telefono: grab(full, /tel[eé]fono[:\s]+([\d\-]+)/i),

    condicion_venta:
      grab(full, /condici[oó]n\s+venta[:\s]+([^\n\rD]+?)(?:documento|$)/i) ||
      grab(full, /condici[oó]n[:\s]+([^\n\r]+)/i),

    vendedor: grab(full, /vendedor[:\s]+([^\n\r]+)/i),
  };

  // ── Product lines ────────────────────────────────────────────────────────
  // Format: CODE  BARCODE  QTY  DESCRIPTION  PRICE  EXENTA  GRAV5%  GRAV10%
  // e.g.:   068-18026  8431618018026  8,00  T-Racers ... Mega Striker 1x8  68.400,00  0,00  0,00  547.200,00
  const PRODUCT_RE =
    /^(\d{3}-\d{5})\s+(\d{10,})\s+([\d.,]+)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

  const productos = [];

  for (const line of lines) {
    const m = line.match(PRODUCT_RE);
    if (m) {
      const qty = parseNum(m[3]);
      const price = parseNum(m[5]);
      productos.push({
        codigo: m[1],
        codigo_barra: m[2],
        cantidad: qty,
        descripcion: m[4].trim(),
        precio_unitario: price,
        gravadas_10: parseNum(m[8]),
        total_linea: qty * price,
      });
    }
  }

  // ── Total ────────────────────────────────────────────────────────────────
  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { metadata, productos, total };
}
