/* SPHEREx Explorer — versión sencilla.
   Fuente única de datos: NASA/IPAC IRSA, vía Cloudflare Worker.
   Sin Cine ni tablas: la búsqueda centra el visor oficial y el mapa,
   y muestra en palabras sencillas en qué fechas SPHEREx fotografió la zona. */
const API_BASE = "https://spherex-explorer-api.gaaronzaid.workers.dev";
const COLLECTIONS = ["spherex_dr1", "spherex_qr3"];
const MAXREC = 25;

const $ = (id) => document.getElementById(id);
let rows = []; // registros SIA devueltos por IRSA (solo se usan sus fechas)
let epochList = []; // una entrada por fecha con imagen: {date, label, row}
let epochIdx = 0;
let imgTimer = null;
let currentRa = "", currentDec = "";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const val = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return "—"; };
const mjdDate = (v) => { const m = Number(v); if (!Number.isFinite(m)) return null; const d = new Date(Date.UTC(1858, 10, 17) + m * 86400000); return isNaN(d) ? null : d; };
const fmtFecha = (d) => d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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
function live(state) {
  const when = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  $("liveMeta").textContent = `Fuente: NASA/IPAC IRSA · SPHEREx · Última consulta: ${when} (hora de México)`;
  if (state === "loading") $("live").textContent = "Consultando IRSA en tiempo real…";
  else if (state === "error") $("live").textContent = "La última consulta a IRSA falló. Intenta de nuevo más tarde.";
}
function shareURL() {
  const ra = $("ra").value.trim(), dec = $("dec").value.trim();
  if (!ra || !dec) return;
  const u = new URL(location.href.split("?")[0].split("#")[0]);
  u.searchParams.set("ra", ra); u.searchParams.set("dec", dec); u.searchParams.set("radius", $("radius").value);
  const n = $("name").value.trim(); if (n) u.searchParams.set("name", n);
  history.replaceState(null, "", u.toString());
}

/* ---- Visor oficial SPHEREx de IRSA ---- */
const SPHEREX_APP = "https://irsa.ipac.caltech.edu/applications/spherex/";
function spherexAppURL(ra, dec, radius) {
  const p = new URLSearchParams({ api: "spectral-images", ra: ra, dec: dec, sr: radius + "d" });
  return SPHEREX_APP + "?" + p.toString();
}
/* Cambia el src de un iframe, forzando la recarga aunque la URL sea la misma
   (asignar la misma URL no recarga el iframe en la mayoría de navegadores,
   así que buscar dos veces el mismo punto dejaba el visor viejo). */
function setFrameSrc(frame, url) {
  if (frame.src === url) {
    frame.src = "about:blank";
    setTimeout(() => { frame.src = url; }, 60);
  } else {
    frame.src = url;
  }
}
function updateSpherexFrame(ra, dec, radius) {
  const url = spherexAppURL(ra, dec, radius);
  setFrameSrc($("spherexViewer"), url);
  const nm = $("name").value.trim();
  $("coordinates").textContent = nm
    ? `Punto analizado: ${nm} · RA ${ra}° · DEC ${dec}°`
    : `Punto analizado: RA ${ra}° · DEC ${dec}°`;
  return url;
}
function resetSearch() {
  $("name").value = "Barnard's Star";
  $("ra").value = "269.452077"; $("dec").value = "4.693365"; $("radius").value = "0.05";
  showFunFact("Barnard's Star");
  search();
}
function loadFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("ra")) { $("ra").value = p.get("ra"); }
  if (p.get("dec")) { $("dec").value = p.get("dec"); }
  if (p.get("radius")) $("radius").value = p.get("radius");
  if (p.get("name")) $("name").value = p.get("name");
  return !!(p.get("ra") && p.get("dec"));
}

/* ---- Datos curiosos y mapa real de IRSA ---- */
const FUNFACTS = {
  "Barnard's Star": "Dato: Barnard's Star tiene el mayor movimiento propio conocido: unos 10.3 segundos de arco por año, el equivalente al diámetro aparente de la Luna llena en unos 180 años.",
  "Epsilon Indi B": "Dato: Epsilon Indi B es en realidad un par de enanas marrones (Ba y Bb) en órbita mutua, compañeras de la estrella Epsilon Indi A.",
  "WISE 0855": "Dato: WISE 0855 es una de las enanas marrones más frías conocidas, con una temperatura de unos 250 K y un movimiento propio de unos 8 segundos de arco por año.",
  "RW Aurigae": "Dato: RW Aurigae es una estrella joven cuya variabilidad se asocia a material circunestelar que oscurece su luz de forma irregular.",
  "R Draconis": "Dato: R Draconis es una variable Mira con un periodo de unos 245.6 días, con un brillo que varía en varias magnitudes."
};
function showFunFact(name) {
  if (FUNFACTS[name]) $("funFact").textContent = FUNFACTS[name];
}
function finderURL(ra, dec) {
  // Finder Chart de IRSA: mode=getResult centra el mapa en locstr="RA Dec".
  return "https://irsa.ipac.caltech.edu/applications/finderchart/servlet/api?mode=getResult&locstr=" + encodeURIComponent(ra + " " + dec);
}
function goToMap(quiet = false) {
  const ra = $("ra").value.trim();
  const dec = $("dec").value.trim();
  if (!ra || !dec) { if (!quiet) msg("Escribe RA y DEC para centrar el mapa.", ""); return false; }
  const r = Number(ra), d = Number(dec);
  if (!Number.isFinite(r) || !Number.isFinite(d) || r < 0 || r >= 360 || d < -90 || d > 90) {
    if (!quiet) msg("Las coordenadas del mapa no son válidas. RA debe estar entre 0 y 360, DEC entre −90 y 90.", "error");
    return false;
  }
  setFrameSrc($("mapFinder"), finderURL(ra, dec));
  $("mapNote").textContent = `Mapa centrado en RA ${ra}°, DEC ${dec}°. Si el mapa no carga dentro de la página, ábrelo con los botones de arriba: es el mapa real de IRSA.`;
  showMapTab("finder");
  if (!quiet) msg(`Centrando el mapa de IRSA en RA ${ra}°, DEC ${dec}°.`, "good");
  return true;
}
function showMapTab(which) {
  const v = which === "viewer";
  $("mapViewer").style.display = v ? "block" : "none";
  $("mapFinder").style.display = v ? "none" : "block";
  $("tabViewer").classList.toggle("on", v);
  $("tabFinder").classList.toggle("on", !v);
}

/* ---- Fechas en palabras sencillas ---- */
function renderEpochs() {
  const box = $("epochs");
  const byDate = new Map();
  rows.forEach((o) => {
    const d = mjdDate(val(o, "t_min"));
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(o);
  });
  const dates = [...byDate.keys()].sort();
  epochList = dates.map((key) => {
    const label = fmtFecha(new Date(key + "T00:00:00Z"));
    const row = byDate.get(key).find((o) => val(o, "access_url") && val(o, "access_url") !== "—") || null;
    return { date: key, label, row };
  }).filter((e) => e.row);
  if (!dates.length) { box.innerHTML = ""; $("imgCard").style.display = "none"; stopImgBlink(); return; }
  const first = fmtFecha(new Date(dates[0] + "T00:00:00Z"));
  const last = fmtFecha(new Date(dates[dates.length - 1] + "T00:00:00Z"));
  $("live").textContent = dates.length === 1
    ? `SPHEREx fotografió esta zona el ${first}.`
    : `SPHEREx fotografió esta zona en ${dates.length} fechas distintas, entre el ${first} y el ${last}.`;
  $("live").className = "notice good";
  box.innerHTML = dates.map((d) => `<span class="epoch">${esc(fmtFecha(new Date(d + "T00:00:00Z")))}</span>`).join("");
  // Imágenes por fecha: una foto real por fecha, para comparar el cambio.
  if (epochList.length) {
    const spanDays = Math.round((new Date(dates[dates.length - 1] + "T00:00:00Z") - new Date(dates[0] + "T00:00:00Z")) / 86400000);
    $("imgSpan").textContent = epochList.length === 1
      ? "Solo hay una fecha con imagen para esta zona."
      : `Entre la primera y la última foto hay ${spanDays} días. Parpadea entre ellas y fíjate en lo que cambia de sitio: eso es lo que se mueve.`;
    $("imgDates").innerHTML = epochList.map((e, i) => `<button class="epoch" data-i="${i}">${esc(e.label)}</button>`).join("");
    $("imgCard").style.display = "block";
    showEpochImage(0);
  } else {
    $("imgCard").style.display = "none";
  }
}

/* ---- Imagen de cada fecha (recorte FITS real de IRSA, visto con JS9) ---- */
function stopImgBlink() {
  if (imgTimer) { clearInterval(imgTimer); imgTimer = null; }
  const b = $("imgBlink");
  if (b) { b.classList.remove("on"); b.textContent = "Parpadear 1ª ↔ última"; }
}
function loadEpochImage(i) {
  epochIdx = Math.max(0, Math.min(epochList.length - 1, i));
  const e = epochList[epochIdx];
  document.querySelectorAll("#imgDates .epoch").forEach((c) => c.classList.toggle("on", Number(c.dataset.i) === epochIdx));
  const access = val(e.row, "access_url");
  const cutoutURL = apiUrl("/api/cutout", { url: access, center: currentRa + "," + currentDec, size: "0.25" });
  $("imgViewer").innerHTML = `<iframe title="Imagen SPHEREx del ${esc(e.label)}" allowfullscreen src="https://js9.si.edu/js9/js9.html?url=${encodeURIComponent(cutoutURL)}"></iframe>`;
  const band = val(e.row, "energy_bandpassname");
  const obs = val(e.row, "obs_id", "obs_publisher_did");
  $("imgInfo").textContent = `Imagen del ${e.label} · Banda ${band} · Observación ${obs} · Recorte de 0,25° centrado en tu punto. Si tarda en cargar, espera: los archivos FITS son grandes.`;
}
function showEpochImage(i) {
  if (!epochList.length) return;
  stopImgBlink();
  loadEpochImage(i);
}

/* ---- Búsqueda IRSA ---- */
async function fetchSIA(collection, r, d, radius) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const res = await fetch(apiUrl("/api/sia", { collection, ra: r, dec: d, radius, maxrec: MAXREC }), { signal: ctl.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(collection + ": " + body.slice(0, 200));
    return parseCSV(body);
  } catch (e) {
    if (e.name === "AbortError") throw new Error(collection + ": IRSA tardó demasiado en responder (40 s).");
    throw e;
  } finally { clearTimeout(t); }
}
async function search() {
  $("msg").style.display = "none";
  stopImgBlink();
  $("imgCard").style.display = "none";
  const name = $("name").value.trim();
  let ra = $("ra").value.trim(), dec = $("dec").value.trim();
  try {
    if (name && (!ra || !dec)) {
      const c = await resolveName(name);
      if (!Number.isFinite(Number(c.ra)) || !Number.isFinite(Number(c.dec)))
        throw new Error("No se pudo resolver ese nombre en IRSA.");
      ra = String(c.ra); dec = String(c.dec);
      $("ra").value = ra; $("dec").value = dec;
    }
    if (!ra || !dec) throw new Error("Introduce RA y DEC, o un nombre que pueda resolverse.");
    const r = Number(ra), d = Number(dec);
    if (!Number.isFinite(r) || !Number.isFinite(d) || r < 0 || r >= 360 || d < -90 || d > 90)
      throw new Error("Coordenadas no válidas. RA 0–360, DEC −90 a 90.");
    const radius = $("radius").value;
    currentRa = ra; currentDec = dec;
    $("searchBtn").disabled = true;
    updateSpherexFrame(r, d, radius);
    goToMap(true); // "Consultar IRSA" también centra el mapa, como el botón "Ver en el mapa"
    live("loading");
    rows = [];
    const jobs = COLLECTIONS.map((collection) => fetchSIA(collection, r, d, radius));
    const done = await Promise.allSettled(jobs);
    const errors = [];
    done.forEach((res, i) => {
      if (res.status === "fulfilled") res.value.forEach((o) => rows.push(o));
      else errors.push(COLLECTIONS[i] + ": " + res.reason.message);
    });
    renderEpochs();
    shareURL();
    if (errors.length && !rows.length) {
      live("error");
      msg("IRSA no respondió esta vez. Intenta de nuevo más tarde o prueba con una zona más pequeña.", "error");
    } else if (errors.length) {
      msg("IRSA respondió en parte: algunas colecciones no contestaron, pero sí hay fechas de esta zona.", "error");
    } else if (rows.length) {
      msg("Consulta completada. El visor y el mapa ya están en tus coordenadas.", "good");
    } else {
      $("live").textContent = "IRSA respondió, pero SPHEREx no tiene fotos de esta zona en las colecciones consultadas.";
      $("live").className = "notice";
      msg("IRSA respondió, pero no hay fotos de esta zona. Prueba con otro objeto o una zona más grande.", "");
    }
  } catch (e) {
    live("error");
    msg(e.message, "error");
  } finally { $("searchBtn").disabled = false; }
}

/* ---- Eventos ---- */
$("searchBtn").addEventListener("click", search);
$("spherexOpenBtn").addEventListener("click", () => {
  const ra = $("ra").value.trim(), dec = $("dec").value.trim(), radius = $("radius").value;
  if (!ra || !dec) { msg("Escribe RA y DEC para abrir IRSA.", ""); return; }
  window.open(spherexAppURL(ra, dec, radius), "_blank", "noopener");
});
$("resetBtn").addEventListener("click", resetSearch);
$("copyBtn").addEventListener("click", async () => {
  shareURL();
  try { await navigator.clipboard.writeText(location.href); msg("Enlace copiado: " + location.href, "good"); }
  catch (e) { msg("Copia esta URL: " + location.href, ""); }
});
$("healthBtn").addEventListener("click", async () => {
  const box = $("health"); box.style.display = "block"; box.textContent = "Comprobando el servicio…";
  try {
    const r = await fetch(apiUrl("/api/health")); const j = await r.json();
    box.textContent = `Servicio: ${j.service || "SPHEREx Explorer API"} · Estado: ${j.status || r.status} · IRSA: ${j.irsa || ""}`;
    box.className = "notice good";
  } catch (e) { box.textContent = "No se pudo comprobar el servicio: " + e.message; box.className = "notice error"; }
});
document.querySelectorAll("[data-ra]").forEach((b) => b.addEventListener("click", () => {
  $("name").value = b.dataset.name; $("ra").value = b.dataset.ra; $("dec").value = b.dataset.dec;
  showFunFact(b.dataset.name);
}));
$("tabViewer").addEventListener("click", () => showMapTab("viewer"));
$("tabFinder").addEventListener("click", () => showMapTab("finder"));
$("imgPrev").addEventListener("click", () => showEpochImage(epochIdx - 1));
$("imgNext").addEventListener("click", () => showEpochImage(epochIdx + 1));
$("imgDates").addEventListener("click", (ev) => {
  const c = ev.target.closest("[data-i]");
  if (c) showEpochImage(Number(c.dataset.i));
});
$("imgBlink").addEventListener("click", () => {
  if (epochList.length < 2) return;
  if (imgTimer) { stopImgBlink(); return; }
  const b = $("imgBlink");
  b.classList.add("on"); b.textContent = "Parpadeo activado · pulsa para parar";
  let last = false;
  loadEpochImage(0);
  imgTimer = setInterval(() => { last = !last; loadEpochImage(last ? epochList.length - 1 : 0); }, 1200);
});

/* ---- Inicio ---- */
window.addEventListener("error", (e) => {
  const box = $("msg");
  if (box) { box.textContent = "Error en la página: " + (e.message || "desconocido") + ". Recarga la página e inténtalo de nuevo."; box.className = "notice error"; box.style.display = "block"; }
});
$("status").textContent = "● API CONFIGURADA";
if (loadFromURL()) search();
else $("coordinates").textContent = "Punto analizado: Barnard's Star · RA 269.452077° · DEC 4.693365°";
