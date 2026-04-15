import * as XLSX from "xlsx";

const LABEL_MAP = {
  fecha: "Fecha",
  numero_documento: "Nro. Documento",
  cliente: "Cliente",
  ruc: "RUC",
  direccion: "Dirección",
  telefono: "Teléfono",
  condicion_venta: "Condición de Venta",
  vendedor: "Vendedor",
};

export function buildExcel(invoice) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Invoice metadata ────────────────────────────────────────────
  const meta = invoice.metadata || {};
  const infoRows = [
    ["Campo", "Valor"],
    ...Object.entries(LABEL_MAP).map(([k, label]) => [label, meta[k] ?? ""]),
    [],
    ["Total Factura", invoice.total ?? ""],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Información");

  // ── Sheet 2: Products ────────────────────────────────────────────────────
  const prods = invoice.productos || [];
  const headers = [
    "Código",
    "Código de Barra",
    "Cantidad",
    "Descripción",
    "Precio Unitario",
    "Gravadas 10%",
    "Total Línea",
  ];
  const rows = prods.map((p) => [
    p.codigo,
    p.codigo_barra,
    p.cantidad,
    p.descripcion,
    p.precio_unitario,
    p.gravadas_10,
    (p.cantidad ?? 0) * (p.precio_unitario ?? 0),
  ]);
  const grandTotal = rows.reduce((s, r) => s + (r[6] ?? 0), 0);
  const totalRow = ["", "", "", "TOTAL", "", "", grandTotal];

  const wsProds = XLSX.utils.aoa_to_sheet([headers, ...rows, totalRow]);
  wsProds["!cols"] = [
    { wch: 13 },
    { wch: 19 },
    { wch: 10 },
    { wch: 48 },
    { wch: 17 },
    { wch: 17 },
    { wch: 17 },
  ];
  XLSX.utils.book_append_sheet(wb, wsProds, "Productos");

  return wb;
}

export function downloadWorkbook(wb, filename) {
  XLSX.writeFile(wb, filename);
}
