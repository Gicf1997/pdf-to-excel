import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// Factura builder
// ─────────────────────────────────────────────────────────────────────────────

const FACTURA_META_LABELS = {
  tipo_documento:   "Tipo de Documento",
  fecha:            "Fecha Emisión",
  numero_documento: "Nro. Documento",
  cliente:          "Cliente",
  ruc:              "RUC",
  direccion:        "Dirección",
  telefono:         "Teléfono",
  condicion_venta:  "Condición de Venta",
  vendedor:         "Vendedor",
};

function buildFacturaExcel(invoice) {
  const wb = XLSX.utils.book_new();
  const meta = invoice.metadata || {};

  // Sheet 1: Información
  const infoRows = [
    ["Campo", "Valor"],
    ...Object.entries(FACTURA_META_LABELS).map(([k, label]) => [label, meta[k] ?? ""]),
    [],
    ["Total Factura", invoice.total ?? 0],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Información");

  // Sheet 2: Productos
  const headers = ["Código", "Código de Barra", "Cantidad", "Descripción", "Precio Unitario", "Gravadas 10%", "Total Línea"];
  const prods = invoice.productos || [];
  const rows = prods.map((p) => [
    p.codigo, p.codigo_barra, p.cantidad, p.descripcion,
    p.precio_unitario, p.gravadas_10,
    p.total_linea ?? p.cantidad * p.precio_unitario,
  ]);
  const grandTotal = rows.reduce((s, r) => s + (r[6] ?? 0), 0);
  const wsProds = XLSX.utils.aoa_to_sheet([headers, ...rows, ["", "", "", "TOTAL", "", "", grandTotal]]);
  wsProds["!cols"] = [{ wch: 13 }, { wch: 19 }, { wch: 10 }, { wch: 50 }, { wch: 17 }, { wch: 17 }, { wch: 17 }];
  XLSX.utils.book_append_sheet(wb, wsProds, "Productos");

  return wb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nota de Remisión builder
// ─────────────────────────────────────────────────────────────────────────────

const REMISION_META_LABELS = {
  tipo_documento:   "Tipo de Documento",
  fecha:            "Fecha de Emisión",
  numero_documento: "Nro. Remisión",
  nro_reg:          "Nro. Reg.",
  timbrado:         "Timbrado",
  cliente:          "Destinatario",
  punto_partida:    "Punto de Partida",
  punto_llegada:    "Punto de Llegada",
  motivo:           "Motivo de Traslado",
  vehiculo:         "Vehículo",
  rua:              "RUA",
  conductor:        "Conductor",
};

function buildRemisionExcel(invoice) {
  const wb = XLSX.utils.book_new();
  const meta = invoice.metadata || {};

  // Sheet 1: Remisión
  const infoRows = [
    ["Campo", "Valor"],
    ...Object.entries(REMISION_META_LABELS).map(([k, label]) => [label, meta[k] ?? ""]),
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Remisión");

  // Sheet 2: Mercaderías
  const headers = ["Código", "Cantidad", "Descripción"];
  const prods = invoice.productos || [];
  const rows = prods.map((p) => [p.codigo, p.cantidad, p.descripcion]);
  const totalUnidades = prods.reduce((s, p) => s + (p.cantidad ?? 0), 0);

  const wsMerc = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows,
    ["", "TOTAL UNIDADES", totalUnidades],
  ]);
  wsMerc["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsMerc, "Mercaderías");

  return wb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified export
// ─────────────────────────────────────────────────────────────────────────────

export function buildExcel(invoice) {
  return invoice.docType === "remision"
    ? buildRemisionExcel(invoice)
    : buildFacturaExcel(invoice);
}

export function downloadWorkbook(wb, filename) {
  XLSX.writeFile(wb, filename);
}