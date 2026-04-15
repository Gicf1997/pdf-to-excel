import type { Context } from "@netlify/functions";

const PROMPT = `Extract all structured data from this invoice/document. Return ONLY valid JSON — no markdown, no backticks, no explanation before or after.

Required schema (use exactly this structure):
{
  "metadata": {
    "fecha": "",
    "numero_documento": "",
    "cliente": "",
    "ruc": "",
    "direccion": "",
    "telefono": "",
    "condicion_venta": "",
    "vendedor": ""
  },
  "productos": [
    {
      "codigo": "",
      "codigo_barra": "",
      "cantidad": 0,
      "descripcion": "",
      "precio_unitario": 0,
      "gravadas_10": 0
    }
  ],
  "total": 0
}

If a field is not present in the document, leave it as an empty string or 0. Extract ALL products/line items found.`;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable is not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let base64: string;
  try {
    const body = await req.json();
    base64 = body.base64;
    if (!base64) throw new Error("Missing base64 field");
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body. Expected { base64: string }." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  const data = await anthropicRes.json();

  if (data.error) {
    return new Response(
      JSON.stringify({ error: data.error.message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const raw = (data.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return new Response(
      JSON.stringify({ error: "Model returned non-parseable JSON.", raw }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  path: "/api/extract",
};
