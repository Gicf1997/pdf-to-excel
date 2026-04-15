import { useState, useRef, useCallback } from "react";
import { extractPdfLines, parseInvoice } from "./utils/pdfParser.js";
import { buildExcel, downloadWorkbook } from "./utils/excel.js";
import "./App.css";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(n) {
  return new Intl.NumberFormat("es-PY").format(Math.round(n));
}

const STATUS_MAP = {
  pending:    { label: "Pendiente",   cls: "badge--pending"    },
  processing: { label: "Procesando",  cls: "badge--processing" },
  done:       { label: "Listo",       cls: "badge--done"       },
  error:      { label: "Error",       cls: "badge--error"      },
};

function FileCard({ item, onProcess, onDownload, onRemove }) {
  const s = STATUS_MAP[item.status];
  const inv = item.data;

  return (
    <div className={`file-card file-card--${item.status}`}>
      <div className="file-card__icon">
        <PdfIcon />
      </div>

      <div className="file-card__info">
        <p className="file-card__name" title={item.name}>{item.name}</p>
        <p className="file-card__meta">
          {formatSize(item.file.size)}
          {item.status === "error" && item.error && (
            <span className="meta--error"> · {item.error}</span>
          )}
          {item.status === "done" && inv && (
            <span className="meta--success">
              {" "}· {inv.productos?.length ?? 0} producto{inv.productos?.length !== 1 ? "s" : ""}
              {inv.metadata?.cliente ? ` · ${inv.metadata.cliente}` : ""}
            </span>
          )}
        </p>

        {item.status === "done" && inv && (
          <div className="file-card__preview">
            {inv.metadata?.fecha && (
              <span className="preview-tag">{inv.metadata.fecha}</span>
            )}
            {inv.metadata?.numero_documento && (
              <span className="preview-tag">{inv.metadata.numero_documento}</span>
            )}
            {inv.total > 0 && (
              <span className="preview-tag preview-tag--amount">
                Gs. {formatCurrency(inv.total)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="file-card__right">
        <span className={`badge ${s.cls}`}>
          {item.status === "processing" && <span className="spinner" />}
          {s.label}
        </span>

        <div className="file-card__actions">
          {item.status === "pending" && (
            <button className="btn btn--primary btn--sm" onClick={() => onProcess(item)}>
              Convertir
            </button>
          )}
          {item.status === "error" && (
            <button className="btn btn--ghost btn--sm" onClick={() => onProcess(item)}>
              Reintentar
            </button>
          )}
          {item.status === "done" && (
            <button className="btn btn--success btn--sm" onClick={() => onDownload(item)}>
              <DownloadIcon />
              Descargar .xlsx
            </button>
          )}
          <button
            className="btn btn--icon btn--sm"
            onClick={() => onRemove(item.id)}
            title="Eliminar"
          >
            <CloseIcon />
          </button>
        </div>
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
      .filter((f) => f.type === "application/pdf")
      .map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        status: "pending",
        data: null,
        error: null,
      }));
    if (items.length) setFiles((p) => [...p, ...items]);
  }, []);

  const processItem = async (item) => {
    setFiles((p) =>
      p.map((f) => (f.id === item.id ? { ...f, status: "processing", error: null } : f))
    );
    try {
      const lines = await extractPdfLines(item.file);
      const data = parseInvoice(lines);

      if (!data.productos || data.productos.length === 0) {
        throw new Error("No se encontraron productos en el PDF. Verificá que sea una factura CJX S.A.");
      }

      setFiles((p) => p.map((f) => (f.id === item.id ? { ...f, status: "done", data } : f)));
    } catch (e) {
      setFiles((p) =>
        p.map((f) => (f.id === item.id ? { ...f, status: "error", error: e.message } : f))
      );
    }
  };

  const processAll = async () => {
    const pending = files.filter((f) => f.status === "pending" || f.status === "error");
    for (const item of pending) await processItem(item);
  };

  const downloadItem = (item) => {
    const wb = buildExcel(item.data);
    downloadWorkbook(wb, item.name.replace(/\.pdf$/i, ".xlsx"));
  };

  const removeItem = (id) => setFiles((p) => p.filter((f) => f.id !== id));

  const counts = {
    total:      files.length,
    pending:    files.filter((f) => f.status === "pending").length,
    processing: files.filter((f) => f.status === "processing").length,
    done:       files.filter((f) => f.status === "done").length,
    error:      files.filter((f) => f.status === "error").length,
  };
  const actionable = counts.pending + counts.error;
  const busy = counts.processing > 0;

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__brand">
            <LogoIcon />
            <span className="header__name">DataBridge</span>
          </div>
          <span className="header__tag">Conversor PDF → Excel</span>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero__inner">
          <h1 className="hero__title">
            Facturas PDF<br />a Excel en segundos
          </h1>
          <p className="hero__sub">
            Procesamiento local — tus archivos nunca salen de tu navegador.
            Sin costos, sin límites, sin servidores.
          </p>
          <div className="hero__badges">
            <span className="hero-badge"><LockIcon /> 100% local</span>
            <span className="hero-badge"><ZapIcon /> Sin conexión a AI</span>
            <span className="hero-badge"><FreeIcon /> Gratuito</span>
          </div>
        </div>
      </section>

      {/* Main */}
      <main className="main">
        {/* Dropzone */}
        <div
          className={`dropzone ${dragging ? "dropzone--active" : ""}`}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          aria-label="Zona de carga de archivos PDF"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            multiple
            className="visually-hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <div className="dropzone__icon">
            <UploadIcon />
          </div>
          <p className="dropzone__primary">
            {dragging ? "Soltá los archivos acá" : "Arrastrá tus PDFs o hacé clic para seleccionar"}
          </p>
          <p className="dropzone__secondary">
            Facturas CJX S.A. · Múltiples archivos a la vez
          </p>
        </div>

        {/* Toolbar */}
        {files.length > 0 && (
          <div className="toolbar">
            <div className="toolbar__stats">
              <Pill label="Total" value={counts.total} />
              {counts.done > 0 && <Pill label="Listos" value={counts.done} variant="success" />}
              {counts.error > 0 && <Pill label="Errores" value={counts.error} variant="error" />}
              {counts.processing > 0 && (
                <Pill label="Procesando" value={counts.processing} variant="info" />
              )}
            </div>
            <div className="toolbar__actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setFiles([])}>
                Limpiar todo
              </button>
              {actionable > 0 && !busy && (
                <button className="btn btn--primary btn--sm" onClick={processAll}>
                  Convertir {actionable === counts.total ? "todos" : `restantes (${actionable})`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="file-list">
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

        {/* Empty state features */}
        {files.length === 0 && (
          <div className="features-grid">
            <Feature
              icon={<ShieldIcon />}
              title="Procesamiento local"
              desc="Los PDFs nunca se suben a ningún servidor. Todo ocurre en tu navegador."
            />
            <Feature
              icon={<ZapIcon2 />}
              title="Rápido y sin límites"
              desc="Sin cuotas, sin API keys, sin esperas. Procesá cientos de facturas."
            />
            <Feature
              icon={<FileCheckIcon />}
              title="Excel estructurado"
              desc="Dos hojas: Información de la factura y tabla de productos lista para el WMS."
            />
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Procesamiento local · Sin IA · Sin costo</p>
      </footer>
    </div>
  );
}

function Pill({ label, value, variant = "default" }) {
  return (
    <span className={`pill pill--${variant}`}>
      <strong>{value}</strong> {label}
    </span>
  );
}

function Feature({ icon, title, desc }) {
  return (
    <div className="feature">
      <div className="feature__icon">{icon}</div>
      <p className="feature__title">{title}</p>
      <p className="feature__desc">{desc}</p>
    </div>
  );
}

// Icons
function LogoIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect width="28" height="28" rx="7" fill="#6366F1" />
      <path d="M7 14h4l2-6 4 12 2-6h2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12m0-12L8 8m4-4l4 4" />
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4" />
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
function ZapIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function FreeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function ZapIcon2() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function FileCheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" /><polyline points="9 15 11 17 15 13" />
    </svg>
  );
}
