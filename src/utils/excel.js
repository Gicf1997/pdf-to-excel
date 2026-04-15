import * as XLSX from "xlsx";

const META_LABELS = {
  fecha: "Fecha Emisión",
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
  const meta = invoice.metadata || {};

  // ── Hoja 1: Información general ─────────────────────────────────────────
  const infoRows = [
    ["Campo", "Valor"],
    ...Object.entries(META_LABELS).map(([k, label]) => [label, meta[k] ?? ""]),
    [],
    ["Total Factura", invoice.total ?? 0],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Información");

  // ── Hoja 2: Productos ────────────────────────────────────────────────────
  const headers = [
    "Código",
    "Código de Barra",
    "Cantidad",
    "Descripción",
    "Precio Unitario",
    "Gravadas 10%",
    "Total Línea",
  ];

  const prods = invoice.productos || [];
  const rows = prods.map((p) => [
    p.codigo,
    p.codigo_barra,
    p.cantidad,
    p.descripcion,
    p.precio_unitario,
    p.gravadas_10,
    p.total_linea ?? p.cantidad * p.precio_unitario,
  ]);

  const grandTotal = rows.reduce((s, r) => s + (r[6] ?? 0), 0);
  const totalRow = ["", "", "", "TOTAL", "", "", grandTotal];

  const wsProds = XLSX.utils.aoa_to_sheet([headers, ...rows, totalRow]);
  wsProds["!cols"] = [
    { wch: 13 },
    { wch: 19 },
    { wch: 10 },
    { wch: 50 },
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
