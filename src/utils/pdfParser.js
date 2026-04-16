import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// PDF extraction — each page processed independently (prevents cross-page row merging)
// ─────────────────────────────────────────────────────────────────────────────

function pageToLines(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let row = [], cy = null;
  for (const item of items) {
    if (cy === null || Math.abs(item.y - cy) <= 4) {
      row.push(item);
      if (cy === null) cy = item.y;
    } else {
      rows.push(row);
      row = [item];
      cy = item.y;
    }
  }
  if (row.length) rows.push(row);
  // Sort each row by X so columns are in reading order
  return rows.map((r) => { r.sort((a, b) => a.x - b.x); return r.map((i) => i.text).join(" "); });
}

export async function extractPdfLines(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const all = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str?.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], text: i.str.trim() }));
    all.push(...pageToLines(items));
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paraguayan numbers: "1.202.400,00"→1202400 | "131.000"→131000 | "2,000"→2
 */
function parseNum(str) {
  if (!str) return 0;
  const n = parseFloat(str.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function isPriceToken(t) { return /^\d[\d.]*(?:,\d+)?$/.test(t); }

/**
 * Extract first capture group, trimmed. Strips leading/trailing whitespace.
 */
function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Like grab but strips trailing junk (multiple spaces + next label).
 * Used for fields that share a line with sibling labels.
 * e.g. "Nombre Cliente:   PHARMAC S.A.                    Ruc: 80015821-0"
 *       → grab after "Nombre Cliente:", stop at 2+ spaces or next label pattern
 */
function grabInline(text, labelRe, stopRe) {
  const m = text.match(new RegExp(labelRe.source + "\\s+(.+?)(?=" + stopRe.source + "|\\s{3,}|$)", "im"));
  return m ? m[1].trim() : "";
}

// Unified product code: 001-17002 | 002-B1814 | 006-007-81 | 055-380-1 | 066-892431
const CODE = /^\d{3}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// Document type detection
// ─────────────────────────────────────────────────────────────────────────────

function detectDocType(full) {
  return /NOTA\s+DE\s+REMIS[IÍ]ON/i.test(full) ? "remision" : "factura";
}

// ─────────────────────────────────────────────────────────────────────────────
// Product line parsers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factura product line — two variants:
 *   WITH barcode:    CODE  BARCODE(≥10d)  QTY  DESC  PRICE  EX  G5  G10
 *   WITHOUT barcode: CODE  QTY            DESC  PRICE  EX  G5  G10
 */
function parseFacturaLine(line) {
  const t = line.trim().split(/\s+/);
  if (!CODE.test(t[0])) return null;
  let i = 1;
  let barcode = "";
  if (/^\d{10,}$/.test(t[i] ?? "")) barcode = t[i++];
  if (!isPriceToken(t[i] ?? "")) return null;
  const qty = parseNum(t[i++]);
  const rest = t.slice(i);
  if (rest.length < 5) return null;
  let ri = rest.length - 1;
  const trail = [];
  while (ri >= 0 && trail.length < 4 && isPriceToken(rest[ri])) trail.unshift(rest[ri--]);
  if (trail.length < 4) return null;
  const desc = rest.slice(0, ri + 1).join(" ").trim();
  if (!desc) return null;
  const [price, , , g10] = trail.map(parseNum);
  return { codigo: t[0], codigo_barra: barcode, cantidad: qty, descripcion: desc, precio_unitario: price, gravadas_10: g10, total_linea: qty * price };
}

/**
 * Remisión product line:
 *   CODE  QTY(X,000)  DESCRIPTION...
 */
function parseRemisionLine(line) {
  const t = line.trim().split(/\s+/);
  if (!CODE.test(t[0]) || t.length < 3) return null;
  if (!isPriceToken(t[1])) return null;
  const qty = parseNum(t[1]);
  const desc = t.slice(2).join(" ").trim();
  if (!desc || /^\d[\d.,]*$/.test(t[2])) return null; // guard: next token shouldn't be a price
  return { codigo: t[0], cantidad: qty, descripcion: desc };
}

/**
 * Fallback: lenient scan when the primary parser finds 0 products.
 */
function fallbackScan(lines, docType) {
  const out = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (!CODE.test(t[0]) || t.length < 2) continue;
    let qi = -1;
    for (let i = 1; i < Math.min(t.length, 4); i++) { if (isPriceToken(t[i])) { qi = i; break; } }
    if (qi < 0) continue;
    const qty = parseNum(t[qi]);
    const rest = t.slice(qi + 1);
    if (docType === "remision") {
      const desc = rest.join(" ").trim();
      if (desc) out.push({ codigo: t[0], cantidad: qty, descripcion: desc });
    } else {
      const trail = []; let ri = rest.length - 1;
      while (ri >= 0 && trail.length < 4 && isPriceToken(rest[ri])) trail.unshift(rest[ri--]);
      const desc = rest.slice(0, ri + 1).join(" ").trim();
      if (!desc) continue;
      const price = trail.length >= 1 ? parseNum(trail[0]) : 0;
      const g10   = trail.length >= 4 ? parseNum(trail[3]) : 0;
      out.push({ codigo: t[0], codigo_barra: "", cantidad: qty, descripcion: desc, precio_unitario: price, gravadas_10: g10, total_linea: qty * price });
    }
  }
  return out;
}

function dedup(ps) {
  const seen = new Set();
  return ps.filter((p) => { if (seen.has(p.codigo)) return false; seen.add(p.codigo); return true; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata extraction
//
// Key insight from pdftotext -layout analysis:
//
//   FACTURA (both normal and SET electronic):
//     Line A: "Fecha Emisión: 15-Apr-2026  Condicion Venta: CREDITO 30 Y 45 DIAS  Documento: FE Cre 001-009"
//     Line B: "Nombre Cliente: Malahide SA                                   Ruc: 80099617-8"
//     Line C: "Dirección: CAPITAN MIRANDA ESQUINA ANDRADE"
//     Line D: "Remisiones:                    Vendedor: NATALIA GILL"
//
//   NOTA DE REMISION:
//     Line A: "Fecha de Emision: 9 de Abril de 2026       Nro. Reg.: 58521"
//     Line B: "Nombre o Razon Social: Estoy Las Mercedes  RUC o C.I. del Destinatario:"
//     Line C: "Direccion: General Santos 688"
//     Line D: "Motivo de traslado: Transferencia entre depositos"
//
//   All labels and their values share the same pdfjs-reconstructed line.
//   Extraction must stop at sibling labels (look-ahead to next label pattern).
// ─────────────────────────────────────────────────────────────────────────────

function extractFacturaMetadata(full) {
  // "Nombre Cliente:   PHARMAC S.A.         Ruc: 80015821-0"
  const cliente = grabInline(full, /nombre\s+cliente:/i, /ruc:/i) ||
    grab(full, /nombre\s+cliente[:\s]+(.+)/im); // fallback: whole remainder

  // "Fecha Emisión:  15-Apr-2026   Condicion Venta: ..."
  const fecha = grab(full, /fecha\s+emisi[oó]n[:\s]+(\S+)/i);

  // "... Condicion Venta: CREDITO 30 Y 45 DIAS   Documento: ..."
  const condicion_venta = grabInline(full, /condici[oó]n\s+venta:/i, /documento:/i) ||
    grab(full, /condici[oó]n[:\s]+(.+?)(?=\s{2,}|documento:|$)/im);

  // "... Documento: FE Cre 001-009" → take rest of line
  const numero_documento = grab(full, /documento[:\s]+([^\n\r]+)/i);

  return {
    tipo_documento:   "Factura",
    fecha,
    numero_documento: numero_documento.trim(),
    cliente:          cliente.replace(/\s{2,}.*$/, "").trim(), // strip any trailing multi-space + garbage
    ruc:              grab(full, /\bRuc[:\s]+([\d\-]+)/i),
    direccion:        grab(full, /direcci[oó]n[:\s]+([^\n\r]+)/i),
    telefono:         grab(full, /tel[eé]fono[:\s]+([^\n\r,]+)/i).replace(/,.*$/, "").trim(),
    condicion_venta:  condicion_venta.replace(/\s{2,}.*$/, "").trim(),
    vendedor:         grab(full, /vendedor[:\s]+([^\n\r]+)/i),
  };
}

function extractRemisionMetadata(full) {
  // "Fecha de Emision: 9 de Abril de 2026    Nro. Reg.: 58521"
  // → stop at 2+ spaces or "Nro."
  const fecha = grabInline(full, /fecha\s+de\s+emisi[oó]n:/i, /nro\./i) ||
    grab(full, /fecha\s+de\s+emisi[oó]n[:\s]+([^\n\r]+)/i);

  // "Nombre o Razon Social: Estoy Las Mercedes   RUC o C.I...."
  const cliente = grabInline(full, /nombre\s+o\s+razon\s+social:/i, /ruc/i) ||
    grab(full, /nombre\s+o\s+razon\s+social[:\s]+([^\n\r]+)/i);

  // "Nro.: 001-009-0000377" — document numbers have format NNN-NNN-NNNNNNN
  const numero_documento = grab(full, /\bNro\.\s*:\s*(\d{3}-\d{3}-\d+)/i);

  // "Nro. Reg.: 58521" — short numeric reg number
  const nro_reg = grab(full, /nro\.\s*reg\.?[:\s]+([\d]+)/i);

  // "TIMBRADO Nro.: 16839082"
  const timbrado = grab(full, /timbrado\s+nro\.?[:\s]+([\d]+)/i);

  // "Direccion del punto de partida: Ruta 2 ..."
  const punto_partida = grabInline(full, /punto\s+de\s+partida:/i, /fecha\s+estimada/i) ||
    grab(full, /punto\s+de\s+partida[:\s]+([^\n\r]+)/i);

  // "Direccion del punto de llegada: General Santos 688"
  const punto_llegada = grab(full, /punto\s+de\s+llegada[:\s]+([^\n\r]+)/i);

  // "Motivo de traslado: Transferencia entre depositos"
  const motivo = grabInline(full, /motivo\s+de\s+traslado:/i, /tipo\s+de\s+comp/i) ||
    grab(full, /motivo\s+de\s+traslado[:\s]+([^\n\r]+)/i);

  // "Nro. de Reg. Unico del Automotor (RUA):    AGN292"
  const rua = grab(full, /\(RUA\)[):\s]+([A-Z0-9]+)/i);

  // "Nombre y Apellido o Razon Social: Eduardo Rivarola   RUC/Cedula..."
  const conductor = grabInline(full, /nombre\s+y\s+apellido\s+o\s+razon\s+social:/i, /ruc\//i) ||
    grab(full, /nombre\s+y\s+apellido[^:]*[:\s]+([^\n\r]+)/i);

  return {
    tipo_documento: "Nota de Remisión",
    fecha:          fecha.replace(/\s{2,}.*$/, "").trim(),
    numero_documento,
    nro_reg,
    timbrado,
    cliente:        cliente.replace(/\s{2,}.*$/, "").trim(),
    punto_partida:  punto_partida.replace(/\s{2,}.*$/, "").trim(),
    punto_llegada:  punto_llegada.trim(),
    motivo:         motivo.replace(/\s{2,}.*$/, "").trim(),
    rua,
    conductor:      conductor.replace(/\s{2,}.*$/, "").trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function parseInvoice(lines) {
  const full = lines.join("\n");
  const docType = detectDocType(full);

  if (docType === "remision") {
    const metadata = extractRemisionMetadata(full);
    let raw = lines.map(parseRemisionLine).filter(Boolean);
    if (raw.length === 0) raw = fallbackScan(lines, "remision");
    const productos = dedup(raw);
    if (productos.length === 0)
      throw new Error("No se encontraron productos. Verificá que sea un documento CJX S.A. válido.");
    return { docType: "remision", metadata, productos, total: 0 };
  }

  // Factura
  const metadata = extractFacturaMetadata(full);
  let productos = lines.map(parseFacturaLine).filter(Boolean);
  if (productos.length === 0) productos = fallbackScan(lines, "factura");
  if (productos.length === 0)
    throw new Error("No se encontraron productos. Verificá que sea una factura CJX S.A. válida.");

  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { docType: "factura", metadata, productos, total };
}