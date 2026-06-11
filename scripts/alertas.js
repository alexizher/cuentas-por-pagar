// Lee cxp_data.json (exportado desde la app de Cuentas por Pagar)
// y genera el correo de alertas: facturas vencidas y próximas a vencer.
// No requiere dependencias externas (Node >= 18).
"use strict";
const fs = require("fs");

const RUTA_DATOS = process.env.RUTA_DATOS || "cxp_data.json";
const DIAS_AVISO = parseInt(process.env.DIAS_AVISO || "5", 10); // avisar si vence en <= N días

// --- Fecha "hoy" en zona horaria de Colombia (los runners corren en UTC) ---
const hoy = new Date(
  new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
);
hoy.setHours(0, 0, 0, 0);
const hoyISO = hoy.toISOString().slice(0, 10);

function diasHasta(fechaISO) {
  const f = new Date(fechaISO + "T00:00:00");
  return Math.round((f - hoy) / 86400000);
}
const cop = (v) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Math.round(v || 0));
const fmt = (iso) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

// --- Cargar datos ---
if (!fs.existsSync(RUTA_DATOS)) {
  console.log(`No existe ${RUTA_DATOS}. Exporta el JSON desde la app y súbelo al repo.`);
  salida(false, "", "");
  process.exit(0);
}
const datos = JSON.parse(fs.readFileSync(RUTA_DATOS, "utf8"));
const facturas = datos.facturas || [];

const pagado = (f) => (f.pagos || []).reduce((s, p) => s + (+p.valor || 0), 0);
const saldo = (f) => Math.max(0, (+f.valor || 0) - pagado(f));

const abiertas = facturas.filter((f) => saldo(f) > 0.005);
const vencidas = abiertas
  .filter((f) => f.fechaVence < hoyISO)
  .sort((a, b) => a.fechaVence.localeCompare(b.fechaVence));
const proximas = abiertas
  .filter((f) => f.fechaVence >= hoyISO && diasHasta(f.fechaVence) <= DIAS_AVISO)
  .sort((a, b) => a.fechaVence.localeCompare(b.fechaVence));

if (!vencidas.length && !proximas.length) {
  console.log("Sin novedades: no hay facturas vencidas ni próximas a vencer.");
  salida(false, "", "");
  process.exit(0);
}

// --- Construir correo HTML ---
const totalVencido = vencidas.reduce((s, f) => s + saldo(f), 0);
const totalProximo = proximas.reduce((s, f) => s + saldo(f), 0);

function tabla(lista, conDias) {
  const filas = lista
    .map((f) => {
      const d = diasHasta(f.fechaVence);
      const dias = conDias
        ? `${Math.abs(d)} día(s) ${d < 0 ? "vencida" : d === 0 ? "— vence HOY" : "para vencer"}`
        : "";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e1d6">${f.nombre}<br><small style="color:#777">NIT ${f.nit}</small></td>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e1d6;font-family:monospace">${f.numero}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e1d6">${fmt(f.fechaVence)}<br><small>${dias}</small></td>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e1d6;text-align:right;font-family:monospace">${cop(saldo(f))}</td>
      </tr>`;
    })
    .join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="text-align:left;color:#555"><th style="padding:6px 10px">Proveedor</th><th style="padding:6px 10px">Factura</th><th style="padding:6px 10px">Vence</th><th style="padding:6px 10px;text-align:right">Saldo</th></tr>
    ${filas}</table>`;
}

let html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1c2b25">
  <h2 style="border-bottom:3px double #cfcbbc;padding-bottom:8px">Cuentas por Pagar · Alerta ${fmt(hoyISO)}</h2>`;
if (vencidas.length) {
  html += `<h3 style="color:#b3372e">⚠ ${vencidas.length} factura(s) VENCIDA(S) — ${cop(totalVencido)}</h3>${tabla(vencidas, true)}`;
}
if (proximas.length) {
  html += `<h3 style="color:#9a6b12;margin-top:24px">⏳ ${proximas.length} factura(s) vencen en los próximos ${DIAS_AVISO} días — ${cop(totalProximo)}</h3>${tabla(proximas, true)}`;
}
html += `<p style="color:#777;font-size:12px;margin-top:24px">Generado automáticamente por GitHub Actions a partir de cxp_data.json.
Recuerda re-exportar y subir el JSON cuando registres pagos para que las alertas estén al día.</p></div>`;

const partes = [];
if (vencidas.length) partes.push(`${vencidas.length} vencida(s)`);
if (proximas.length) partes.push(`${proximas.length} por vencer`);
const asunto = `CxP: ${partes.join(" · ")} — ${fmt(hoyISO)}`;

console.log(`Vencidas: ${vencidas.length} (${cop(totalVencido)}) | Próximas: ${proximas.length} (${cop(totalProximo)})`);
salida(true, asunto, html);

// --- Comunicar resultados al workflow ---
function salida(enviar, asunto, html) {
  fs.writeFileSync("correo.html", html || "<p>Sin contenido</p>");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `enviar=${enviar}\nasunto=${(asunto || "").replace(/\n/g, " ")}\n`
    );
  }
}
