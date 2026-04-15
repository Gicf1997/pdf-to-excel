import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// PDF text extraction — each page processed independently, then concatenated
// ─────────────────────────────────────────────────────────────────────────────

function pageToLines(items) {
  // Sort top-to-bottom, then left-to-right within same Y
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let currentRow = [], currentY = null;
  for (const item of items) {
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

  // Sort each row by X so columns are always in reading order
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    return row.map((i) => i.text).join(" ");
  });
}

export async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str?.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], text: i.str.trim() }));
    allLines.push(...pageToLines(items));
  }
  return allLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// All CJX product code variants: 001-17002  002-B1814  006-007-81  055-380-1  066-892431
const PRODUCT_CODE_RE = /^\d{3}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// Document type detection
// ─────────────────────────────────────────────────────────────────────────────

function detectDocType(fullText) {
  if (/NOTA\s+DE\s+REMIS[IÍ]ON/i.test(fullText)) return "remision";
  return "factura";
}

// ─────────────────────────────────────────────────────────────────────────────
// Factura line parser
// ─────────────────────────────────────────────────────────────────────────────

function parseFacturaLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (!PRODUCT_CODE_RE.test(tokens[0])) return null;

  const codigo = tokens[0];
  let idx = 1;

  let codigo_barra = "";
  if (idx < tokens.length && /^\d{10,}$/.test(tokens[idx])) {
    codigo_barra = tokens[idx++];
  }

  if (idx >= tokens.length || !isPriceToken(tokens[idx])) return null;
  const cantidad = parseNum(tokens[idx++]);

  const rest = tokens.slice(idx);
  if (rest.length < 5) return null;

  let ri = rest.length - 1;
  const trail = [];
  while (ri >= 0 && trail.length < 4 && isPriceToken(rest[ri])) trail.unshift(rest[ri--]);
  if (trail.length < 4) return null;

  const descripcion = rest.slice(0, ri + 1).join(" ").trim();
  if (!descripcion) return null;

  const [precio_unitario, , , gravadas_10] = trail.map(parseNum);
  return { codigo, codigo_barra, cantidad, descripcion, precio_unitario, gravadas_10, total_linea: cantidad * precio_unitario };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remisión line parser
// ─────────────────────────────────────────────────────────────────────────────

function parseRemisionLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (!PRODUCT_CODE_RE.test(tokens[0])) return null;
  if (tokens.length < 3) return null;
  if (!isPriceToken(tokens[1])) return null;

  const cantidad = parseNum(tokens[1]);
  const descripcion = tokens.slice(2).join(" ").trim();
  if (!descripcion) return null;
  if (/^\d[\d.,]*$/.test(tokens[2])) return null; // guard: next token shouldn't be a price

  return { codigo: tokens[0], cantidad, descripcion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: lenient scan when primary parser finds nothing
// ─────────────────────────────────────────────────────────────────────────────

function fallbackScan(lines, docType) {
  const results = [];
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (!PRODUCT_CODE_RE.test(tokens[0]) || tokens.length < 2) continue;

    const codigo = tokens[0];
    let qtyIdx = -1;
    for (let i = 1; i < Math.min(tokens.length, 4); i++) {
      if (isPriceToken(tokens[i])) { qtyIdx = i; break; }
    }
    if (qtyIdx === -1) continue;

    const cantidad = parseNum(tokens[qtyIdx]);
    const remaining = tokens.slice(qtyIdx + 1);

    if (docType === "remision") {
      const descripcion = remaining.join(" ").trim();
      if (descripcion) results.push({ codigo, cantidad, descripcion });
    } else {
      const trail = [];
      let ri = remaining.length - 1;
      while (ri >= 0 && trail.length < 4 && isPriceToken(remaining[ri])) trail.unshift(remaining[ri--]);
      const descripcion = remaining.slice(0, ri + 1).join(" ").trim();
      if (!descripcion) continue;
      const precio_unitario = trail.length >= 1 ? parseNum(trail[0]) : 0;
      const gravadas_10 = trail.length >= 4 ? parseNum(trail[3]) : 0;
      results.push({ codigo, codigo_barra: "", cantidad, descripcion, precio_unitario, gravadas_10, total_linea: cantidad * precio_unitario });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication for multi-page remisión (Original / Duplicado / Triplicado)
// ─────────────────────────────────────────────────────────────────────────────

function deduplicateProducts(products) {
  const seen = new Set();
  return products.filter((p) => {
    if (seen.has(p.codigo)) return false;
    seen.add(p.codigo);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

function extractClientName(lines) {
  for (const line of lines) {
    const m = line.match(/nombre\s+o\s+razon\s+social[:\s]+(.+)/i);
    if (m) {
      const val = m[1].trim();
      if (val && !/^ruc/i.test(val)) return val;
    }
  }
  const labelIdx = lines.findIndex((l) => /nombre\s+cliente/i.test(l));
  if (labelIdx !== -1) {
    for (let i = labelIdx + 1; i <= labelIdx + 5 && i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || /^[\d\-\/]+$/.test(l) || /^\d{2}[-\/]/i.test(l)) continue;
      if (/[:\s]+(ruc|tel|dir|nro|fecha)/i.test(l)) continue;
      if (/^(avda|mcal|calle|av\.)/i.test(l)) continue;
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
  return {
    tipo_documento: "Nota de Remisión",
    fecha:
      grab(full, /fecha\s+de\s+emisi[oó]n[:\s]+([^\n\r]+)/i) ||
      grab(full, /fecha\s+emisi[oó]n[:\s]+([^\n\r]+)/i),
    numero_documento: grab(full, /nro\.[:\s]+([\d\-]+)/i),
    nro_reg: grab(full, /nro\.\s*reg\.?[:\s]+([\d]+)/i),
    timbrado: grab(full, /timbrado\s+nro\.?[:\s]+([\d]+)/i),
    cliente: extractClientName(lines),
    punto_partida: grab(full, /punto\s+de\s+partida[:\s]+([^\n\r]+)/i),
    punto_llegada: grab(full, /punto\s+de\s+llegada[:\s]+([^\n\r]+)/i),
    motivo: grab(full, /motivo\s+de\s+traslado[:\s]+([^\n\r]+)/i),
    rua: grab(full, /RUA\)[:.\s]+([\w]+)/i),
    conductor: grab(full, /nombre\s+y\s+apellido[^:]*[:\s]+([^\n\rR]+?)(?:ruc|$)/i),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function parseInvoice(lines) {
  const full = lines.join("\n");
  const docType = detectDocType(full);

  if (docType === "remision") {
    const metadata = extractRemisionMetadata(lines, full);

    let raw = lines.map(parseRemisionLine).filter(Boolean);
    if (raw.length === 0) raw = fallbackScan(lines, "remision");

    const productos = deduplicateProducts(raw);
    if (productos.length === 0) throw new Error("No se encontraron productos. Verificá que sea un documento CJX S.A. válido.");

    return { docType: "remision", metadata, productos, total: 0 };
  }

  // Factura
  const metadata = extractFacturaMetadata(lines, full);
  let productos = lines.map(parseFacturaLine).filter(Boolean);
  if (productos.length === 0) productos = fallbackScan(lines, "factura");
  if (productos.length === 0) throw new Error("No se encontraron productos. Verificá que sea una factura CJX S.A. válida.");

  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { docType: "factura", metadata, productos, total };
}