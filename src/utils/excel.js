import * as XLSX from "xlsx";

const FACTURA_META = {
  tipo_documento:   "Tipo de Documento",
  fecha:            "Fecha Emisión",
  nro_factura:      "Nro. Factura",
  numero_documento: "Nro. Documento",
  cliente:          "Cliente",
  ruc:              "RUC",
  direccion:        "Dirección",
  telefono:         "Teléfono",
  condicion_venta:  "Condición de Venta",
  vendedor:         "Vendedor",
};

const REMISION_META = {
  tipo_documento:   "Tipo de Documento",
  fecha:            "Fecha de Emisión",
  numero_documento: "Nro. Remisión",
  nro_reg:          "Nro. Reg.",
  timbrado:         "Timbrado",
  cliente:          "Destinatario",
  punto_partida:    "Punto de Partida",
  punto_llegada:    "Punto de Llegada",
  motivo:           "Motivo de Traslado",
  rua:              "RUA",
  conductor:        "Conductor",
};

function buildFacturaExcel(invoice) {
  const wb = XLSX.utils.book_new();
  const meta = invoice.metadata || {};

  const wsInfo = XLSX.utils.aoa_to_sheet([
    ["Campo", "Valor"],
    ...Object.entries(FACTURA_META).map(([k, label]) => [label, meta[k] ?? ""]),
    [],
    ["Total Factura", invoice.total ?? 0],
  ]);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Información");

  const headers = ["Código", "Código de Barra", "Cantidad", "Descripción", "Precio Unitario", "Gravadas 10%", "Total Línea"];
  const prods = invoice.productos || [];
  const rows = prods.map((p) => [p.codigo, p.codigo_barra, p.cantidad, p.descripcion, p.precio_unitario, p.gravadas_10, p.total_linea ?? p.cantidad * p.precio_unitario]);
  const grand = rows.reduce((s, r) => s + (r[6] ?? 0), 0);
  const wsP = XLSX.utils.aoa_to_sheet([headers, ...rows, ["", "", "", "TOTAL", "", "", grand]]);
  wsP["!cols"] = [{ wch: 13 }, { wch: 19 }, { wch: 10 }, { wch: 50 }, { wch: 17 }, { wch: 17 }, { wch: 17 }];
  XLSX.utils.book_append_sheet(wb, wsP, "Productos");
  return wb;
}

function buildRemisionExcel(invoice) {
  const wb = XLSX.utils.book_new();
  const meta = invoice.metadata || {};

  const wsInfo = XLSX.utils.aoa_to_sheet([
    ["Campo", "Valor"],
    ...Object.entries(REMISION_META).map(([k, label]) => [label, meta[k] ?? ""]),
  ]);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Remisión");

  const prods = invoice.productos || [];
  const rows = prods.map((p) => [p.codigo, p.cantidad, p.descripcion]);
  const total = prods.reduce((s, p) => s + (p.cantidad ?? 0), 0);
  const wsM = XLSX.utils.aoa_to_sheet([["Código", "Cantidad", "Descripción"], ...rows, ["", "TOTAL UNIDADES", total]]);
  wsM["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsM, "Mercaderías");
  return wb;
}

export function buildExcel(invoice) {
  return invoice.docType === "remision" ? buildRemisionExcel(invoice) : buildFacturaExcel(invoice);
}

export function downloadWorkbook(wb, filename) {
  XLSX.writeFile(wb, filename);
}

/** Returns an ArrayBuffer for use with the File System Access API (bulk download). */
export function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}