/* SPHEREx Explorer — Cine del cielo. Archivo nuevo, desde cero.
   Fuente única de datos: NASA/IPAC IRSA, vía Cloudflare Worker. */
const API_BASE = "https://spherex-explorer-api.gaaronzaid.workers.dev";

const $ = (id) => document.getElementById(id);
let rows = [];          // registros SIA devueltos por IRSA
let frames = [];       // un fotograma por fecha distinta
let frameIdx = 0;
let selected = null;
let playTimer = null;
let blinkTimer = null;
let blinkSide = false;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const val = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return "—"; };
const mjdDate = (v) => { const m = Number(v); if (!Number.isFinite(m)) return null; const d = new Date(Date.UTC(1858, 10, 17) + m * 86400000); return isNaN(d) ? null : d; };
const fmtMJD = (v) => { const d = mjdDate(v); if (!d) return String(v ?? "—"); return d.toISOString().slice(0, 10) + " " + d.toISOString().slice(11, 16) + " UTC (MJD " + v + ")"; };

function msg(text, kind = "") {
  const box = $("msg"); box.textContent = text; box.className = "notice " + kind; box.style.display = "block";
}
function apiUrl(path, params = {}) {
  const u = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
function parseCSV(text) {
  const out = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { field += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === "," && !q) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && n === "\n") i++;
      row.push(field); if (row.some((x) => x.trim() !== "")) out.push(row); row = []; field = "";
    } else field += c;
  }
  row.push(field); if (row.some((x) => x.trim() !== "")) out.push(row);
  if (out.length < 2) return [];
  const head = out.shift().map((h) => h.trim().replace(/^"|"$/g, ""));
  return out.map((r) => { const o = {}; head.forEach((h, i) => (o[h] = (r[i] ?? "").trim())); return o; });
}
async function resolveName(name) {
  const r = await fetch(apiUrl("/api/name", { q: name }));
  if (!r.ok) throw new Error("No se pudo resolver ese nombre.");
  return r.json();
}
function live(state, ra, dec, radius, count, colls) {
  const when = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  $("live").textContent =
    state === "ok" ? `Consulta completada en tiempo real desde IRSA. Se recibieron ${count} registros.` :
    state === "error" ? "La última consulta a IRSA falló. Intenta de nuevo." :
    "Consultando IRSA en tiempo real…";
  $("liveMeta").textContent = `Fuente: NASA/IPAC IRSA · SPHEREx · Última consulta: ${when} (hora de México) · Centro: RA ${ra}°, DEC ${dec}° · Radio ${radius}° · Colecciones: ${colls}`;
}
function shareURL() {
  const ra = $("ra").value.trim(), dec = $("dec").value.trim();
  if (!ra || !dec) return;
  const u = new URL(location.href.split("?")[0].split("#")[0]);
  u.searchParams.set("ra", ra); u.searchParams.set("dec", dec); u.searchParams.set("radius", $("radius").value);
  const n = $("name").value.trim(); if (n) u.searchParams.set("name", n);
  history.replaceState(null, "", u.toString());
}
function loadFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("ra")) $("ra").value = p.get("ra");
  if (p.get("dec")) $("dec").value = p.get("dec");
  if (p.get("radius")) $("radius").value = p.get("radius");
  if (p.get("name")) $("name").value = p.get("name");
  return !!(p.get("ra") && p.get("dec"));
}

/* ---- Datos curiosos y mapa real de IRSA ---- */
const FUNFACTS = {
  "Barnard's Star": "💡 ¡Barnard es la estrella que más rápido se mueve en el cielo! En un año camina tanto como el ancho de la Luna llena visto desde la Tierra. 🌕",
  "Epsilon Indi B": "💡 ¡Epsilon Indi B son en realidad DOS enanas marrones bailando juntas alrededor de una estrella! Son tan frías que no brillan como el Sol. 🟤🟤",
  "WISE 0855": "💡 ¡WISE 0855 es la enana marrón más fría que conocemos! Está a unos -13 °C… ¡más fría que un congelador! 🥶",
  "RW Aurigae": "💡 ¡RW Aur es una estrella bebé que cambia de brillo porque tiene polvo a su alrededor, como si se pusiera gafas de sol! 😎",
  "R Draconis": "💡 ¡R Draconis late como un corazón gigante: se hace grande y brillante, luego chiquita, cada 245 días! ❤️"
};
function showFunFact(name) {
  if (FUNFACTS[name]) $("funFact").textContent = FUNFACTS[name];
}
function irsaViewerURL(ra, dec) { return "https://irsa.ipac.caltech.edu/irsaviewer/"; }
function finderURL(ra, dec) {
  // Finder Chart de IRSA: mode=getResult centra el mapa en locstr="RA Dec".
  return "https://irsa.ipac.caltech.edu/applications/finderchart/servlet/api?mode=getResult&locstr=" + encodeURIComponent(ra + " " + dec);
}
function goToMap() {
  const ra = $("mapRa").value.trim() || $("ra").value.trim();
  const dec = $("mapDec").value.trim() || $("dec").value.trim();
  if (!ra || !dec) { msg("Escribe RA y DEC para viajar en el mapa. 🗺️", ""); return; }
  $("mapRa").value = ra; $("mapDec").value = dec;
  $("mapFinder").src = finderURL(ra, dec);
  $("mapNote").textContent = `🗺️ Mapa centrado en RA ${ra}°, DEC ${dec}°. Si el mapa no carga dentro de la página, ábrelo con los botones de arriba, ¡es el mapa real de IRSA!`;
  showMapTab("finder");
  msg(`¡Viajando en el mapa de IRSA a RA ${ra}°, DEC ${dec}°! 🚀`, "good");
}
function showMapTab(which) {
  const v = which === "viewer";
  $("mapViewer").style.display = v ? "block" : "none";
  $("mapFinder").style.display = v ? "none" : "block";
  $("tabViewer").classList.toggle("on", v);
  $("tabFinder").classList.toggle("on", !v);
}

/* ---- Cine: fotogramas, Play, Parpadeo ---- */
function stopCine() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  blinkSide = false;
  $("playBtn").classList.remove("on"); $("blinkBtn").classList.remove("on");
  $("pauseBtn").disabled = true;
}
function buildFrames() {
  stopCine(); frames = []; frameIdx = 0;
  const band = $("band").value;
  const byDate = new Map();
  rows.forEach((o) => {
    const d = mjdDate(val(o, "t_min"));
    if (!d) return;
    if (band !== "TODAS" && val(o, "energy_bandpassname") !== band) return;
    const key = d.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(o);
  });
  frames = [...byDate.keys()].sort().map((date) => {
    const list = byDate.get(date);
    return { date, obs: list[0], count: list.length };
  });
  renderTimeline(); renderBands();
  const has = frames.length > 0;
  $("playBtn").disabled = !has; $("blinkBtn").disabled = frames.length < 2;
  $("prevBtn").disabled = !has; $("nextBtn").disabled = !has;
  $("frameCount").textContent = has
    ? `${frames.length} fotogramas · ${frames[0].date} → ${frames[frames.length - 1].date}`
    : "Sin fotogramas para esta banda y estas fechas";
  if (has) showFrame(0, false); else $("frameInfo").textContent = "Fotograma: —";
}
function renderTimeline() {
  const tl = $("timeline"); tl.innerHTML = "";
  if (!frames.length) { tl.innerHTML = '<span class="small">Haz una consulta para construir la línea de tiempo con las fechas reales de IRSA.</span>'; return; }
  frames.forEach((f, i) => {
    const b = document.createElement("button");
    b.innerHTML = `${i + 1}. ${esc(f.date)}<small>${esc(val(f.obs, "energy_bandpassname"))} · ${esc(val(f.obs, "obs_id"))} · ${f.count} reg.</small>`;
    if (i === frameIdx) b.classList.add("on");
    b.addEventListener("click", () => { stopCine(); showFrame(i, true); });
    tl.appendChild(b);
  });
}
function showFrame(i, loadViewer) {
  if (!frames.length) return;
  frameIdx = ((i % frames.length) + frames.length) % frames.length;
  const f = frames[frameIdx];
  document.querySelectorAll("#timeline button").forEach((b, j) => b.classList.toggle("on", j === frameIdx));
  $("frameInfo").textContent = `Fotograma ${frameIdx + 1} / ${frames.length} · ${f.date} · ${val(f.obs, "energy_bandpassname")} · ${val(f.obs, "obs_id")} · ${f.obs._collection || "—"} · Centro exp. ${val(f.obs, "s_ra")} / ${val(f.obs, "s_dec")}`;
  if (loadViewer) {
    const idx = rows.indexOf(f.obs);
    if (idx >= 0) selectRow(idx);
  }
}
function renderBands() {
  const box = $("bands");
  const seen = new Map();
  rows.forEach((o) => {
    const b = val(o, "energy_bandpassname");
    if (b === "—" || seen.has(b)) return;
    const lo = Number(val(o, "em_min")) * 1e6, hi = Number(val(o, "em_max")) * 1e6;
    if (Number.isFinite(lo) && Number.isFinite(hi)) seen.set(b, { lo, hi });
  });
  if (!seen.size) { box.innerHTML = ""; return; }
  box.innerHTML = "<h4 style='margin:0 0 8px;font-size:13px'>Cobertura espectral real de esta búsqueda (IRSA: em_min–em_max)</h4>" +
    "<p class='small'>Cada banda es un rango de longitud de onda devuelto por IRSA. No es un espectro de flujo: la tabla SIA no devuelve flujo.</p>" +
    [...seen.entries()].sort((a, b) => a[1].lo - b[1].lo).map(([b, r]) => {
      const left = ((r.lo - 0.7) / 4.4 * 100).toFixed(1);
      const w = Math.max(2, (r.hi - r.lo) / 4.4 * 100).toFixed(1);
      return `<div style="font-size:12px"><strong>${esc(b)}</strong> · ${r.lo.toFixed(2)}–${r.hi.toFixed(2)} µm<div class="bandbar"><i style="left:${left}%;width:${w}%"></i></div></div>`;
    }).join("");
}

/* ---- Búsqueda IRSA ---- */
async function search() {
  $("msg").style.display = "none";
  const name = $("name").value.trim();
  let ra = $("ra").value.trim(), dec = $("dec").value.trim();
  try {
    if (name && (!ra || !dec)) {
      $("state").textContent = "RESOLVIENDO";
      const c = await resolveName(name);
      ra = String(c.ra); dec = String(c.dec);
      $("ra").value = ra; $("dec").value = dec;
    }
    if (!ra || !dec) throw new Error("Introduce RA y DEC, o un nombre que pueda resolverse.");
    const r = Number(ra), d = Number(dec);
    if (!Number.isFinite(r) || !Number.isFinite(d) || r < 0 || r >= 360 || d < -90 || d > 90)
      throw new Error("Coordenadas no válidas. RA 0–360, DEC −90 a 90.");
    const colls = [...document.querySelectorAll("#collections input:checked")].map((x) => x.value);
    if (!colls.length) throw new Error("Selecciona al menos una colección.");
    const radius = $("radius").value, maxrec = $("maxrec").value;
    $("searchBtn").disabled = true;
    $("state").textContent = "CONSULTANDO";
    live("loading", r, d, radius, 0, colls.join(", "));
    $("rows").innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px">Consultando IRSA…</td></tr>';
    rows = []; selected = null;
    $("csvBtn").disabled = true; $("cutoutBtn").disabled = true; $("fitsBtn").disabled = true;
    $("details").textContent = "Esperando resultados de IRSA…";
    const jobs = colls.map(async (collection) => {
      const res = await fetch(apiUrl("/api/sia", { collection, ra: r, dec: d, radius, maxrec }));
      const body = await res.text();
      if (!res.ok) throw new Error(collection + ": " + body.slice(0, 200));
      return { collection, list: parseCSV(body) };
    });
    const done = await Promise.allSettled(jobs);
    const errors = [];
    done.forEach((res, i) => {
      if (res.status === "fulfilled") res.value.list.forEach((o) => { o._collection = res.value.collection; rows.push(o); });
      else errors.push(colls[i] + ": " + res.reason.message);
    });
    $("total").textContent = rows.length;
    $("ncol").textContent = done.filter((x) => x.status === "fulfilled").length;
    $("state").textContent = errors.length ? "PARCIAL" : "COMPLETADA";
    $("csvBtn").disabled = rows.length === 0;
    renderRows(); buildFrames(); live(errors.length ? "error" : "ok", r, d, radius, rows.length, colls.join(", "));
    shareURL();
    if (errors.length) msg("Algunas colecciones no respondieron: " + errors.join(" | ") + ". Si el radio es grande, prueba 0.05° o 0.03°.", "error");
    else if (rows.length) msg(`Consulta completada. Se recibieron ${rows.length} registros de IRSA. El Cine tiene ${frames.length} fotogramas.`, "good");
    else msg("IRSA respondió, pero no devolvió observaciones para estas coordenadas, radio y colecciones.", "");
    $("note").textContent = `Centro consultado: RA ${r}°, DEC ${d}° · Radio ${radius}° · Respuesta en tiempo real desde IRSA. RA / DEC de la tabla es el centro de cada exposición (s_ra / s_dec).`;
  } catch (e) {
    $("state").textContent = "ERROR"; live("error", ra, dec, $("radius").value, 0, "");
    $("rows").innerHTML = '<tr><td colspan="7" style="text-align:center;padding:25px">No fue posible completar la consulta.</td></tr>';
    msg(e.message, "error");
  } finally { $("searchBtn").disabled = false; }
}
function renderRows() {
  const body = $("rows");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#93a9c0">No se encontraron registros.</td></tr>'; return; }
  body.innerHTML = rows.map((o, i) => `<tr data-i="${i}">
    <td class="mono">${esc(val(o, "obs_id", "obs_publisher_did"))}</td>
    <td>${esc(val(o, "target_name", "target"))}</td>
    <td>${esc(o._collection)}</td>
    <td>${esc(val(o, "energy_bandpassname"))}</td>
    <td class="mono">${esc(fmtMJD(val(o, "t_min")))}</td>
    <td class="mono">${esc(val(o, "s_ra"))} / ${esc(val(o, "s_dec"))}</td>
    <td><button class="btn" data-view="${i}">Abrir</button></td></tr>`).join("");
  body.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => selectRow(Number(b.dataset.view))));
}
function selectRow(i) {
  const o = rows[i]; if (!o) return;
  selected = o;
  document.querySelectorAll("#rows tr").forEach((tr) => tr.classList.remove("sel"));
  const tr = document.querySelector(`#rows tr[data-i="${i}"]`);
  if (tr) tr.classList.add("sel");
  const access = val(o, "access_url");
  $("details").innerHTML = `
    <div><strong>Identificador:</strong> ${esc(val(o, "obs_id", "obs_publisher_did"))}</div>
    <div><strong>Colección:</strong> ${esc(o._collection)}</div>
    <div><strong>Objeto:</strong> ${esc(val(o, "target_name", "target"))}</div>
    <div><strong>Banda:</strong> ${esc(val(o, "energy_bandpassname"))}</div>
    <div><strong>Longitud de onda:</strong> ${esc(val(o, "em_min"))} – ${esc(val(o, "em_max"))} m</div>
    <div><strong>Tiempo:</strong> ${esc(fmtMJD(val(o, "t_min")))}</div>
    <div><strong>Calibración:</strong> ${esc(val(o, "calib_level"))}</div>
    <div style="overflow-wrap:anywhere"><strong>URL del producto:</strong><br>${esc(access)}</div>`;
  $("fitsBtn").disabled = !access || access === "—";
  $("cutoutBtn").disabled = !access || access === "—";
  $("viewer").innerHTML = '<div class="empty"><div><div style="font-size:40px">✦</div><strong>Observación seleccionada</strong><p>Pulsa “Abrir FITS” para cargarla en el visor.</p></div></div>';
  $("viewerInfo").textContent = "Producto seleccionado: " + val(o, "obs_id", "obs_publisher_did");
}
function showJS9(cutout) {
  if (!selected) return;
  const access = selected.access_url;
  if (!access || access === "—") return;
  const params = { url: access };
  if (cutout) { params.center = $("ra").value + "," + $("dec").value; params.size = $("radius").value; }
  const fileURL = apiUrl(cutout ? "/api/cutout" : "/api/file", params);
  $("viewer").innerHTML = `<iframe title="Visor JS9" allowfullscreen src="https://js9.si.edu/js9/js9.html?url=${encodeURIComponent(fileURL)}"></iframe>`;
  $("viewerInfo").textContent = cutout ? "Recorte FITS solicitado a IRSA. La carga depende del archivo y de JS9." : "Cargando el FITS en JS9. Los productos pueden ser grandes y tardar.";
}
function exportCSV() {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((o) => Object.keys(o)))];
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = [headers.map(q).join(","), ...rows.map((o) => headers.map((h) => q(o[h] ?? "")).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "spherex_irsa_results.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ---- Eventos ---- */
$("searchBtn").addEventListener("click", search);
$("csvBtn").addEventListener("click", exportCSV);
$("fitsBtn").addEventListener("click", () => showJS9(false));
$("cutoutBtn").addEventListener("click", () => showJS9(true));
$("playBtn").addEventListener("click", () => {
  if (frames.length < 2) return;
  stopCine(); $("playBtn").classList.add("on"); $("pauseBtn").disabled = false;
  playTimer = setInterval(() => showFrame(frameIdx + 1, true), Number($("speed").value));
});
$("pauseBtn").addEventListener("click", stopCine);
$("blinkBtn").addEventListener("click", () => {
  if (frames.length < 2) return;
  stopCine(); $("blinkBtn").classList.add("on"); $("pauseBtn").disabled = false;
  blinkTimer = setInterval(() => { blinkSide = !blinkSide; showFrame(blinkSide ? frames.length - 1 : 0, true); }, Math.max(400, Number($("speed").value)));
});
$("prevBtn").addEventListener("click", () => { stopCine(); showFrame(frameIdx - 1, true); });
$("nextBtn").addEventListener("click", () => { stopCine(); showFrame(frameIdx + 1, true); });
$("speed").addEventListener("input", (e) => { $("speedLabel").textContent = (Number(e.target.value) / 1000).toFixed(1) + " s"; });
$("band").addEventListener("change", () => { if (rows.length) buildFrames(); });
$("copyBtn").addEventListener("click", async () => {
  shareURL();
  try { await navigator.clipboard.writeText(location.href); msg("Enlace copiado: " + location.href, "good"); }
  catch (e) { msg("Copia esta URL: " + location.href, ""); }
});
$("healthBtn").addEventListener("click", async () => {
  const box = $("health"); box.style.display = "block"; box.textContent = "Comprobando el servicio…";
  try {
    const r = await fetch(apiUrl("/api/health")); const j = await r.json();
    box.textContent = `Servicio: ${j.service || "SPHEREx Explorer API"} · Estado: ${j.status || r.status} · IRSA: ${j.irsa || ""} · Colecciones: ${(j.collections || []).join(", ")}`;
    box.className = "notice good";
  } catch (e) { box.textContent = "No se pudo comprobar el servicio: " + e.message; box.className = "notice error"; }
});
document.querySelectorAll("[data-ra]").forEach((b) => b.addEventListener("click", () => {
  $("name").value = b.dataset.name; $("ra").value = b.dataset.ra; $("dec").value = b.dataset.dec;
  $("mapRa").value = b.dataset.ra; $("mapDec").value = b.dataset.dec;
  showFunFact(b.dataset.name);
}));
$("mapBtn").addEventListener("click", goToMap);
$("tabViewer").addEventListener("click", () => showMapTab("viewer"));
$("tabFinder").addEventListener("click", () => showMapTab("finder"));

/* ---- Inicio ---- */
$("status").textContent = "● API CONFIGURADA";
if (loadFromURL()) search();
