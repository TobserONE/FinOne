/* Finanz-Tracker – Frontend-Logik */
'use strict';

const LS_CONFIG = 'finanzapp-config';
const LS_CACHE = 'finanzapp-cache';

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
  config: { url: '', token: '' },
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

// ---------- API ----------

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

async function apiGet() {
  const u = state.config.url + '?token=' + encodeURIComponent(state.config.token) + '&action=all';
  let res;
  try {
    res = await fetch(u);
  } catch (e) {
    throw new Error('Anfrage kam nicht durch (Netzwerk/CORS). URL prüfen – sie muss mit ' +
      'https://script.google.com/macros/s/ beginnen und auf /exec enden.');
  }
  return parseResponse(res);
}

async function apiPost(action, payload) {
  // Body als String ohne Content-Type-Header => kein CORS-Preflight (Apps Script)
  let res;
  try {
    res = await fetch(state.config.url, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ token: state.config.token, action }, payload)),
    });
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
  if (!state.config.url) return;
  try {
    applyData(await apiGet());
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
  if (state.config.url) refresh(false);
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
      Bitte unter <strong>Einstellungen</strong> die Google-Sheets-Verbindung einrichten
      oder den Demo-Modus starten.</p></div>`;
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
  } else if (!state.config.url) {
    toast('Keine Verbindung konfiguriert (Einstellungen) – Änderung nur lokal!', true);
  } else {
    const btn = document.getElementById('btnSave');
    btn.disabled = true; btn.textContent = 'Speichern…';
    try {
      applyData(await apiPost('saveWeek', { jahr, kw, lohn, werte }));
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

function renderRangeSelect() {
  const sel = document.getElementById('rangeSelect');
  const jahre = [...new Set(sortedWeeks().map(w => w.jahr))].sort((a, b) => b - a);
  const prev = state.range;
  sel.innerHTML = '<option value="alle">Alle Jahre</option>' +
    '<option value="12m">Letzte 12 Monate</option>' +
    jahre.map(j => `<option value="${j}">Nur ${j}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === String(prev)) ? prev : 'alle';
  state.range = sel.value;
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

// ---------- Kategorien-Tab ----------

function renderCategories() {
  const wrap = document.getElementById('catList');
  if (!state.categories.length) {
    wrap.innerHTML = `<div class="card"><p class="hint">Noch keine Kategorien –
      erst verbinden (Einstellungen) oder Demo-Modus starten.</p></div>`;
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
  if (state.demo || !state.config.url) {
    applyLocal();
    if (!state.demo) toast('Keine Verbindung – Änderung nur lokal!', true);
  } else {
    try {
      applyData(await apiPost('updateCategory', Object.assign({ name }, changes)));
      toast('Kategorie aktualisiert ✓');
    } catch (err) {
      toast('Fehler: ' + err.message, true);
      renderCategories();
      return;
    }
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
  if (state.demo || !state.config.url) {
    state.categories.push({ name, level, aktiv: true });
    if (!state.demo) toast('Keine Verbindung – Kategorie nur lokal!', true);
  } else {
    try {
      applyData(await apiPost('addCategory', { name, level }));
      toast('Kategorie "' + name + '" angelegt ✓');
    } catch (err) {
      toast('Fehler: ' + err.message, true);
      return;
    }
  }
  document.getElementById('newCatName').value = '';
  renderAll();
}

// ---------- Einstellungen ----------

function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CONFIG) || '{}');
    state.config.url = c.url || '';
    state.config.token = c.token || '';
  } catch (e) { /* egal */ }
  document.getElementById('cfgUrl').value = state.config.url;
  document.getElementById('cfgToken').value = state.config.token;
}

function normalizeScriptUrl(u) {
  u = u.trim();
  // Alles nach /exec abschneiden (z. B. angehängte ?usp=…-Parameter)
  const m = u.match(/^(https:\/\/script\.google\.com\/macros\/s\/[^\/?#]+\/exec)/);
  if (m) return m[1];
  return u;
}

async function saveConfig() {
  const rawUrl = document.getElementById('cfgUrl').value;
  state.config.url = normalizeScriptUrl(rawUrl);
  document.getElementById('cfgUrl').value = state.config.url;
  state.config.token = document.getElementById('cfgToken').value.trim();
  if (state.config.url.endsWith('/dev')) {
    setConnStatus('⚠️ Das ist die Test-URL (/dev) – bitte die Bereitstellungs-URL verwenden, die auf /exec endet.');
    toast('URL endet auf /dev statt /exec', true);
    localStorage.setItem(LS_CONFIG, JSON.stringify(state.config));
    return;
  }
  localStorage.setItem(LS_CONFIG, JSON.stringify(state.config));
  if (!state.config.url) { setConnStatus('Keine URL eingetragen.'); return; }
  if (state.demo) endDemo();
  setConnStatus('Verbinde…');
  await refresh(true);
}

function setConnStatus(txt) {
  document.getElementById('connStatus').textContent = txt;
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
}

function renderAll() {
  fillYearKwSelects();
  renderEntryForm();
  renderCategories();
  if (!document.getElementById('tab-diagramme').classList.contains('hidden')) {
    renderCharts();
  }
}

function init() {
  document.querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('btnSave').addEventListener('click', saveWeek);
  document.getElementById('addCatForm').addEventListener('submit', addCategory);
  document.getElementById('btnCfgSave').addEventListener('click', saveConfig);
  document.getElementById('btnRefresh').addEventListener('click', () => refresh(true));
  document.getElementById('btnDemo').addEventListener('click', startDemo);
  document.getElementById('btnDemoEnde').addEventListener('click', endDemo);

  loadConfig();
  const cached = localStorage.getItem(LS_CACHE);
  if (cached) { try { applyData(JSON.parse(cached)); } catch (e) { /* egal */ } }
  renderAll();
  if (state.config.url) refresh(false);
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline egal */ });
  });
}
