import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// PDF text extraction
// ─────────────────────────────────────────────────────────────────────────────

export async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (item.str.trim()) {
        allItems.push({ x: item.transform[4], y: item.transform[5], page: pageNum, text: item.str.trim() });
      }
    }
  }
  allItems.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let currentRow = [], currentY = null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paraguayan number format:
 *   "1.202.400,00" → 1202400  |  "131.000" → 131000  |  "2,000" → 2  |  "8,00" → 8
 */
function parseNum(str) {
  if (!str) return 0;
  const n = parseFloat(str.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function isPriceToken(t) {
  return /^\d[\d.]*(?:,\d+)?$/.test(t);
}

function grab(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

/**
 * Unified product code pattern covering all CJX formats:
 *   001-17002  002-B1814  006-007-81  055-380-1  066-892431  006-007-190
 */
const PRODUCT_CODE_RE = /^\d{3}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// Document type detection
// ─────────────────────────────────────────────────────────────────────────────

function detectDocType(fullText) {
  if (/NOTA\s+DE\s+REMIS[IÍ]ON/i.test(fullText)) return "remision";
  return "factura";
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTURA line parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factura line variants:
 *   WITH barcode    → CODE  BARCODE(≥10 digits)  QTY  DESC  PRICE  EX  G5  G10
 *   WITHOUT barcode → CODE  QTY  DESC  PRICE  EX  G5  G10
 *
 * Collects exactly 4 trailing price tokens from the right.
 */
function parseFacturaLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (!PRODUCT_CODE_RE.test(tokens[0])) return null;

  const codigo = tokens[0];
  let idx = 1;

  // Optional barcode (≥10 consecutive digits, may start with 0)
  let codigo_barra = "";
  if (idx < tokens.length && /^\d{10,}$/.test(tokens[idx])) {
    codigo_barra = tokens[idx];
    idx++;
  }

  // Quantity
  if (idx >= tokens.length || !isPriceToken(tokens[idx])) return null;
  const cantidad = parseNum(tokens[idx]);
  idx++;

  // Need description + 4 price columns
  const rest = tokens.slice(idx);
  if (rest.length < 5) return null;

  let rightIdx = rest.length - 1;
  const trailing = [];
  while (rightIdx >= 0 && trailing.length < 4 && isPriceToken(rest[rightIdx])) {
    trailing.unshift(rest[rightIdx]);
    rightIdx--;
  }
  if (trailing.length < 4) return null;

  const descripcion = rest.slice(0, rightIdx + 1).join(" ").trim();
  if (!descripcion) return null;

  const [precio_unitario, , , gravadas_10] = trailing.map(parseNum);

  return { codigo, codigo_barra, cantidad, descripcion, precio_unitario, gravadas_10, total_linea: cantidad * precio_unitario };
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTA DE REMISIÓN line parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remisión line format: CODE  QTY(X,000)  DESCRIPTION...
 * No price columns.
 */
function parseRemisionLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (!PRODUCT_CODE_RE.test(tokens[0])) return null;

  const codigo = tokens[0];
  const idx = 1;

  if (idx >= tokens.length || !isPriceToken(tokens[idx])) return null;
  const cantidad = parseNum(tokens[idx]);

  const descripcion = tokens.slice(idx + 1).join(" ").trim();
  if (!descripcion) return null;

  // Guard: if the "description" is purely numeric it's probably a factura misread
  if (/^\d[\d.,]*$/.test(tokens[idx + 1])) return null;

  return { codigo, cantidad, descripcion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractClientName(lines) {
  // Try "Nombre o Razon Social: Estoy Las Mercedes" (remisión format — inline)
  for (const line of lines) {
    const m = line.match(/nombre\s+o\s+razon\s+social[:\s]+(.+)/i);
    if (m) {
      const val = m[1].trim();
      if (val && !/^\s*$/.test(val) && !/^ruc/i.test(val)) return val;
    }
  }
  // Fallback: "Nombre Cliente:" label then next standalone line (factura format)
  const labelIdx = lines.findIndex((l) => /nombre\s+cliente/i.test(l));
  if (labelIdx !== -1) {
    for (let i = labelIdx + 1; i <= labelIdx + 5 && i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || /^[\d\-\/]+$/.test(l)) continue;
      if (/^\d{2}[-\/]/i.test(l)) continue;
      if (/[:\s]+(ruc|tel|dir|nro|fecha|cond|vend)/i.test(l)) continue;
      if (/^(avda|mcal|calle|av\.|rua)/i.test(l)) continue;
      if (/[A-Za-záéíóúÁÉÍÓÚñÑ]/.test(l) && l.length > 2) return l;
    }
  }
  return "";
}

function cleanPhone(raw) {
  if (!raw) return "";
  return raw.replace(/[^\d]/g, "").length >= 6 ? raw.trim().replace(/,\s*$/, "").trim() : "";
}

function extractFacturaMetadata(lines, full) {
  return {
    tipo_documento: "Factura",
    fecha:
      grab(full, /fecha\s+emisi[oó]n[:\s]+([^\n\r]+)/i) ||
      grab(full, /(\d{2}[-\/][A-Za-z]{3}[-\/]\d{4})/i) ||
      grab(full, /(\d{2}[-\/]\d{2}[-\/]\d{4})/i),
    numero_documento:
      grab(full, /documento[:\s]+((?:FE\s+)?(?:cre|fe)\s*[\d\-\. ]+)/i) ||
      grab(full, /documento[:\s]+([^\n\r]+)/i),
    cliente: extractClientName(lines),
    ruc: grab(full, /ruc[:\s]+([\d\-]+)/i),
    direccion: grab(full, /direcci[oó]n[:\s]+([^\n\r]+)/i),
    telefono: cleanPhone(grab(full, /tel[eé]fono[:\s]+([^\n\r]+)/i)),
    condicion_venta:
      grab(full, /condici[oó]n\s+venta[:\s]+(.+?)(?:\s+documento[:\s]|$)/i) ||
      grab(full, /condici[oó]n[:\s]+([^\n\r]+)/i),
    vendedor: grab(full, /vendedor[:\s]+([^\n\r]+)/i),
  };
}

function extractRemisionMetadata(lines, full) {
  // "Fecha de Emision: 9 de Abril de 2026"
  const fecha =
    grab(full, /fecha\s+de\s+emisi[oó]n[:\s]+([^\n\r]+)/i) ||
    grab(full, /fecha\s+emisi[oó]n[:\s]+([^\n\r]+)/i);

  // "Nro.: 001-009-0000377" — appears standalone after labels
  const numero_documento =
    grab(full, /nro\.[:\s]+([\d\-]+)/i) ||
    grab(full, /nro\s+reg[:\s]+([\d\-]+)/i);

  // "Nro. Reg.: 58521"
  const nro_reg = grab(full, /nro\.\s*reg\.?[:\s]+([\d]+)/i);

  // Timbrado
  const timbrado = grab(full, /timbrado\s+nro\.?[:\s]+([\d]+)/i);

  return {
    tipo_documento: "Nota de Remisión",
    fecha: fecha.replace(/^\s+/, ""),
    numero_documento,
    nro_reg,
    timbrado,
    cliente: extractClientName(lines),
    punto_partida: grab(full, /punto\s+de\s+partida[:\s]+([^\n\r]+)/i),
    punto_llegada: grab(full, /punto\s+de\s+llegada[:\s]+([^\n\r]+)/i),
    motivo: grab(full, /motivo\s+de\s+traslado[:\s]+([^\n\r]+)/i),
    vehiculo: grab(full, /marca\s+del\s+vehiculo[:\s]+([^\n\rN]+?)(?:Nro|$)/i),
    rua: grab(full, /RUA\)[:.\s]+([\w]+)/i),
    conductor: grab(full, /nombre\s+y\s+apellido[^:]*[:\s]+([^\n\rR]+?)(?:ruc|$)/i),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication for multi-page remisión (Original / Duplicado / Triplicado)
// ─────────────────────────────────────────────────────────────────────────────

function deduplicateProducts(productos) {
  const seen = new Set();
  const unique = [];
  for (const p of productos) {
    if (!seen.has(p.codigo)) {
      seen.add(p.codigo);
      unique.push(p);
    }
  }
  return unique;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function parseInvoice(lines) {
  const full = lines.join("\n");
  const docType = detectDocType(full);

  if (docType === "remision") {
    const metadata = extractRemisionMetadata(lines, full);
    const raw = [];
    for (const line of lines) {
      const p = parseRemisionLine(line);
      if (p) raw.push(p);
    }
    const productos = deduplicateProducts(raw);
    return { docType: "remision", metadata, productos, total: 0 };
  }

  // Factura
  const metadata = extractFacturaMetadata(lines, full);
  const productos = [];
  for (const line of lines) {
    const p = parseFacturaLine(line);
    if (p) productos.push(p);
  }
  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { docType: "factura", metadata, productos, total };
}