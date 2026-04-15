# DataBridge · Conversor PDF → Excel

Herramienta interna que convierte facturas PDF a Excel estructurado usando inteligencia artificial (Claude de Anthropic). Los datos quedan listos para importar a un WMS u otro sistema.

## Stack

- **Frontend**: React + Vite
- **Backend**: Netlify Serverless Functions (TypeScript)
- **IA**: Claude claude-sonnet-4-20250514 via Anthropic API
- **Excel**: SheetJS (client-side)

## Configuración en Netlify

### 1. Conectar repositorio

En el dashboard de Netlify:
- New site → Import from Git → Seleccionar el repositorio

### 2. Build settings

Netlify los detecta automáticamente desde `netlify.toml`:
- **Build command**: `npm run build`
- **Publish directory**: `dist`

### 3. Variable de entorno (obligatoria)

En **Site configuration → Environment variables**, agregar:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (tu clave de Anthropic) |

### 4. Deploy

Hacer push a `main` — Netlify buildea y despliega automáticamente.

---

## Desarrollo local

```bash
npm install
# Crear .env con la API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
# Iniciar servidor local (incluye funciones de Netlify)
npm run dev
```

---

## Cómo funciona

1. El usuario arrastra uno o varios PDFs
2. Cada archivo se envía (como base64) a `/api/extract` — una función serverless en Netlify
3. La función llama a la API de Anthropic con la API key almacenada en variables de entorno (nunca expuesta al cliente)
4. Claude extrae los datos estructurados (metadata + productos)
5. El frontend recibe el JSON y genera el Excel client-side con SheetJS
6. El usuario descarga cada `.xlsx` individualmente

## Estructura de archivos

```
pdf-to-excel/
├── netlify/
│   └── functions/
│       └── extract.mts        ← Serverless function (proxy seguro a Anthropic)
├── src/
│   ├── App.jsx                ← UI principal
│   ├── App.css                ← Estilos
│   ├── main.jsx               ← Entry point
│   └── utils/
│       └── excel.js           ← Generación de Excel con SheetJS
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.js
├── netlify.toml
└── package.json
```
