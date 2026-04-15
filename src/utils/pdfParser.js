import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

export async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (item.str.trim()) {
        allItems.push({ x: item.transform[4], y: item.transform[5], text: item.str.trim() });
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

function parseNum(str) {
  if (!str) return 0;
  const clean = str.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function isPriceToken(t) {
  return /^\d[\d.]*(?:,\d+)?$/.test(t);
}

/**
 * Parse a single text line into a product record.
 *
 * CJX line variants:
 *   WITH barcode    → CODE  BARCODE(≥10 digits)  QTY  DESCRIPTION  PRICE  EX  G5  G10
 *   WITHOUT barcode → CODE  QTY  DESCRIPTION  PRICE  EX  G5  G10
 *
 * Product code pattern: \d{3}-\d{4,5}  (4 OR 5 digit suffix)
 */
function parseProductLine(line) {
  const tokens = line.trim().split(/\s+/);

  // Must open with a valid product code
  if (!/^\d{3}-\d{4,5}$/.test(tokens[0])) return null;

  const codigo = tokens[0];
  let idx = 1;

  // Optional barcode: ≥10 consecutive digits (may have leading zeros)
  let codigo_barra = "";
  if (idx < tokens.length && /^\d{10,}$/.test(tokens[idx])) {
    codigo_barra = tokens[idx];
    idx++;
  }

  // Quantity: integer (3) or decimal (8,00)
  if (idx >= tokens.length || !isPriceToken(tokens[idx])) return null;
  const cantidad = parseNum(tokens[idx]);
  idx++;

  // Remaining = description words + 4 trailing price columns
  const rest = tokens.slice(idx);
  if (rest.length < 5) return null;

  // Collect exactly 4 trailing price tokens from the right
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

  return {
    codigo,
    codigo_barra,
    cantidad,
    descripcion,
    precio_unitario,
    gravadas_10,
    total_linea: cantidad * precio_unitario,
  };
}

function grab(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

/**
 * CJX invoices place "Nombre Cliente:" and "Ruc:" on the same visual line,
 * while the actual client name is on a SEPARATE line.
 * This function finds that standalone name line.
 */
function extractClientName(lines) {
  const labelIdx = lines.findIndex((l) => /nombre\s+cliente/i.test(l));
  if (labelIdx === -1) return "";
  for (let i = labelIdx + 1; i <= labelIdx + 5 && i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^[\d\-\/]+$/.test(l)) continue;
    if (/^\d{2}[-\/][A-Za-z0-9]+/i.test(l)) continue;
    if (/[:\s]+(ruc|tel|dir|nro|fecha|cond|vend)/i.test(l)) continue;
    if (/^(avda|mcal|calle|av\.|rua)/i.test(l)) continue;
    if (/[A-Za-záéíóúÁÉÍÓÚñÑ]/.test(l) && l.length > 2) return l;
  }
  return "";
}

function cleanPhone(raw) {
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 6 ? raw.trim().replace(/,\s*$/, "").trim() : "";
}

export function parseInvoice(lines) {
  const full = lines.join("\n");

  const metadata = {
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

  const productos = [];
  for (const line of lines) {
    const product = parseProductLine(line);
    if (product) productos.push(product);
  }

  const totalMatch = full.match(/total\s+a\s+pagar[^0-9]*([\d.,]+)/i);
  const total = totalMatch
    ? parseNum(totalMatch[1])
    : productos.reduce((s, p) => s + p.total_linea, 0);

  return { metadata, productos, total };
}
