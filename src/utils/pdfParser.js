import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

function pageToLines(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = []; let row = [], cy = null;
  for (const item of items) {
    if (cy === null || Math.abs(item.y - cy) <= 4) { row.push(item); if (cy === null) cy = item.y; }
    else { rows.push(row); row = [item]; cy = item.y; }
  }
  if (row.length) rows.push(row);
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

function parseNum(str) {
  if (!str) return 0;
  const n = parseFloat(str.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function isPriceToken(t) { return /^\d[\d.]*(?:,\d+)?$/.test(t); }
function grab(text, re) { const m = text.match(re); return m ? m[1].trim() : ""; }
function grabInline(text, labelRe, stopRe) {
  const m = text.match(new RegExp(labelRe.source + "\\s+(.+?)(?=" + stopRe.source + "|\\s{3,}|$)", "im"));
  return m ? m[1].trim() : "";
}

const CJX_CODE = /^\d{3}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;

export function detectDocType(full) {
  if (/PACKING\s+LIST/i.test(full))          return "packing_list";
  if (/NOTA\s+DE\s+REMIS[I\u00CD]ON/i.test(full)) return "remision";
  return "factura";
}

// ── FACTURA ───────────────────────────────────────────────────────────────────
function parseFacturaLine(line) {
  const t = line.trim().split(/\s+/);
  if (!CJX_CODE.test(t[0])) return null;
  let i = 1; let barcode = "";
  if (/^\d{10,}$/.test(t[i] ?? "")) barcode = t[i++];
  if (!isPriceToken(t[i] ?? "")) return null;
  const qty = parseNum(t[i++]);
  const rest = t.slice(i);
  if (rest.length < 5) return null;
  let ri = rest.length - 1; const trail = [];
  while (ri >= 0 && trail.length < 4 && isPriceToken(rest[ri])) trail.unshift(rest[ri--]);
  if (trail.length < 4) return null;
  const desc = rest.slice(0, ri + 1).join(" ").trim();
  if (!desc) return null;
  const [price, , , g10] = trail.map(parseNum);
  return { codigo: t[0], codigo_barra: barcode, cantidad: qty, descripcion: desc,
    precio_unitario: price, gravadas_10: g10, total_linea: qty * price };
}
function fallbackFactura(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (!CJX_CODE.test(t[0]) || t.length < 2) continue;
    let qi = -1;
    for (let i = 1; i < Math.min(t.length, 4); i++) { if (isPriceToken(t[i])) { qi = i; break; } }
    if (qi < 0) continue;
    const qty = parseNum(t[qi]); const rest = t.slice(qi + 1);
    const trail = []; let ri = rest.length - 1;
    while (ri >= 0 && trail.length < 4 && isPriceToken(rest[ri])) trail.unshift(rest[ri--]);
    const desc = rest.slice(0, ri + 1).join(" ").trim();
    if (!desc) continue;
    const price = trail.length >= 1 ? parseNum(trail[0]) : 0;
    const g10   = trail.length >= 4 ? parseNum(trail[3]) : 0;
    out.push({ codigo: t[0], codigo_barra: "", cantidad: qty, descripcion: desc,
      precio_unitario: price, gravadas_10: g10, total_linea: qty * price });
  }
  return out;
}

// ── REMISIÓN ──────────────────────────────────────────────────────────────────
function parseRemisionLine(line) {
  const t = line.trim().split(/\s+/);
  if (!CJX_CODE.test(t[0]) || t.length < 3) return null;
  if (!isPriceToken(t[1])) return null;
  const qty = parseNum(t[1]); const desc = t.slice(2).join(" ").trim();
  // Guard: description must contain at least one letter.
  // This allows descriptions starting with numbers (e.g. "12 LIMIT BREAKER", "5PULG.")
  // while still rejecting lines where everything after qty is numeric (price columns).
  if (!desc || !/[A-Za-záéíóúÁÉÍÓÚñÑ]/.test(desc)) return null;
  return { codigo: t[0], cantidad: qty, descripcion: desc };
}
function fallbackRemision(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (!CJX_CODE.test(t[0]) || t.length < 2) continue;
    let qi = -1;
    for (let i = 1; i < Math.min(t.length, 4); i++) { if (isPriceToken(t[i])) { qi = i; break; } }
    if (qi < 0) continue;
    const qty = parseNum(t[qi]); const desc = t.slice(qi + 1).join(" ").trim();
    if (desc) out.push({ codigo: t[0], cantidad: qty, descripcion: desc });
  }
  return out;
}
function dedup(ps) {
  const seen = new Set();
  return ps.filter((p) => { if (seen.has(p.codigo)) return false; seen.add(p.codigo); return true; });
}

// ── PACKING LIST ──────────────────────────────────────────────────────────────
function isDate(t)       { return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t); }
function isPackNum(t)    { return /^\d[\d.]*(?:,\d+)?$/.test(t); }

/**
 * Packing List row: QUANT NCM(8d) CODE  DESCRIPTION... LOTE VALIDADE MASTERBOX UNIDADES CANTIDAD NET GROSS
 * Strategy:
 *  1. Tokens 0-2: quant, ncm, code (validated)
 *  2. Find validade (date D/M/YYYY) in rest
 *  3. Token before date = lote; before lote = description
 *  4. After date: last 5 numeric tokens = master_box, unidades, cantidad, net, gross
 */
function parsePackingLine(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 9) return null;
  if (!isPackNum(t[0])) return null;
  if (!/^\d{8}$/.test(t[1])) return null;
  if (!/^[A-Za-z0-9]+$/.test(t[2])) return null;

  const rest     = t.slice(3);
  const dateIdx  = rest.findIndex(isDate);
  if (dateIdx < 1) return null;

  const lote        = rest[dateIdx - 1];
  const description = rest.slice(0, dateIdx - 1).join(" ").trim();
  const validade    = rest[dateIdx];
  const afterDate   = rest.slice(dateIdx + 1).filter(isPackNum);
  if (afterDate.length < 5) return null;

  const [mb, un, cant, net, gross] = afterDate.slice(-5);
  return {
    quant:        parseNum(t[0]),
    ncm:          t[1],
    codigo:       t[2],
    description,
    lote,
    validade,
    master_box:   parseNum(mb),
    unidades:     parseNum(un),
    cantidad:     parseNum(cant),
    net_weight:   parseNum(net),
    gross_weight: parseNum(gross),
  };
}

// ── Metadata ──────────────────────────────────────────────────────────────────
function extractFacturaMetadata(full) {
  const cliente = grabInline(full, /nombre\s+cliente:/i, /ruc:/i) ||
    grab(full, /nombre\s+cliente[:\s]+(.+)/im);
  const condicion_venta = grabInline(full, /condici[o\u00F3]n\s+venta:/i, /documento:/i) ||
    grab(full, /condici[o\u00F3]n[:\s]+(.+?)(?=\s{2,}|documento:|$)/im);
  return {
    tipo_documento:   "Factura",
    fecha:            grab(full, /fecha\s+emisi[o\u00F3]n[:\s]+(\S+)/i),
    nro_factura:      grab(full, /204400\s+(\d{2,6})(?:\s|$)/im),
    numero_documento: grab(full, /documento[:\s]+([^\n\r]+)/i).trim(),
    cliente:          cliente.replace(/\s{2,}.*$/, "").trim(),
    ruc:              grab(full, /\bRuc[:\s]+([\d\-]+)/i),
    direccion:        grab(full, /direcci[o\u00F3]n[:\s]+([^\n\r]+)/i),
    telefono:         grab(full, /tel[e\u00E9]fono[:\s]+([^\n\r,]+)/i).replace(/,.*$/, "").trim(),
    condicion_venta:  condicion_venta.replace(/\s{2,}.*$/, "").trim(),
    vendedor:         grab(full, /vendedor[:\s]+([^\n\r]+)/i),
  };
}

function extractRemisionMetadata(full) {
  const fecha = grabInline(full, /fecha\s+de\s+emisi[o\u00F3]n:/i, /nro\./i) ||
    grab(full, /fecha\s+de\s+emisi[o\u00F3]n[:\s]+([^\n\r]+)/i);
  const cliente = grabInline(full, /nombre\s+o\s+razon\s+social:/i, /ruc/i) ||
    grab(full, /nombre\s+o\s+razon\s+social[:\s]+([^\n\r]+)/i);
  return {
    tipo_documento:   "Nota de Remisi\u00F3n",
    fecha:            fecha.replace(/\s{2,}.*$/, "").trim(),
    numero_documento: grab(full, /\bNro\.\s*:\s*(\d{3}-\d{3}-\d+)/i),
    nro_reg:          grab(full, /nro\.\s*reg\.?[:\s]+([\d]+)/i),
    timbrado:         grab(full, /timbrado\s+nro\.?[:\s]+([\d]+)/i),
    cliente:          cliente.replace(/\s{2,}.*$/, "").trim(),
    punto_partida:    (grabInline(full, /punto\s+de\s+partida:/i, /fecha\s+estimada/i) ||
                      grab(full, /punto\s+de\s+partida[:\s]+([^\n\r]+)/i)).replace(/\s{2,}.*$/, "").trim(),
    punto_llegada:    grab(full, /punto\s+de\s+llegada[:\s]+([^\n\r]+)/i).trim(),
    motivo:           (grabInline(full, /motivo\s+de\s+traslado:/i, /tipo\s+de\s+comp/i) ||
                      grab(full, /motivo\s+de\s+traslado[:\s]+([^\n\r]+)/i)).replace(/\s{2,}.*$/, "").trim(),
    rua:              grab(full, /\(RUA\)[):\s]+([A-Z0-9]+)/i),
    conductor:        (grabInline(full, /nombre\s+y\s+apellido\s+o\s+razon\s+social:/i, /ruc\//i) ||
                      grab(full, /nombre\s+y\s+apellido[^:]*[:\s]+([^\n\r]+)/i)).replace(/\s{2,}.*$/, "").trim(),
  };
}

function extractPackingMetadata(lines, full) {
  const numero_packing_list = grab(full, /PACKING\s+LIST\s+NR\.\s+([^\n\r]+)/i).trim();

  const shipperIdx   = lines.findIndex((l) => /^SHIPPER$/i.test(l.trim()));
  const consigneeIdx = lines.findIndex((l) => /^CONSIGNEE$/i.test(l.trim()));
  const shipper = (shipperIdx >= 0 &&
    lines[shipperIdx + 1]?.trim() &&
    !/^(CONSIGNEE|MEANS|TERMS)/i.test(lines[shipperIdx + 1]?.trim()))
    ? lines[shipperIdx + 1].trim() : "";
  const consignee = (consigneeIdx >= 0 &&
    lines[consigneeIdx + 1]?.trim() &&
    !/^(MEANS|TERMS|By\s+road)/i.test(lines[consigneeIdx + 1]?.trim()))
    ? lines[consigneeIdx + 1].trim() : "";

  return {
    tipo_documento:      "Packing List",
    numero_packing_list,
    shipper,
    consignee,
    transporte:          grab(full, /MEANS\s+OF\s+TRANSPORTATION\s*\n\s*([^\n\r]+)/i).trim(),
    condicion_pago:      grab(full, /TERMS\s+OF\s+PAYMENT\s*\n\s*([^\n\r]+)/i).trim(),
    net_weight_total:    grab(full, /NET\s+WEIGHT[:\s]+([\d.,]+)/i),
    gross_weight_total:  grab(full, /[Gg]ross\s+(?:wight|weight)[:\s]+([\d.,]+)/i),
    pallets:             grab(full, /([\d.,]+)\s+LENGTH\s+IN\s+METERS/i),
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────
export function parseInvoice(lines) {
  const full    = lines.join("\n");
  const docType = detectDocType(full);

  if (docType === "packing_list") {
    const metadata  = extractPackingMetadata(lines, full);
    const productos = lines.map(parsePackingLine).filter(Boolean);
    if (productos.length === 0)
      throw new Error("No se encontraron productos en el Packing List.");
    return { docType: "packing_list", metadata, productos, total: 0 };
  }

  if (docType === "remision") {
    const metadata = extractRemisionMetadata(full);
    let raw = lines.map(parseRemisionLine).filter(Boolean);
    if (raw.length === 0) raw = fallbackRemision(lines);
    const productos = dedup(raw);
    if (productos.length === 0)
      throw new Error("No se encontraron productos. Verific\u00E1 que sea un documento v\u00E1lido.");
    return { docType: "remision", metadata, productos, total: 0 };
  }

  const metadata = extractFacturaMetadata(full);
  let productos = lines.map(parseFacturaLine).filter(Boolean);
  if (productos.length === 0) productos = fallbackFactura(lines);
  if (productos.length === 0)
    throw new Error("No se encontraron productos. Verific\u00E1 que sea un documento v\u00E1lido.");

  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { docType: "factura", metadata, productos, total };
}