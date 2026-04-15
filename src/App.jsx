import { useMemo, useRef, useState, useCallback } from "react";
import { extractPdfLines, parseInvoice } from "./utils/pdfParser.js";
import { buildExcel, downloadWorkbook } from "./utils/excel.js";
import "./App.css";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(n) {
  return new Intl.NumberFormat("es-PY").format(Math.round(n || 0));
}

const STATUS_MAP = {
  pending: {
    label: "Pendiente",
    tone: "pending",
    helper: "Listo para conversión",
  },
  processing: {
    label: "Procesando",
    tone: "processing",
    helper: "Extrayendo y estructurando datos",
  },
  done: {
    label: "Completado",
    tone: "done",
    helper: "Archivo listo para descarga",
  },
  error: {
    label: "Revisión requerida",
    tone: "error",
    helper: "No se pudo interpretar el documento",
  },
};

function FileCard({ item, onProcess, onDownload, onRemove }) {
  const state = STATUS_MAP[item.status];
  const invoice = item.data;
  const products = invoice?.productos?.length ?? 0;

  return (
    <article className={`record-card record-card--${item.status}`}>
      <div className="record-card__head">
        <div className="record-card__file">
          <div className="record-card__icon">
            <PdfIcon />
          </div>

          <div className="record-card__main">
            <div className="record-card__title-row">
              <p className="record-card__name" title={item.name}>
                {item.name}
              </p>
              <span className={`status-chip status-chip--${state.tone}`}>
                {item.status === "processing" && <span className="spinner" />}
                {state.label}
              </span>
            </div>

            <p className="record-card__meta">
              <span>{formatSize(item.file.size)}</span>
              <span className="dot" />
              <span>{state.helper}</span>
            </p>
          </div>
        </div>

        <div className="record-card__actions">
          {item.status === "pending" && (
            <button className="btn btn--primary btn--sm" onClick={() => onProcess(item)}>
              Convertir
            </button>
          )}

          {item.status === "error" && (
            <button className="btn btn--secondary btn--sm" onClick={() => onProcess(item)}>
              Reintentar
            </button>
          )}

          {item.status === "done" && (
            <button className="btn btn--success btn--sm" onClick={() => onDownload(item)}>
              <DownloadIcon />
              Descargar Excel
            </button>
          )}

          <button
            className="btn btn--icon btn--sm"
            onClick={() => onRemove(item.id)}
            title="Eliminar archivo"
            aria-label="Eliminar archivo"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="record-card__body">
        {item.status === "done" && invoice && (
          <>
            <div className="record-grid">
              <InfoBlock
                label="Documento"
                value={invoice.metadata?.numero_documento || "No disponible"}
              />
              <InfoBlock label="Fecha" value={invoice.metadata?.fecha || "No disponible"} />
              <InfoBlock label="Cliente" value={invoice.metadata?.cliente || "No identificado"} />
              <InfoBlock label="Productos" value={`${products} ítem${products !== 1 ? "s" : ""}`} />
            </div>

            <div className="record-tags">
              {invoice.total > 0 && (
                <span className="tag tag--amount">Total Gs. {formatCurrency(invoice.total)}</span>
              )}
              <span className="tag">Estructura preparada para exportación</span>
            </div>
          </>
        )}

        {item.status === "error" && item.error && (
          <div className="notice notice--error">
            <AlertIcon />
            <span>{item.error}</span>
          </div>
        )}

        {item.status === "processing" && (
          <div className="notice notice--info">
            <PulseIcon />
            <span>El documento se está analizando localmente para generar una salida estructurada.</span>
          </div>
        )}
      </div>
    </article>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="info-block">
      <span className="info-block__label">{label}</span>
      <span className="info-block__value">{value}</span>
    </div>
  );
}

function MetricCard({ label, value, tone = "default", helper, icon }) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon">{icon}</div>
      <div>
        <span className="metric-card__label">{label}</span>
        <strong className="metric-card__value">{value}</strong>
        {helper && <p className="metric-card__helper">{helper}</p>}
      </div>
    </div>
  );
}

function ChecklistItem({ title, text }) {
  return (
    <div className="check-item">
      <span className="check-item__bullet" />
      <div>
        <p className="check-item__title">{title}</p>
        <p className="check-item__text">{text}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((rawFiles) => {
    const items = Array.from(rawFiles)
      .filter((file) => file.type === "application/pdf")
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        status: "pending",
        data: null,
        error: null,
      }));

    if (items.length) {
      setFiles((previous) => [...previous, ...items]);
    }
  }, []);

  const processItem = async (item) => {
    setFiles((previous) =>
      previous.map((file) =>
        file.id === item.id ? { ...file, status: "processing", error: null } : file
      )
    );

    try {
      const lines = await extractPdfLines(item.file);
      const data = parseInvoice(lines);

      if (!data.productos || data.productos.length === 0) {
        throw new Error(
          "No se encontraron productos en el PDF. Verificá que el formato corresponda al documento esperado."
        );
      }

      setFiles((previous) =>
        previous.map((file) => (file.id === item.id ? { ...file, status: "done", data } : file))
      );
    } catch (error) {
      setFiles((previous) =>
        previous.map((file) =>
          file.id === item.id
            ? { ...file, status: "error", error: error.message || "Ocurrió un error inesperado." }
            : file
        )
      );
    }
  };

  const processAll = async () => {
    const actionableFiles = files.filter(
      (file) => file.status === "pending" || file.status === "error"
    );

    for (const item of actionableFiles) {
      await processItem(item);
    }
  };

  const downloadItem = (item) => {
    const workbook = buildExcel(item.data);
    downloadWorkbook(workbook, item.name.replace(/\.pdf$/i, ".xlsx"));
  };

  const clearAll = () => setFiles([]);
  const removeItem = (id) => setFiles((previous) => previous.filter((file) => file.id !== id));

  const counts = useMemo(
    () => ({
      total: files.length,
      pending: files.filter((file) => file.status === "pending").length,
      processing: files.filter((file) => file.status === "processing").length,
      done: files.filter((file) => file.status === "done").length,
      error: files.filter((file) => file.status === "error").length,
    }),
    [files]
  );

  const actionable = counts.pending + counts.error;
  const busy = counts.processing > 0;

  return (
    <div className="app-shell">
      <div className="app-shell__glow app-shell__glow--one" />
      <div className="app-shell__glow app-shell__glow--two" />

      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <div className="brand__mark">
              <LogoIcon />
            </div>
            <div>
              <p className="brand__name">DataBridge</p>
              <p className="brand__sub">Conversión documental</p>
            </div>
          </div>

          <div className="topbar__meta">
            <span className="topbar__pill">
              <LockIcon />
              Operación local
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="hero-panel">
          <div className="hero-panel__content">
            <span className="eyebrow">Centro de procesamiento</span>
            <h1>Convierte facturas PDF a Excel con una interfaz más clara y profesional.</h1>
            <p>
              Cargá múltiples documentos, controlá el estado de cada archivo y descargá resultados
              estructurados en un flujo ordenado, limpio y orientado a operación.
            </p>

            <div className="hero-panel__chips">
              <span className="soft-chip">Carga múltiple</span>
              <span className="soft-chip">Validación por archivo</span>
              <span className="soft-chip">Exportación inmediata</span>
            </div>
          </div>

          <div className="hero-panel__summary">
            <div className="summary-card summary-card--accent">
              <span className="summary-card__label">Documentos cargados</span>
              <strong className="summary-card__value">{counts.total}</strong>
              <p className="summary-card__text">Seguimiento centralizado del lote actual.</p>
            </div>

            <div className="summary-card">
              <span className="summary-card__label">Estado operativo</span>
              <strong className="summary-card__value">
                {counts.processing > 0 ? "En curso" : counts.error > 0 ? "Con observaciones" : "Disponible"}
              </strong>
              <p className="summary-card__text">
                {counts.processing > 0
                  ? "Hay archivos siendo procesados en este momento."
                  : counts.error > 0
                    ? "Algunos documentos requieren revisión o reintento."
                    : "Podés cargar o convertir nuevos archivos cuando quieras."}
              </p>
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="surface surface--primary">
            <div className="section-heading">
              <div>
                <span className="section-heading__eyebrow">Ingreso de documentos</span>
                <h2>Carga de archivos</h2>
              </div>
              <button className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()}>
                Seleccionar PDFs
              </button>
            </div>

            <div
              className={`dropzone ${dragging ? "dropzone--active" : ""}`}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              aria-label="Zona de carga de archivos PDF"
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                multiple
                className="visually-hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />

              <div className="dropzone__icon">
                <UploadIcon />
              </div>
              <p className="dropzone__title">
                {dragging ? "Soltá los archivos aquí" : "Arrastrá tus PDFs o hacé clic para seleccionarlos"}
              </p>
              <p className="dropzone__text">
                Compatible con carga múltiple y revisión individual por documento.
              </p>
            </div>
          </div>

          <aside className="surface surface--secondary">
            <div className="section-heading section-heading--compact">
              <div>
                <span className="section-heading__eyebrow">Control operativo</span>
                <h2>Buenas señales de uso</h2>
              </div>
            </div>

            <div className="checklist">
              <ChecklistItem
                title="Proceso visible"
                text="Cada archivo muestra su estado, detalles principales y acciones disponibles."
              />
              <ChecklistItem
                title="Interfaz orientada a productividad"
                text="Menos ruido visual, más foco en el lote actual y en la salida final."
              />
              <ChecklistItem
                title="Descarga inmediata"
                text="Cuando un archivo queda listo, la exportación está disponible al instante."
              />
            </div>
          </aside>
        </section>

        <section className="metrics-grid">
          <MetricCard
            label="Total"
            value={counts.total}
            helper="Archivos cargados en esta sesión"
            icon={<StackIcon />}
          />
          <MetricCard
            label="Pendientes"
            value={counts.pending}
            tone="pending"
            helper="Listos para convertir"
            icon={<ClockIcon />}
          />
          <MetricCard
            label="En proceso"
            value={counts.processing}
            tone="processing"
            helper="Trabajándose ahora"
            icon={<PulseIcon />}
          />
          <MetricCard
            label="Completados"
            value={counts.done}
            tone="done"
            helper="Disponibles para descarga"
            icon={<CheckCircleIcon />}
          />
          <MetricCard
            label="Observaciones"
            value={counts.error}
            tone="error"
            helper="Documentos con error"
            icon={<AlertIcon />}
          />
        </section>

        <section className="surface surface--primary">
          <div className="section-heading section-heading--with-actions">
            <div>
              <span className="section-heading__eyebrow">Lote actual</span>
              <h2>Archivos procesados</h2>
            </div>

            <div className="toolbar-actions">
              <button className="btn btn--ghost btn--sm" onClick={clearAll} disabled={files.length === 0}>
                Limpiar todo
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={processAll}
                disabled={actionable === 0 || busy}
              >
                {busy
                  ? "Procesando..."
                  : actionable === 0
                    ? "Sin pendientes"
                    : `Convertir ${actionable === counts.total ? "todo" : `restantes (${actionable})`}`}
              </button>
            </div>
          </div>

          {files.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <FolderIcon />
              </div>
              <h3>No hay archivos cargados</h3>
              <p>
                Empezá arrastrando facturas en PDF para ver el seguimiento del lote y la descarga de
                resultados desde este mismo panel.
              </p>
            </div>
          ) : (
            <div className="record-list">
              {files.map((item) => (
                <FileCard
                  key={item.id}
                  item={item}
                  onProcess={processItem}
                  onDownload={downloadItem}
                  onRemove={removeItem}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Diseño operativo · Presentación profesional · Conversión local</p>
      </footer>
    </div>
  );
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#logo-gradient)" />
      <path d="M6.5 14.5h3l2.2-6 3.6 9 1.7-4h1.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="logo-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C3AED" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.75v11.5" />
      <path d="M7.75 8 12 3.75 16.25 8" />
      <path d="M4 15.5v1.25A3.25 3.25 0 0 0 7.25 20h9.5A3.25 3.25 0 0 0 20 16.75V15.5" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M8.5 14.5h1.25a1.75 1.75 0 1 0 0-3.5H8.5v6" />
      <path d="M14 11h1.5a2 2 0 0 1 0 4H14z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 9 4.5-9 4.5L3 7.5 12 3Z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 17 9 4 9-4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-2.5 5-4-10-2.5 5H2" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.3 4.8-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  );
}
