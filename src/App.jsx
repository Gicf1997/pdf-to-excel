import { useState, useRef, useCallback, useEffect } from "react";
import { extractPdfLines, parseInvoice } from "./utils/pdfParser.js";
import { buildExcel, downloadWorkbook } from "./utils/excel.js";
import "./App.css";

const MAX_FILES = 10;
const MAX_MB    = 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;

function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtGs(n) {
  return new Intl.NumberFormat("es-PY").format(Math.round(n));
}

// Simulates progress messages during processing
const STEPS = [
  { pct: 15, msg: "Leyendo estructura del documento…" },
  { pct: 40, msg: "Extrayendo filas de productos…"    },
  { pct: 70, msg: "Calculando totales…"                },
  { pct: 90, msg: "Generando hoja Excel…"              },
];

function useProcessingSteps(status) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (status !== "processing") { setStepIdx(0); setPct(0); return; }
    let i = 0;
    const tick = () => {
      if (i >= STEPS.length) return;
      setStepIdx(i);
      setPct(STEPS[i].pct);
      i++;
    };
    tick();
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, [status]);

  return { pct, msg: STEPS[stepIdx]?.msg ?? "" };
}

// ── File card ────────────────────────────────────────────────────────────────
function FileCard({ item, onProcess, onDownload, onRemove }) {
  const { pct, msg } = useProcessingSteps(item.status);
  const inv = item.data;

  return (
    <div className={`card card--${item.status}`} role="listitem">
      {/* Left accent */}
      <div className="card__accent" />

      {/* PDF icon */}
      <div className="card__icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="12" y2="17"/>
        </svg>
      </div>

      {/* Main content */}
      <div className="card__body">
        <div className="card__header">
          <span className="card__name" title={item.name}>{item.name}</span>
          <span className="card__size">{fmtSize(item.file.size)}</span>
        </div>

        {/* Processing progress */}
        {item.status === "processing" && (
          <div className="card__progress-wrap">
            <div className="card__progress-bar">
              <div className="card__progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="card__progress-msg">{msg}</span>
          </div>
        )}

        {/* Error message */}
        {item.status === "error" && (
          <p className="card__error">{item.error}</p>
        )}

        {/* Results summary */}
        {item.status === "done" && inv && (
          <div className="card__results">
            <Chip icon={inv.docType === "remision" ? <RemisionIcon /> : <FacturaIcon />}
              label={inv.docType === "remision" ? "Nota de Remisión" : "Factura"}
              cls={inv.docType === "remision" ? "chip--remision" : "chip--factura"} />
            {inv.metadata?.cliente && (
              <Chip icon={<UserIcon />} label={inv.metadata.cliente} />
            )}
            <Chip icon={<BoxIcon />} label={`${inv.productos?.length ?? 0} ${inv.docType === "remision" ? "artículo" : "producto"}${(inv.productos?.length ?? 0) !== 1 ? "s" : ""}`} highlight />
            {inv.docType === "factura" && inv.total > 0 && (
              <Chip icon={<CoinsIcon />} label={`Gs. ${fmtGs(inv.total)}`} />
            )}
            {inv.docType === "remision" && (
              <Chip icon={<TruckIcon />} label={inv.metadata?.motivo ?? "Traslado"} />
            )}
            {inv.metadata?.fecha && (
              <Chip icon={<CalIcon />} label={inv.metadata.fecha} />
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card__actions">
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
            <span>Descargar</span>
          </button>
        )}
        {item.status !== "processing" && (
          <button className="btn btn--icon" onClick={() => onRemove(item.id)} title="Eliminar archivo">
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ icon, label, highlight }) {
  return (
    <span className={`chip${highlight ? " chip--hl" : ""}`}>
      {icon}
      {label}
    </span>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ["Cargar archivos", "Convertir", "Descargar Excel"];
  return (
    <div className="stepbar" role="navigation" aria-label="Pasos del proceso">
      {steps.map((s, i) => {
        const num   = i + 1;
        const done  = step > num;
        const active = step === num;
        return (
          <div key={i} className={`step ${done ? "step--done" : ""} ${active ? "step--active" : ""}`}>
            <div className="step__dot">
              {done ? <CheckIcon /> : <span>{num}</span>}
            </div>
            <span className="step__label">{s}</span>
            {i < steps.length - 1 && <div className="step__line" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ files }) {
  const done = files.filter(f => f.status === "done");
  if (done.length === 0) return null;
  const totalProds  = done.reduce((s, f) => s + (f.data?.productos?.length ?? 0), 0);
  const facturas = done.filter(f => f.data?.docType !== 'remision');
  const totalAmount = facturas.reduce((s, f) => s + (f.data?.total ?? 0), 0);

  return (
    <div className="summary">
      <SumStat value={done.length}   label="facturas procesadas" icon={<DocIcon />}   />
      <div className="summary__div" />
      <SumStat value={totalProds}    label="productos extraídos"  icon={<BoxIcon />}   />
      <div className="summary__div" />
      {totalAmount > 0 && <><div className="summary__div" /><SumStat value={`Gs. ${fmtGs(totalAmount)}`} label="monto facturas" icon={<CoinsIcon />} raw /></>}
    </div>
  );
}

function SumStat({ value, label, icon, raw }) {
  return (
    <div className="sum-stat">
      <div className="sum-stat__icon">{icon}</div>
      <div>
        <p className="sum-stat__value">{raw ? value : value.toLocaleString("es-PY")}</p>
        <p className="sum-stat__label">{label}</p>
      </div>
    </div>
  );
}

// ── Upload limits badge ───────────────────────────────────────────────────────
function LimitsBadge() {
  return (
    <div className="limits">
      <span className="limits__item">
        <FilesIcon />
        Hasta {MAX_FILES} archivos por lote
      </span>
      <span className="limits__sep" />
      <span className="limits__item">
        <WeightIcon />
        Máx. {MAX_MB} MB por archivo
      </span>
      <span className="limits__sep" />
      <span className="limits__item">
        <PdfBadgeIcon />
        Solo formato PDF
      </span>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState([]);
  const inputRef = useRef(null);

  const addFiles = useCallback((rawFiles) => {
    const incoming = Array.from(rawFiles);
    const rejected = [];
    const accepted = [];

    const currentCount = files.length;

    for (const f of incoming) {
      // Some PDFs (e.g. electronic invoices with embedded XML) are detected as
      // application/octet-stream — fall back to extension check.
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!isPdf) {
        rejected.push(`"${f.name}" — no es un PDF`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        rejected.push(`"${f.name}" — supera ${MAX_MB} MB (${fmtSize(f.size)})`);
        continue;
      }
      if (currentCount + accepted.length >= MAX_FILES) {
        rejected.push(`"${f.name}" — límite de ${MAX_FILES} archivos alcanzado`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file: f, name: f.name, status: "pending", data: null, error: null });
    }

    if (accepted.length) setFiles(p => [...p, ...accepted]);
    if (rejected.length) {
      setRejections(rejected);
      setTimeout(() => setRejections([]), 5000);
    }
  }, [files]);

  const processItem = async (item) => {
    setFiles(p => p.map(f => f.id === item.id ? { ...f, status: "processing", error: null } : f));
    try {
      const lines = await extractPdfLines(item.file);
      const data  = parseInvoice(lines);
      if (!data.productos || data.productos.length === 0)
        throw new Error("No se encontraron productos. Verificá que sea una factura CJX S.A.");
      setFiles(p => p.map(f => f.id === item.id ? { ...f, status: "done", data } : f));
    } catch (e) {
      setFiles(p => p.map(f => f.id === item.id ? { ...f, status: "error", error: e.message } : f));
    }
  };

  const processAll = async () => {
    const pending = files.filter(f => f.status === "pending" || f.status === "error");
    for (const item of pending) await processItem(item);
  };

  const downloadItem = (item) => {
    const wb = buildExcel(item.data);
    downloadWorkbook(wb, item.name.replace(/\.pdf$/i, ".xlsx"));
  };

  const removeItem = (id) => setFiles(p => p.filter(f => f.id !== id));

  const counts = {
    total:      files.length,
    pending:    files.filter(f => f.status === "pending").length,
    error:      files.filter(f => f.status === "error").length,
    processing: files.filter(f => f.status === "processing").length,
    done:       files.filter(f => f.status === "done").length,
  };

  const actionable = counts.pending + counts.error;
  const busy       = counts.processing > 0;
  const allDone    = counts.total > 0 && counts.done === counts.total;

  // Derive current step
  const currentStep = counts.total === 0 ? 1 : allDone ? 3 : counts.processing > 0 || actionable > 0 ? 2 : 2;

  return (
    <div className="shell">
      {/* ── Header ── */}
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <LogoMark />
            <span className="topbar__name">DataBridge</span>
            <span className="topbar__version">v2</span>
          </div>
          <span className="topbar__sub">Conversión de facturas PDF · CJX S.A.</span>
        </div>
      </header>

      <main className="main">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero__text">
            <h1 className="hero__title">
              Facturas <em>PDF</em> a Excel<br />listo para el WMS
            </h1>
            <p className="hero__desc">
              Cargá tus facturas, convertí en un clic y descargá cada Excel con los datos estructurados — sin pasos intermedios, sin configuración.
            </p>
          </div>
          <StepBar step={currentStep} />
        </section>

        {/* ── Drop zone ── */}
        {files.length < MAX_FILES && (
          <div
            className={`drop ${dragging ? "drop--active" : ""}`}
            onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === "Enter" && inputRef.current?.click()}
            aria-label="Zona de carga de archivos PDF"
          >
            <input ref={inputRef} type="file" accept=".pdf" multiple className="sr-only"
              onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />

            <div className={`drop__orbit ${dragging ? "drop__orbit--spin" : ""}`}>
              <div className="drop__ring drop__ring--1" />
              <div className="drop__ring drop__ring--2" />
              <div className="drop__core">
                <UploadIcon2 />
              </div>
            </div>

            <p className="drop__primary">
              {dragging ? "Soltá los archivos acá" : "Arrastrá PDFs o hacé clic para seleccionar"}
            </p>
            <p className="drop__hint">
              {files.length > 0
                ? `${files.length} de ${MAX_FILES} archivos cargados`
                : "Podés seleccionar varios archivos a la vez"}
            </p>
          </div>
        )}

        {/* ── Limits badge ── */}
        <LimitsBadge />

        {/* ── Rejection toasts ── */}
        {rejections.length > 0 && (
          <div className="toasts" role="alert">
            {rejections.map((r, i) => (
              <div key={i} className="toast">
                <WarnIcon />
                {r}
              </div>
            ))}
          </div>
        )}

        {/* ── Summary ── */}
        <SummaryBar files={files} />

        {/* ── Toolbar ── */}
        {files.length > 0 && (
          <div className="toolbar">
            <div className="toolbar__left">
              <CountPill n={counts.total}      label="archivos"    />
              {counts.done > 0       && <CountPill n={counts.done}       label="listos"     variant="success" />}
              {counts.error > 0      && <CountPill n={counts.error}      label="con error"  variant="error"   />}
              {counts.processing > 0 && <CountPill n={counts.processing} label="procesando" variant="info"    />}
            </div>
            <div className="toolbar__right">
              <button className="btn btn--ghost btn--sm" onClick={() => setFiles([])}>
                Limpiar todo
              </button>
              {actionable > 0 && !busy && (
                <button className="btn btn--primary btn--sm" onClick={processAll}>
                  <ConvertIcon />
                  Convertir {actionable === counts.total ? "todos" : `restantes (${actionable})`}
                </button>
              )}
              {allDone && (
                <span className="all-done-badge">
                  <CheckIcon />
                  Todo listo
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── File list ── */}
        {files.length > 0 && (
          <div className="file-list" role="list" aria-label="Archivos cargados">
            {files.map(item => (
              <FileCard key={item.id} item={item}
                onProcess={processItem}
                onDownload={downloadItem}
                onRemove={removeItem} />
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {files.length === 0 && (
          <div className="empty">
            <div className="empty__features">
              <Feature icon={<LockIcon />}  title="Procesamiento local" desc="Los archivos se procesan en tu navegador. No se envía ningún dato a servidores externos." />
              <Feature icon={<SpeedIcon />} title="Extracción directa"  desc="Lee y estructura el contenido del PDF automáticamente: código, descripción, precios y totales." />
              <Feature icon={<XlsIcon />}   title="Excel estructurado"  desc="Genera un .xlsx con hoja de información y hoja de productos, listo para importar al WMS." />
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>Procesamiento local · Sin servidores · Sin costo</span>
        <span className="footer__sep" />
        <span>CJX S.A. · Sistema de migración de datos</span>
      </footer>
    </div>
  );
}

function CountPill({ n, label, variant = "default" }) {
  return <span className={`cpill cpill--${variant}`}><strong>{n}</strong> {label}</span>;
}

function Feature({ icon, title, desc }) {
  return (
    <div className="feature">
      <div className="feature__icon">{icon}</div>
      <h3 className="feature__title">{title}</h3>
      <p className="feature__desc">{desc}</p>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function LogoMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <rect width="30" height="30" rx="8" fill="url(#lg)" />
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <path d="M8 15h4l2-6 3 11 2-5h3" stroke="#0A0F1E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function UploadIcon2() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v10m0-10L8 8m4-4l4 4"/>
      <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4"/>
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1"/>
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
function ConvertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9"/>
      <path d="M20 20v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
    </svg>
  );
}
function UserIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function BoxIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
}
function CoinsIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1110.34 18"/><path d="M7 6h1v4"/><path d="M16.71 13.88l.7.71-2.82 2.82"/></svg>;
}
function CalIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function DocIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}
function WarnIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}
function LockIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
}
function SpeedIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
}
function XlsIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>;
}
function FilesIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
}
function WeightIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 20a1 1 0 001 1h2a1 1 0 001-1v-1H10v1z"/><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 6V3"/><circle cx="12" cy="3" r="1"/></svg>;
}
function PdfBadgeIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}
function FacturaIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>;
}
function RemisionIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
}
function TruckIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
}