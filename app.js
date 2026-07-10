/* Finanz-Tracker – Frontend-Logik */
'use strict';

const LS_CONFIG = 'finanzapp-config'; // alte Sheets-Zugangsdaten – nur noch fürs Vorbefüllen der Migration
const LS_CACHE = 'finanzapp-cache';

// Zugangsdaten des Supabase-Projekts (Dashboard → Settings → API).
// Solange beide Werte leer sind, arbeitet die App rein lokal (Cache/Demo).
const SUPABASE_URL = 'https://txnvnphlsqeysebdbswe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4bnZucGhsc3FleXNlYmRic3dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2ODk4MTMsImV4cCI6MjA5OTI2NTgxM30.0Yfa8d844Car8nlTBeagke7ZtSUHK-qCLeMkE4l_wOE';

const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser = null;

const LEVEL_TITEL = {
  1: 'Level 1 · Konten & Cash',
  2: 'Level 2 · zusätzlich (Aktien)',
  3: 'Level 3 · zusätzlich (Anlagen)',
};

const LEVEL_FARBEN = { 1: '#2563eb', 2: '#7c3aed', 3: '#d97706' };

const DEFAULT_KATEGORIEN = [
  ['Girokonto', 1], ['Tagesgeld', 1], ['Geldmarktfonds', 1], ['Cash', 1],
  ['Sparbücher', 1], ['Kreditkarte', 1], ['PayPal', 1],
  ['Aktien', 2],
  ['Private Markets', 3], ['Crypto', 3], ['Bausparvertrag', 3], ['Gold', 3], ['Riester', 3],
];

const state = {
  demo: false,
  categories: [],   // {name, level, aktiv}
  weekData: {},     // "2026-27" -> {jahr, kw, lohn, werte:{name: zahl}}
  charts: {},
  range: 'alle',
};

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

// ---------- Kalenderwochen-Helfer ----------

function wkKey(jahr, kw) { return jahr + '-' + String(kw).padStart(2, '0'); }

function isoWeekOf(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Donnerstag der Woche
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((date - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { week, year: isoYear };
}

function weeksInYear(jahr) {
  return isoWeekOf(new Date(jahr, 11, 28)).week; // 28.12. liegt immer in der letzten KW
}

function mondayOf(jahr, kw) {
  const jan4 = new Date(jahr, 0, 4);
  const day = (jan4.getDay() + 6) % 7;
  return new Date(jahr, 0, 4 - day + (kw - 1) * 7);
}

function parseNum(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? null : n;
}

// ---------- API (Supabase) ----------

async function sbLoadAll() {
  const [k, w, d] = await Promise.all([
    sb.from('kategorien').select('name,level,aktiv').order('pos'),
    sb.from('wochen').select('jahr,kw,lohn'),
    sb.from('daten').select('jahr,kw,kategorie,wert'),
  ]);
  for (const r of [k, w, d]) if (r.error) throw new Error(r.error.message);
  return {
    categories: k.data,
    weeks: w.data,
    entries: d.data.map(e => ({ jahr: e.jahr, kw: e.kw, kategorie: e.kategorie, wert: Number(e.wert) })),
  };
}

// Aktuellen State in den localStorage-Cache schreiben (Offline-Ansicht)
function cacheState() {
  if (state.demo) return;
  const weeks = Object.values(state.weekData);
  const data = {
    categories: state.categories,
    weeks: weeks.map(w => ({ jahr: w.jahr, kw: w.kw, lohn: w.lohn })),
    entries: [].concat(...weeks.map(w =>
      Object.keys(w.werte).map(c => ({ jahr: w.jahr, kw: w.kw, kategorie: c, wert: w.werte[c] })))),
  };
  try { localStorage.setItem(LS_CACHE, JSON.stringify(data)); } catch (e) { /* voll */ }
}

// ---------- Google-Sheets-Zugriff (nur noch für die einmalige Migration) ----------

async function parseResponse(res) {
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    if (text.trimStart().startsWith('<')) {
      throw new Error('Google liefert eine HTML-Seite statt Daten. Meist heißt das: ' +
        'Web-App nicht mit Zugriff "Jeder" bereitgestellt, oder die URL ist falsch ' +
        '(muss auf /exec enden), oder das Script wurde noch nicht autorisiert.');
    }
    throw new Error('Unerwartete Antwort: ' + text.slice(0, 100));
  }
  if (!j.ok) {
    let msg = j.error || 'Unbekannter Fehler';
    if (/Ungültiges Token/.test(msg)) {
      msg += ' – Token in der App und in Code.gs müssen exakt übereinstimmen. ' +
        'Falls du das Token nach dem Bereitstellen geändert hast: In Apps Script ' +
        '"Bereitstellen → Bereitstellungen verwalten → ✏️ → Neue Version" wählen!';
    }
    throw new Error(msg);
  }
  return j.data;
}

async function sheetsGet(url, token) {
  const u = url + '?token=' + encodeURIComponent(token) + '&action=all';
  let res;
  try {
    res = await fetch(u);
  } catch (e) {
    throw new Error('Anfrage kam nicht durch (Netzwerk/CORS). URL prüfen – sie muss mit ' +
      'https://script.google.com/macros/s/ beginnen und auf /exec enden.');
  }
  return parseResponse(res);
}

function applyData(data) {
  state.categories = data.categories || [];
  state.weekData = {};
  (data.weeks || []).forEach(w => {
    state.weekData[wkKey(w.jahr, w.kw)] = { jahr: w.jahr, kw: w.kw, lohn: !!w.lohn, werte: {} };
  });
  (data.entries || []).forEach(e => {
    const k = wkKey(e.jahr, e.kw);
    if (!state.weekData[k]) state.weekData[k] = { jahr: e.jahr, kw: e.kw, lohn: false, werte: {} };
    state.weekData[k].werte[e.kategorie] = e.wert;
  });
  if (!state.demo) {
    try { localStorage.setItem(LS_CACHE, JSON.stringify(data)); } catch (e) { /* voll */ }
  }
}

async function refresh(showToast) {
  if (state.demo) return;
  if (!sb || !currentUser) return;
  try {
    applyData(await sbLoadAll());
    renderAll();
    if (showToast) toast('Daten geladen ✓');
    setConnStatus('✅ Verbunden – ' + Object.keys(state.weekData).length + ' Wochen geladen.');
  } catch (err) {
    toast('Laden fehlgeschlagen: ' + err.message, true);
    setConnStatus('❌ ' + err.message);
  }
}

// ---------- Demo-Modus ----------

function startDemo() {
  state.demo = true;
  state.categories = DEFAULT_KATEGORIEN.map(([name, level]) => ({ name, level, aktiv: true }));
  state.weekData = {};
  const heute = new Date();
  const basis = {
    'Girokonto': 2500, 'Tagesgeld': 1800, 'Geldmarktfonds': 5000, 'Cash': 300,
    'Sparbücher': 4000, 'Kreditkarte': -450, 'PayPal': 120,
    'Aktien': 12000, 'Private Markets': 2000, 'Crypto': 1500,
    'Bausparvertrag': 8000, 'Gold': 3500, 'Riester': 9500,
  };
  // ~90 Wochen Verlauf über den Jahreswechsel hinweg erzeugen
  for (let i = 90; i >= 0; i--) {
    const d = new Date(heute); d.setDate(d.getDate() - i * 7);
    const { week, year } = isoWeekOf(d);
    const w = { jahr: year, kw: week, lohn: week % 4 === 1, werte: {} };
    Object.keys(basis).forEach(k => {
      const trend = (90 - i) * (k === 'Aktien' ? 55 : k === 'Kreditkarte' ? -1 : 12);
      const rauschen = Math.sin(i * 1.7 + k.length) * (k === 'Aktien' ? 600 : 90);
      if (w.lohn && k === 'Girokonto') basis[k] += 0; // Basis bleibt, Trend reicht
      w.werte[k] = Math.round((basis[k] + trend + rauschen) * 100) / 100;
    });
    state.weekData[wkKey(year, week)] = w;
  }
  document.getElementById('demoBanner').classList.remove('hidden');
  renderAll();
  toast('Demo-Modus aktiv 🧪');
}

function endDemo() {
  state.demo = false;
  state.categories = [];
  state.weekData = {};
  const cached = localStorage.getItem(LS_CACHE);
  if (cached) { try { applyData(JSON.parse(cached)); } catch (e) { /* egal */ } }
  document.getElementById('demoBanner').classList.add('hidden');
  renderAll();
  if (sb && currentUser) refresh(false);
}

// ---------- Eingabe-Tab ----------

function fillYearKwSelects() {
  const selJahr = document.getElementById('inpJahr');
  const selKW = document.getElementById('inpKW');
  const { year: curYear, week: curWeek } = isoWeekOf(new Date());

  const jahre = new Set([curYear - 2, curYear - 1, curYear, curYear + 1]);
  Object.values(state.weekData).forEach(w => jahre.add(w.jahr));
  selJahr.innerHTML = [...jahre].sort().map(j => `<option value="${j}">${j}</option>`).join('');
  selJahr.value = curYear;

  const fillKw = () => {
    const jahr = Number(selJahr.value);
    const n = weeksInYear(jahr);
    const prev = Number(selKW.value) || curWeek;
    selKW.innerHTML = Array.from({ length: n }, (_, i) => {
      const kw = i + 1;
      const hat = state.weekData[wkKey(jahr, kw)];
      const lohn = hat && hat.lohn ? ' 💚' : '';
      const voll = hat && Object.keys(hat.werte).length ? ' ●' : '';
      return `<option value="${kw}">KW ${String(kw).padStart(2, '0')}${voll}${lohn}</option>`;
    }).join('');
    selKW.value = Math.min(prev, n);
  };
  fillKw();
  selKW.value = curWeek;

  selJahr.onchange = () => { fillKw(); fillEntryForm(); };
  selKW.onchange = fillEntryForm;
}

function renderEntryForm() {
  const wrap = document.getElementById('entryForm');
  const aktive = state.categories.filter(c => c.aktiv);
  if (!aktive.length) {
    wrap.innerHTML = `<div class="card"><p class="hint">Noch keine Kategorien geladen.
      Bitte unter <strong>Einstellungen</strong> anmelden, den Demo-Modus starten
      oder unter <strong>Kategorien</strong> welche anlegen.</p></div>`;
    return;
  }
  let html = '';
  for (const lvl of [1, 2, 3]) {
    const cats = aktive.filter(c => c.level === lvl);
    if (!cats.length) continue;
    html += `<div class="card level-section">
      <h2><span class="level-badge l${lvl}">L${lvl}</span> ${LEVEL_TITEL[lvl]}</h2>
      <div class="cat-inputs">
        ${cats.map(c => `<label>${c.name}
          <input type="text" inputmode="decimal" placeholder="0,00" data-cat="${c.name}">
        </label>`).join('')}
      </div>
    </div>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll('input[data-cat]').forEach(inp => {
    inp.addEventListener('input', updateSummen);
  });
  fillEntryForm();
}

function currentWeekSelection() {
  return {
    jahr: Number(document.getElementById('inpJahr').value),
    kw: Number(document.getElementById('inpKW').value),
  };
}

function fillEntryForm() {
  const { jahr, kw } = currentWeekSelection();
  const w = state.weekData[wkKey(jahr, kw)];
  document.getElementById('inpLohn').checked = !!(w && w.lohn);
  document.querySelectorAll('#entryForm input[data-cat]').forEach(inp => {
    const val = w ? w.werte[inp.dataset.cat] : undefined;
    inp.value = (val === undefined || val === null)
      ? '' : String(val).replace('.', ',');
  });
  const status = document.getElementById('weekStatus');
  const mo = mondayOf(jahr, kw);
  const so = new Date(mo); so.setDate(so.getDate() + 6);
  const fmt = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  status.textContent = `${fmt(mo)} – ${fmt(so)}` +
    (w && Object.keys(w.werte).length ? ' · Werte vorhanden, Speichern überschreibt.' : ' · Noch keine Werte.');
  updateSummen();
}

function updateSummen() {
  const werte = {};
  document.querySelectorAll('#entryForm input[data-cat]').forEach(inp => {
    werte[inp.dataset.cat] = parseNum(inp.value);
  });
  const el = document.getElementById('entrySummen');
  el.innerHTML = [1, 2, 3].map(lvl => {
    let sum = 0, has = false;
    state.categories.forEach(c => {
      if (c.level <= lvl && werte[c.name] !== null && werte[c.name] !== undefined) {
        sum += werte[c.name]; has = true;
      }
    });
    const txt = has ? EUR.format(sum) : '–';
    return `<div class="sum-item">
      <div class="sum-label">Level ${lvl} gesamt</div>
      <div class="sum-value${sum < 0 ? ' neg' : ''}">${txt}</div>
    </div>`;
  }).join('');
}

async function saveWeek() {
  const { jahr, kw } = currentWeekSelection();
  const lohn = document.getElementById('inpLohn').checked;
  const werte = {};
  document.querySelectorAll('#entryForm input[data-cat]').forEach(inp => {
    werte[inp.dataset.cat] = parseNum(inp.value);
  });

  // lokal übernehmen
  const k = wkKey(jahr, kw);
  const w = state.weekData[k] || { jahr, kw, lohn: false, werte: {} };
  w.lohn = lohn;
  Object.keys(werte).forEach(cat => {
    if (werte[cat] === null) delete w.werte[cat];
    else w.werte[cat] = werte[cat];
  });
  state.weekData[k] = w;

  if (state.demo) {
    toast('Demo: nur lokal gespeichert 🧪');
  } else if (!sb || !currentUser) {
    toast('Nicht angemeldet (Einstellungen) – Änderung nur lokal!', true);
  } else {
    const btn = document.getElementById('btnSave');
    btn.disabled = true; btn.textContent = 'Speichern…';
    try {
      const uid = currentUser.id;
      const setRows = Object.keys(werte)
        .filter(cat => werte[cat] !== null)
        .map(cat => ({ user_id: uid, jahr, kw, kategorie: cat, wert: werte[cat] }));
      const delCats = Object.keys(werte).filter(cat => werte[cat] === null);
      let r = await sb.from('wochen').upsert({ user_id: uid, jahr, kw, lohn });
      if (!r.error && setRows.length) r = await sb.from('daten').upsert(setRows);
      if (!r.error && delCats.length) {
        r = await sb.from('daten').delete().eq('jahr', jahr).eq('kw', kw).in('kategorie', delCats);
      }
      if (r.error) throw new Error(r.error.message);
      cacheState();
      toast('KW ' + kw + '/' + jahr + ' gespeichert ✓');
    } catch (err) {
      toast('Speichern fehlgeschlagen: ' + err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Woche speichern';
    }
  }
  fillYearKwSelects();
  document.getElementById('inpJahr').value = jahr;
  const selKW = document.getElementById('inpKW');
  if (![...selKW.options].some(o => Number(o.value) === kw)) fillYearKwSelects();
  selKW.value = kw;
  fillEntryForm();
  renderCharts();
}

// ---------- Diagramme ----------

function sortedWeeks() {
  return Object.values(state.weekData)
    .filter(w => Object.keys(w.werte).length > 0)
    .sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
}

function filteredWeeks() {
  const weeks = sortedWeeks();
  if (state.range === 'alle') return weeks;
  if (state.range === '12m') {
    const limit = new Date(); limit.setDate(limit.getDate() - 365);
    return weeks.filter(w => mondayOf(w.jahr, w.kw) >= limit);
  }
  const jahr = Number(state.range);
  return weeks.filter(w => w.jahr === jahr);
}

function levelTotal(w, lvl) {
  let sum = 0, has = false;
  state.categories.forEach(c => {
    const v = w.werte[c.name];
    if (c.level <= lvl && v !== undefined && v !== null) { sum += Number(v); has = true; }
  });
  return has ? Math.round(sum * 100) / 100 : null;
}

// Grüne Hintergrundstreifen für Lohnwochen
const lohnBandPlugin = {
  id: 'lohnBands',
  beforeDatasetsDraw(chart) {
    const idx = chart.$lohnIdx || [];
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !idx.length) return;
    let half = (scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)) / 2;
    if (!isFinite(half) || half <= 0) half = 8;
    ctx.save();
    ctx.fillStyle = 'rgba(22, 163, 74, 0.10)';
    idx.forEach(i => {
      const x = scales.x.getPixelForValue(i);
      ctx.fillRect(x - half, chartArea.top, half * 2, chartArea.bottom - chartArea.top);
    });
    ctx.restore();
  },
};

function buildChart(canvasId, lvl, weeks) {
  const canvas = document.getElementById(canvasId);
  if (state.charts[canvasId]) { state.charts[canvasId].destroy(); delete state.charts[canvasId]; }

  const labels = weeks.map(w => 'KW' + String(w.kw).padStart(2, '0') + ' ' + w.jahr);
  const data = weeks.map(w => levelTotal(w, lvl));
  const farbe = LEVEL_FARBEN[lvl];
  const ptFarben = weeks.map(w => (w.lohn ? '#16a34a' : farbe));
  const ptRadius = weeks.map(w => (w.lohn ? 5 : 3));

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Level ' + lvl,
        data,
        borderColor: farbe,
        backgroundColor: farbe + '18',
        fill: true,
        tension: 0.25,
        spanGaps: true,
        pointBackgroundColor: ptFarben,
        pointBorderColor: ptFarben,
        pointRadius: ptRadius,
        pointHoverRadius: 7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => EUR.format(ctx.parsed.y),
            afterLabel: ctx => (weeks[ctx.dataIndex].lohn ? '💚 Lohnwoche' : ''),
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => EUR.format(v) } },
        x: { ticks: { maxRotation: 60, autoSkip: true, maxTicksLimit: 26 } },
      },
    },
    plugins: [lohnBandPlugin],
  });
  chart.$lohnIdx = weeks.map((w, i) => (w.lohn ? i : -1)).filter(i => i >= 0);
  chart.update('none');
  state.charts[canvasId] = chart;
}

function fillRangeSelect(sel) {
  const jahre = [...new Set(sortedWeeks().map(w => w.jahr))].sort((a, b) => b - a);
  const prev = state.range;
  sel.innerHTML = '<option value="alle">Alle Jahre</option>' +
    '<option value="12m">Letzte 12 Monate</option>' +
    jahre.map(j => `<option value="${j}">Nur ${j}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === String(prev)) ? prev : 'alle';
  state.range = sel.value;
}

function renderRangeSelect() {
  const sel = document.getElementById('rangeSelect');
  fillRangeSelect(sel);
  sel.onchange = () => { state.range = sel.value; renderCharts(); };
}

function renderCharts() {
  renderRangeSelect();
  const weeks = filteredWeeks();
  [[1, 'chartL1'], [2, 'chartL2'], [3, 'chartL3']].forEach(([lvl, id]) => {
    const wrap = document.getElementById(id).parentElement;
    let empty = wrap.querySelector('.chart-empty');
    if (!weeks.length) {
      if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
      document.getElementById(id).classList.add('hidden');
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'chart-empty';
        empty.textContent = 'Noch keine Daten – trage zuerst eine Woche ein.';
        wrap.appendChild(empty);
      }
    } else {
      if (empty) empty.remove();
      document.getElementById(id).classList.remove('hidden');
      buildChart(id, lvl, weeks);
    }
  });
}

// ---------- Tabellen-Tab ----------

function tableColumns(weeks) {
  const benutzt = new Set();
  weeks.forEach(w => Object.keys(w.werte).forEach(k => benutzt.add(k)));
  const cols = [];
  for (const lvl of [1, 2, 3]) {
    state.categories.forEach(c => {
      if (c.level === lvl && (c.aktiv || benutzt.has(c.name))) cols.push(c);
    });
  }
  // Werte ohne bekannte Kategorie (z. B. umbenannt/entfernt) hinten anhängen
  const bekannt = new Set(state.categories.map(c => c.name));
  [...benutzt].filter(n => !bekannt.has(n)).sort().forEach(n => cols.push({ name: n, level: 0 }));
  return cols;
}

function renderTable() {
  const sel = document.getElementById('tableRangeSelect');
  fillRangeSelect(sel);
  sel.onchange = () => { state.range = sel.value; renderTable(); };

  const wrap = document.getElementById('tableWrap');
  const weeks = filteredWeeks().slice().reverse(); // neueste zuerst
  if (!weeks.length) {
    wrap.innerHTML = '<p class="chart-empty">Noch keine Daten – trage zuerst eine Woche ein.</p>';
    return;
  }

  const cols = tableColumns(weeks);
  const zelle = v => (v === undefined || v === null)
    ? '<td class="num leer">–</td>'
    : `<td class="num${v < 0 ? ' neg' : ''}">${EUR.format(v)}</td>`;

  let html = '<table class="data-table"><thead><tr><th class="week-col">Woche</th>';
  cols.forEach(c => {
    html += `<th class="num${c.level ? ' lvl-' + c.level : ''}">${c.name}</th>`;
  });
  html += '<th class="num total-col">Σ L1</th><th class="num total-col">Σ L2</th>' +
    '<th class="num total-col">Σ L3</th></tr></thead><tbody>';

  weeks.forEach(w => {
    html += `<tr data-jahr="${w.jahr}" data-kw="${w.kw}"${w.lohn ? ' class="lohn"' : ''}>` +
      `<th class="week-col">KW ${String(w.kw).padStart(2, '0')} ${w.jahr}${w.lohn ? ' 💚' : ''}</th>`;
    cols.forEach(c => { html += zelle(w.werte[c.name]); });
    [1, 2, 3].forEach(lvl => {
      const s = levelTotal(w, lvl);
      html += (s === null)
        ? '<td class="num total-col leer">–</td>'
        : `<td class="num total-col${s < 0 ? ' neg' : ''}">${EUR.format(s)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const jahr = tr.dataset.jahr, kw = Number(tr.dataset.kw);
      switchTab('eingabe');
      const selJahr = document.getElementById('inpJahr');
      selJahr.value = jahr;
      selJahr.onchange();
      document.getElementById('inpKW').value = kw;
      fillEntryForm();
    });
  });
}

// ---------- Kategorien-Tab ----------

function renderCategories() {
  const wrap = document.getElementById('catList');
  if (!state.categories.length) {
    wrap.innerHTML = `<div class="card"><p class="hint">Noch keine Kategorien – unter
      <strong>Einstellungen</strong> anmelden bzw. den Demo-Modus starten, unten eine
      eigene Kategorie anlegen oder mit den Standard-Kategorien beginnen:</p>
      <div class="btn-row" style="margin-top: 12px">
        <button id="btnSeedCats">Standard-Kategorien anlegen</button>
      </div></div>`;
    document.getElementById('btnSeedCats').onclick = seedDefaults;
    return;
  }
  let html = '';
  for (const lvl of [1, 2, 3]) {
    const cats = state.categories.filter(c => c.level === lvl);
    html += `<div class="card">
      <h2><span class="level-badge l${lvl}">L${lvl}</span> ${LEVEL_TITEL[lvl]}</h2>
      ${cats.length ? cats.map(c => `
        <div class="cat-row${c.aktiv ? '' : ' inaktiv'}">
          <span class="cat-name">${c.name}</span>
          <select data-cat-level="${c.name}">
            ${[1, 2, 3].map(l => `<option value="${l}"${l === c.level ? ' selected' : ''}>Level ${l}</option>`).join('')}
          </select>
          <button class="small" data-cat-rename="${c.name}">✏️ Umbenennen</button>
          <button class="small" data-cat-toggle="${c.name}">${c.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
        </div>`).join('') : '<p class="hint">Keine Kategorien in diesem Level.</p>'}
    </div>`;
  }
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-cat-rename]').forEach(btn => {
    btn.onclick = async () => {
      const alt = btn.dataset.catRename;
      const neu = prompt('Neuer Name für "' + alt + '":', alt);
      if (!neu || neu.trim() === '' || neu === alt) return;
      await catUpdate(alt, { newName: neu.trim() }, () => {
        const c = state.categories.find(x => x.name === alt);
        if (c) c.name = neu.trim();
        Object.values(state.weekData).forEach(w => {
          if (alt in w.werte) { w.werte[neu.trim()] = w.werte[alt]; delete w.werte[alt]; }
        });
      });
    };
  });
  wrap.querySelectorAll('[data-cat-toggle]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.catToggle;
      const c = state.categories.find(x => x.name === name);
      await catUpdate(name, { aktiv: !c.aktiv }, () => { c.aktiv = !c.aktiv; });
    };
  });
  wrap.querySelectorAll('[data-cat-level]').forEach(sel => {
    sel.onchange = async () => {
      const name = sel.dataset.catLevel;
      const lvl = Number(sel.value);
      await catUpdate(name, { level: lvl }, () => {
        const c = state.categories.find(x => x.name === name);
        if (c) c.level = lvl;
      });
    };
  });
}

async function catUpdate(name, changes, applyLocal) {
  if (state.demo || !sb || !currentUser) {
    applyLocal();
    if (!state.demo) toast('Nicht angemeldet – Änderung nur lokal!', true);
  } else {
    try {
      let r;
      if (changes.newName) {
        r = await sb.from('kategorien').update({ name: changes.newName }).eq('name', name);
        if (!r.error) {
          r = await sb.from('daten').update({ kategorie: changes.newName }).eq('kategorie', name);
        }
      } else {
        r = await sb.from('kategorien').update(changes).eq('name', name);
      }
      if (r.error) throw new Error(r.error.message);
      applyLocal();
      cacheState();
      toast('Kategorie aktualisiert ✓');
    } catch (err) {
      toast('Fehler: ' + err.message, true);
      renderCategories();
      return;
    }
  }
  renderAll();
}

async function seedDefaults() {
  const neu = DEFAULT_KATEGORIEN.map(([name, level]) => ({ name, level, aktiv: true }));
  if (state.demo || !sb || !currentUser) {
    state.categories = neu;
    if (!state.demo) toast('Nicht angemeldet – Kategorien nur lokal!', true);
  } else {
    const r = await sb.from('kategorien').upsert(
      neu.map(c => Object.assign({ user_id: currentUser.id }, c)),
      { onConflict: 'user_id,name' });
    if (r.error) { toast('Fehler: ' + r.error.message, true); return; }
    state.categories = neu;
    cacheState();
    toast('Standard-Kategorien angelegt ✓');
  }
  renderAll();
}

async function addCategory(ev) {
  ev.preventDefault();
  const name = document.getElementById('newCatName').value.trim();
  const level = Number(document.getElementById('newCatLevel').value);
  if (!name) return;
  if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    toast('Kategorie existiert bereits', true);
    return;
  }
  if (state.demo || !sb || !currentUser) {
    state.categories.push({ name, level, aktiv: true });
    if (!state.demo) toast('Nicht angemeldet – Kategorie nur lokal!', true);
  } else {
    try {
      const r = await sb.from('kategorien')
        .insert({ user_id: currentUser.id, name, level, aktiv: true });
      if (r.error) throw new Error(r.error.message);
      state.categories.push({ name, level, aktiv: true });
      cacheState();
      toast('Kategorie "' + name + '" angelegt ✓');
    } catch (err) {
      toast('Fehler: ' + err.message, true);
      return;
    }
  }
  document.getElementById('newCatName').value = '';
  renderAll();
}

// ---------- Einstellungen: Konto ----------

function setConnStatus(txt) {
  document.getElementById('connStatus').textContent = txt;
}

function updateAuthUI() {
  document.getElementById('authLoggedOut').classList.toggle('hidden', !!currentUser);
  document.getElementById('authLoggedIn').classList.toggle('hidden', !currentUser);
  if (!sb) {
    setConnStatus('⚠️ Kein Supabase-Projekt hinterlegt – SUPABASE_URL und SUPABASE_ANON_KEY ' +
      'oben in app.js eintragen (siehe Einrichtung unten).');
  } else if (currentUser) {
    document.getElementById('authUser').textContent = currentUser.email || '';
  } else {
    setConnStatus('Nicht angemeldet – Daten werden nur lokal angezeigt.');
  }
}

function authErrorText(error) {
  const m = (error && error.message) || '';
  if (m.indexOf('Invalid login credentials') >= 0) return 'E-Mail oder Passwort falsch';
  if (m.indexOf('already registered') >= 0) return 'Diese E-Mail ist bereits registriert';
  if (m.indexOf('at least 6 characters') >= 0) return 'Passwort: mindestens 6 Zeichen';
  if (m.indexOf('valid email') >= 0) return 'Bitte gültige E-Mail-Adresse eingeben';
  if (m.indexOf('Email not confirmed') >= 0) return 'E-Mail noch nicht bestätigt – bitte Postfach prüfen';
  return m || 'Unbekannter Fehler';
}

function authCredentials() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPass').value;
  if (!email || !password) { toast('Bitte E-Mail und Passwort eingeben', true); return null; }
  return { email, password };
}

async function doLogin() {
  if (!sb) { updateAuthUI(); return; }
  const cred = authCredentials();
  if (!cred) return;
  const r = await sb.auth.signInWithPassword(cred);
  if (r.error) { toast(authErrorText(r.error), true); return; }
  document.getElementById('authPass').value = '';
  toast('Angemeldet ✓');
}

async function doSignup() {
  if (!sb) { updateAuthUI(); return; }
  const cred = authCredentials();
  if (!cred) return;
  const r = await sb.auth.signUp(cred);
  if (r.error) { toast(authErrorText(r.error), true); return; }
  document.getElementById('authPass').value = '';
  if (r.data && r.data.session) toast('Konto erstellt ✓');
  else toast('Bestätigungs-E-Mail gesendet – bitte Postfach prüfen');
}

async function doLogout() {
  await sb.auth.signOut();
  toast('Abgemeldet – deine Daten bleiben lokal im Cache erhalten');
}

// ---------- Einstellungen: Migration aus Google Sheets ----------

function normalizeScriptUrl(u) {
  u = u.trim();
  // Alles nach /exec abschneiden (z. B. angehängte ?usp=…-Parameter)
  const m = u.match(/^(https:\/\/script\.google\.com\/macros\/s\/[^\/?#]+\/exec)/);
  if (m) return m[1];
  return u;
}

function prefillMigration() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CONFIG) || '{}');
    document.getElementById('migUrl').value = c.url || '';
    document.getElementById('migToken').value = c.token || '';
  } catch (e) { /* egal */ }
}

function setMigStatus(txt) {
  document.getElementById('migStatus').textContent = txt;
}

async function migrateFromSheets() {
  if (!sb || !currentUser) { toast('Bitte zuerst oben anmelden', true); return; }
  const url = normalizeScriptUrl(document.getElementById('migUrl').value);
  const token = document.getElementById('migToken').value.trim();
  if (!url || !token) { toast('Apps-Script-URL und Token eingeben', true); return; }

  const btn = document.getElementById('btnMigrate');
  btn.disabled = true;
  try {
    setMigStatus('Lade Daten aus Google Sheets …');
    const data = await sheetsGet(url, token);
    const uid = currentUser.id;

    const cats = (data.categories || []).map(c =>
      ({ user_id: uid, name: c.name, level: c.level, aktiv: !!c.aktiv }));
    const weeks = (data.weeks || []).map(w =>
      ({ user_id: uid, jahr: w.jahr, kw: w.kw, lohn: !!w.lohn }));
    const entries = (data.entries || []).map(e =>
      ({ user_id: uid, jahr: e.jahr, kw: e.kw, kategorie: e.kategorie, wert: e.wert }));

    setMigStatus('Übertrage ' + cats.length + ' Kategorien …');
    let r = await sb.from('kategorien').upsert(cats, { onConflict: 'user_id,name' });
    if (r.error) throw new Error(r.error.message);

    setMigStatus('Übertrage ' + weeks.length + ' Wochen …');
    r = await sb.from('wochen').upsert(weeks, { onConflict: 'user_id,jahr,kw' });
    if (r.error) throw new Error(r.error.message);

    for (let i = 0; i < entries.length; i += 500) {
      setMigStatus('Übertrage Werte ' + (i + 1) + '–' +
        Math.min(i + 500, entries.length) + ' von ' + entries.length + ' …');
      r = await sb.from('daten').upsert(entries.slice(i, i + 500),
        { onConflict: 'user_id,jahr,kw,kategorie' });
      if (r.error) throw new Error(r.error.message);
    }

    await refresh(false);
    setMigStatus('✅ Migration abgeschlossen: ' + cats.length + ' Kategorien, ' +
      weeks.length + ' Wochen, ' + entries.length + ' Werte übernommen.');
    toast('Migration abgeschlossen ✓');
  } catch (err) {
    setMigStatus('❌ ' + err.message);
    toast('Migration fehlgeschlagen: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- UI-Gerüst ----------

function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), isError ? 5000 : 2500);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('hidden', p.id !== 'tab-' + name));
  if (name === 'diagramme') renderCharts();
  if (name === 'tabelle') renderTable();
}

function renderAll() {
  fillYearKwSelects();
  renderEntryForm();
  renderCategories();
  if (!document.getElementById('tab-diagramme').classList.contains('hidden')) {
    renderCharts();
  }
  if (!document.getElementById('tab-tabelle').classList.contains('hidden')) {
    renderTable();
  }
}

function init() {
  document.querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('btnSave').addEventListener('click', saveWeek);
  document.getElementById('addCatForm').addEventListener('submit', addCategory);
  document.getElementById('btnLogin').addEventListener('click', doLogin);
  document.getElementById('btnSignup').addEventListener('click', doSignup);
  document.getElementById('btnLogout').addEventListener('click', doLogout);
  document.getElementById('btnMigrate').addEventListener('click', migrateFromSheets);
  document.getElementById('btnRefresh').addEventListener('click', () => refresh(true));
  document.getElementById('btnDemo').addEventListener('click', startDemo);
  document.getElementById('btnDemoEnde').addEventListener('click', endDemo);

  prefillMigration();
  updateAuthUI();
  const cached = localStorage.getItem(LS_CACHE);
  if (cached) { try { applyData(JSON.parse(cached)); } catch (e) { /* egal */ } }
  renderAll();

  if (sb) {
    sb.auth.onAuthStateChange((_ev, session) => {
      const vorher = currentUser && currentUser.id;
      currentUser = session ? session.user : null;
      updateAuthUI();
      // Nur bei echtem Nutzerwechsel laden, nicht bei jedem Token-Refresh
      if (currentUser && currentUser.id !== vorher) refresh(false);
    });
  }
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline egal */ });
  });
}
