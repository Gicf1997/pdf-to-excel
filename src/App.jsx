import { useState, useRef, useCallback } from "react";
import { buildExcel, downloadWorkbook } from "./utils/excel.js";
import "./App.css";

async function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function extractInvoice(base64) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_MAP = {
  pending: { label: "Pendiente", cls: "badge--pending" },
  processing: { label: "Procesando", cls: "badge--processing" },
  done: { label: "Listo", cls: "badge--done" },
  error: { label: "Error", cls: "badge--error" },
};

function FileCard({ item, onProcess, onDownload, onRemove }) {
  const s = STATUS_MAP[item.status];
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
            <span className="file-card__error"> · {item.error}</span>
          )}
          {item.status === "done" && item.data && (
            <span className="file-card__success">
              {" "}· {item.data.productos?.length ?? 0} producto{item.data.productos?.length !== 1 ? "s" : ""} encontrado{item.data.productos?.length !== 1 ? "s" : ""}
            </span>
          )}
        </p>
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
          <button className="btn btn--icon btn--sm" onClick={() => onRemove(item.id)} title="Eliminar">
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
    const newItems = Array.from(rawFiles)
      .filter((f) => f.type === "application/pdf")
      .map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        status: "pending",
        data: null,
        error: null,
      }));
    if (newItems.length) setFiles((p) => [...p, ...newItems]);
  }, []);

  const processItem = async (item) => {
    setFiles((p) => p.map((f) => f.id === item.id ? { ...f, status: "processing", error: null } : f));
    try {
      const b64 = await toBase64(item.file);
      const data = await extractInvoice(b64);
      setFiles((p) => p.map((f) => f.id === item.id ? { ...f, status: "done", data } : f));
    } catch (e) {
      setFiles((p) => p.map((f) => f.id === item.id ? { ...f, status: "error", error: e.message } : f));
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
    total: files.length,
    pending: files.filter((f) => f.status === "pending").length,
    processing: files.filter((f) => f.status === "processing").length,
    done: files.filter((f) => f.status === "done").length,
    error: files.filter((f) => f.status === "error").length,
  };
  const actionable = counts.pending + counts.error;
  const busy = counts.processing > 0;

  return (
    <div className="layout">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header__inner">
          <div className="header__brand">
            <LogoIcon />
            <span className="header__name">DataBridge</span>
          </div>
          <span className="header__tag">Conversor PDF → Excel</span>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__inner">
          <h1 className="hero__title">
            Convertí facturas PDF<br />a Excel en segundos
          </h1>
          <p className="hero__sub">
            Cargá una o varias facturas y obtendrás un Excel estructurado con toda la información lista para importar a tu WMS.
          </p>
        </div>
      </section>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="main">

        {/* Drop zone */}
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
          <p className="dropzone__secondary">Compatible con múltiples archivos</p>
        </div>

        {/* Toolbar */}
        {files.length > 0 && (
          <div className="toolbar">
            <div className="toolbar__stats">
              <Pill label="Total" value={counts.total} />
              {counts.done > 0 && <Pill label="Listos" value={counts.done} variant="success" />}
              {counts.error > 0 && <Pill label="Errores" value={counts.error} variant="error" />}
              {counts.processing > 0 && <Pill label="Procesando" value={counts.processing} variant="info" />}
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

        {/* Empty state */}
        {files.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__features">
              <Feature icon={<ShieldIcon />} title="Seguro" desc="Tu API key nunca sale del servidor" />
              <Feature icon={<ZapIcon />} title="Rápido" desc="Extracción con IA en segundos" />
              <Feature icon={<FileCheckIcon />} title="Preciso" desc="Estructura lista para importar al WMS" />
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Powered by Claude · Anthropic AI</p>
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

// ── SVG Icons ──────────────────────────────────────────────────────────────
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
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12m0-12L8 8m4-4l4 4" />
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4" />
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function ZapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function FileCheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="9 15 11 17 15 13" />
    </svg>
  );
}
