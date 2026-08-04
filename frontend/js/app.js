/* ═══════════════════════════════════════════════════════
   DemandIQ — Main Application JavaScript
   ═══════════════════════════════════════════════════════ */

const API = 'http://localhost:5000/api';

// ─── Chart.js Global Config ──────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
Chart.defaults.font.family = "'Inter', sans-serif";

const CHART_COLORS = {
  purple: '#8b5cf6',
  cyan:   '#06b6d4',
  green:  '#10b981',
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#f59e0b',
};

const gradientPurple = (ctx) => {
  const g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, 'rgba(139,92,246,0.3)');
  g.addColorStop(1, 'rgba(139,92,246,0)');
  return g;
};
const gradientCyan = (ctx) => {
  const g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, 'rgba(6,182,212,0.3)');
  g.addColorStop(1, 'rgba(6,182,212,0)');
  return g;
};

// ─── State ────────────────────────────────────────────────
const state = {
  currentPage:   'dashboard',
  stores:        [],
  depts:         [],
  inventory:     [],
  charts:        {},
  forecastChart: null,
  qChart:        null,
};

// ─── Utilities ────────────────────────────────────────────
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmt = (n) => isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtMoney = (n) => isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDec = (n, d=2) => isNaN(n) ? '—' : Number(n).toFixed(d);

async function apiFetch(path, opts = {}) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90000); // 90s timeout for RL
    const r = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...opts,
    });
    clearTimeout(timeoutId);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('API timeout', path);
    } else {
      console.error('API error', path, e);
    }
    return null;
  }
}

// ─── API Status ───────────────────────────────────────────
async function checkApiStatus() {
  const el = $('#api-status');
  const dot = el.querySelector('.status-dot');
  const txt = el.querySelector('span');
  const data = await apiFetch('/health');
  if (data) {
    dot.className = 'status-dot online';
    txt.textContent = 'API Online';
  } else {
    dot.className = 'status-dot offline';
    txt.textContent = 'API Offline';
  }
}

// ─── Navigation ───────────────────────────────────────────
function navigate(page) {
  state.currentPage = page;
  $$('.nav-item').forEach(a => a.classList.remove('active'));
  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#nav-${page}`).classList.add('active');
  $(`#page-${page}`).classList.add('active');
  const titles = {
    dashboard: ['Dashboard', 'Real-time AI intelligence'],
    forecast:  ['Demand Forecast', 'XGBoost weekly sales prediction'],
    inventory: ['Inventory Manager', 'Stock status & reorder alerts'],
    optimizer: ['RL Optimizer', 'Q-Learning inventory optimization'],
    suppliers: ['Supplier Analytics', 'Ranked by performance score'],
  };
  $('#page-title').textContent   = titles[page][0];
  $('#page-subtitle').textContent = titles[page][1];
}

$$('.nav-item').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(a.dataset.page);
    loadPageData(a.dataset.page);
  });
});

$('#refresh-btn').addEventListener('click', () => loadPageData(state.currentPage));

// ─── Dashboard ────────────────────────────────────────────
async function loadDashboard() {
  const data = await apiFetch('/dashboard/summary');
  if (!data) return;

  const k = data.kpis;
  $('#kv-products').textContent  = fmt(k.total_products);
  $('#kv-stores').textContent    = fmt(k.total_stores);
  $('#kv-demand').textContent    = fmtMoney(k.avg_weekly_demand);
  $('#kv-critical').textContent  = k.critical_items + k.low_items;

  // Weekly Trend Chart
  const trendLabels = data.weekly_trend.map(d => `Wk ${d.week}`);
  const trendData   = data.weekly_trend.map(d => d.avg_sales);

  if (state.charts.trend) state.charts.trend.destroy();
  const trendCtx = $('#chart-trend').getContext('2d');
  state.charts.trend = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: 'Avg Sales',
        data: trendData,
        borderColor: CHART_COLORS.purple,
        backgroundColor: gradientPurple(trendCtx),
        borderWidth: 2.5,
        pointBackgroundColor: CHART_COLORS.purple,
        pointRadius: 3,
        pointHoverRadius: 6,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1c1f2e', borderColor: 'rgba(139,92,246,0.4)', borderWidth: 1,
        titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 12,
        callbacks: { label: ctx => ' $' + fmt(ctx.raw) },
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => '$' + fmt(v) } },
      },
    },
  });

  // Inventory Status Donut
  if (state.charts.status) state.charts.status.destroy();
  state.charts.status = new Chart($('#chart-status').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'Low', 'OK', 'Excess'],
      datasets: [{
        data: [k.critical_items, k.low_items, k.ok_items, k.excess_items],
        backgroundColor: ['rgba(239,68,68,0.8)', 'rgba(249,115,22,0.8)', 'rgba(16,185,129,0.8)', 'rgba(6,182,212,0.8)'],
        borderColor: ['#ef4444','#f97316','#10b981','#06b6d4'],
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyleWidth: 8 } },
        tooltip: {
          backgroundColor: '#1c1f2e', borderColor: 'rgba(139,92,246,0.4)', borderWidth: 1,
          titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 12,
        },
      },
    },
  });

  // Top Stores Bar
  if (state.charts.stores) state.charts.stores.destroy();
  state.charts.stores = new Chart($('#chart-stores').getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.top_stores.map(s => `Store ${s.store}`),
      datasets: [{
        label: 'Avg Sales',
        data: data.top_stores.map(s => s.avg_sales),
        backgroundColor: 'rgba(139,92,246,0.7)',
        borderColor: CHART_COLORS.purple,
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1c1f2e', borderColor: 'rgba(139,92,246,0.4)', borderWidth: 1,
        titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 12,
        callbacks: { label: ctx => ' $' + fmt(ctx.raw) },
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => '$' + fmt(v) } },
        y: { grid: { display: false } },
      },
    },
  });

  // Top Depts Bar
  if (state.charts.depts) state.charts.depts.destroy();
  state.charts.depts = new Chart($('#chart-depts').getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.top_depts.map(d => `Dept ${d.dept}`),
      datasets: [{
        label: 'Avg Sales',
        data: data.top_depts.map(d => d.avg_sales),
        backgroundColor: 'rgba(6,182,212,0.7)',
        borderColor: CHART_COLORS.cyan,
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1c1f2e', borderColor: 'rgba(6,182,212,0.4)', borderWidth: 1,
        titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 12,
        callbacks: { label: ctx => ' $' + fmt(ctx.raw) },
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => '$' + fmt(v) } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ─── Stores & Depts Selects ───────────────────────────────
async function loadStores() {
  const data = await apiFetch('/stores');
  if (!data) return;
  state.stores = data.stores;
  state.depts  = data.depts;

  ['#f-store', '#rl-store', '#inv-store-filter'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    if (sel === '#inv-store-filter') {
      el.innerHTML = '<option value="">All Stores</option>';
    } else {
      el.innerHTML = '';
    }
    state.stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `Store ${s}`;
      el.appendChild(opt);
    });
  });

  ['#f-dept', '#rl-dept'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = '';
    state.depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `Dept ${d}`;
      el.appendChild(opt);
    });
  });
}

// ─── Forecast Page ────────────────────────────────────────
$('#f-holiday').addEventListener('change', (e) => {
  $('#holiday-label').textContent = e.target.checked ? 'Yes' : 'No';
});
$('#f-promo').addEventListener('change', (e) => {
  $('#promo-label').textContent = e.target.checked ? 'Yes' : 'No';
});

$('#forecast-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#forecast-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Predicting...';

  const fd = new FormData(e.target);
  const payload = {
    store:       parseInt(fd.get('store')),
    dept:        parseInt(fd.get('dept')),
    week:        parseInt(fd.get('week')),
    month:       parseInt(fd.get('month')),
    temperature: parseFloat(fd.get('temperature')),
    fuel_price:  parseFloat(fd.get('fuel_price')),
    cpi:         parseFloat(fd.get('cpi')),
    unemployment:parseFloat(fd.get('unemployment')),
    is_holiday:  $('#f-holiday').checked ? 1 : 0,
    promotion:   $('#f-promo').checked ? 1 : 0,
    markdown1:   parseFloat(fd.get('markdown1') || 0),
  };

  const data = await apiFetch('/forecast', { method: 'POST', body: JSON.stringify(payload) });

  btn.disabled = false;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Predict Sales';

  if (!data) return;

  $('#forecast-placeholder').classList.add('hidden');
  $('#forecast-result').classList.remove('hidden');

  $('#r-sales').textContent    = fmtMoney(data.predicted_sales);
  $('#r-range').textContent    = `Range: ${fmtMoney(data.lower_bound)} – ${fmtMoney(data.upper_bound)}`;
  $('#r-store').textContent    = `Store ${data.store}`;
  $('#r-dept').textContent     = `Dept ${data.dept}`;
  $('#r-week').textContent     = `Week ${data.week}`;
  $('#r-holiday').textContent  = data.is_holiday ? '✓ Yes' : '✗ No';
  $('#r-promo').textContent    = data.promotion ? '✓ Yes' : '✗ No';
  $('#r-lower').textContent    = fmtMoney(data.lower_bound);
  $('#r-upper').textContent    = fmtMoney(data.upper_bound);

  // Confidence bar (90–110% range relative to prediction)
  $('#r-confidence').style.width = '70%';

  // Mini sparkline chart
  if (state.forecastChart) state.forecastChart.destroy();
  const miniCtx = $('#chart-forecast-mini').getContext('2d');
  const weeks = Array.from({length: 8}, (_, i) => i + parseInt(fd.get('week')));
  const mockData = weeks.map((w, i) => data.predicted_sales * (0.85 + Math.sin(i * 0.9) * 0.15));
  mockData[0] = data.predicted_sales;

  state.forecastChart = new Chart(miniCtx, {
    type: 'line',
    data: {
      labels: weeks.map(w => `Wk ${w}`),
      datasets: [{
        data: mockData,
        borderColor: CHART_COLORS.purple,
        backgroundColor: gradientPurple(miniCtx),
        borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1c1f2e', borderColor: 'rgba(139,92,246,0.4)', borderWidth: 1,
        titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 10,
        callbacks: { label: ctx => ' $' + fmt(ctx.raw) },
      }},
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { display: false },
      },
    },
  });
});

// ─── Inventory Page ───────────────────────────────────────
async function loadInventory() {
  const storeFilter = $('#inv-store-filter').value;
  let url = '/inventory/status?limit=100';
  if (storeFilter) url += `&store=${storeFilter}`;

  const tbody = $('#inv-tbody');
  tbody.innerHTML = '<tr><td colspan="10" class="loading-row"><div class="spinner"></div> Loading...</td></tr>';

  const data = await apiFetch(url);
  if (!data) { tbody.innerHTML = '<tr><td colspan="10" class="loading-row">Failed to load data</td></tr>'; return; }

  state.inventory = data.items;
  renderInventoryTable(data.items);
}

function renderInventoryTable(items) {
  const tbody   = $('#inv-tbody');
  const search  = $('#inv-search').value.toLowerCase();
  const sfilt   = $('#inv-status-filter').value;

  const filtered = items.filter(r => {
    const matchSearch = !search || `store ${r.store} dept ${r.dept}`.includes(search);
    const matchStatus = !sfilt || r.status === sfilt;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-row">No records found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><strong>${r.store}</strong></td>
      <td>${r.dept}</td>
      <td>${fmt(r.current_stock)}</td>
      <td>${fmtMoney(r.predicted_demand)}</td>
      <td>${fmt(r.safety_stock)}</td>
      <td>${fmt(r.reorder_point)}</td>
      <td>${fmt(r.eoq)}</td>
      <td style="color:${r.days_of_stock < 7 ? '#ef4444' : r.days_of_stock < 14 ? '#f97316' : '#10b981'}">${r.days_of_stock}d</td>
      <td>${r.supplier_id}</td>
      <td><span class="status-badge ${r.status}">${r.status}</span></td>
    </tr>
  `).join('');

  $('#inv-footer').textContent = `Showing ${filtered.length} of ${state.inventory.length} records`;
}

$('#inv-search').addEventListener('input',      () => renderInventoryTable(state.inventory));
$('#inv-status-filter').addEventListener('change', () => renderInventoryTable(state.inventory));
$('#inv-store-filter').addEventListener('change',  () => loadInventory());

// ─── RL Optimizer Page ────────────────────────────────────
$('#rl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#rl-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Running Q-Learning (~10s)...';

  const payload = {
    store: parseInt($('#rl-store').value),
    dept:  parseInt($('#rl-dept').value),
  };

  const data = await apiFetch('/inventory/optimize', { method: 'POST', body: JSON.stringify(payload) });

  btn.disabled = false;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Run RL Optimizer';

  if (!data) {
    const alertEl = $('#rl-reorder-alert');
    $('#rl-placeholder').classList.add('hidden');
    $('#rl-result').classList.remove('hidden');
    alertEl.className = 'reorder-alert danger';
    alertEl.innerHTML = '⚠ Error: Could not connect to backend. Make sure the Flask server is running on http://localhost:5000';
    return;
  }

  $('#rl-placeholder').classList.add('hidden');
  $('#rl-result').classList.remove('hidden');

  $('#rl-order').textContent  = `${fmt(data.rl_order_qty)} units`;
  $('#rl-sub').textContent    = `Action index: ${data.rl_best_action} of 5 | Q-Learning (500 episodes)`;
  $('#rl-demand').textContent = fmtMoney(data.predicted_demand);
  $('#rl-stock').textContent  = fmt(data.current_stock);
  $('#rl-safety').textContent = fmt(data.safety_stock);
  $('#rl-rop').textContent    = fmt(data.reorder_point);
  $('#rl-eoq').textContent    = fmt(data.eoq);
  $('#rl-days').textContent   = `${data.days_of_stock}d`;
  $('#rl-ocost').textContent  = `$${fmtDec(data.ordering_cost)}`;
  $('#rl-hcost').textContent  = `$${fmtDec(data.holding_cost)}`;

  const alertEl = $('#rl-reorder-alert');
  if (data.needs_reorder) {
    alertEl.className = 'reorder-alert danger';
    alertEl.innerHTML = `⚠ REORDER REQUIRED — Stock (${fmt(data.current_stock)}) is below Reorder Point (${fmt(data.reorder_point)}). RL recommends ordering ${fmt(data.rl_order_qty)} units.`;
  } else {
    alertEl.className = 'reorder-alert safe';
    alertEl.innerHTML = `✓ Stock OK — Current stock (${fmt(data.current_stock)}) is above Reorder Point (${fmt(data.reorder_point)}).`;
  }

  // Q-values chart
  if (state.qChart) state.qChart.destroy();
  const qCtx = $('#chart-qvalues').getContext('2d');
  const actions = data.order_quantities || [0,200,400,600,800,1000];
  const qVals   = data.rl_q_values || [];
  const colors  = actions.map((_, i) => i === data.rl_best_action ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.25)');

  state.qChart = new Chart(qCtx, {
    type: 'bar',
    data: {
      labels: actions.map(a => `${a}u`),
      datasets: [{
        label: 'Q-Value',
        data: qVals,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('0.25', '0.8').replace('0.9', '1')),
        borderWidth: 1.5,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1c1f2e', borderColor: 'rgba(139,92,246,0.4)', borderWidth: 1,
        titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 10,
      }},
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });

  // Supplier card
  if (data.supplier && data.supplier.Supplier_Name) {
    const sc = $('#rl-supplier-card');
    sc.classList.add('visible');
    sc.innerHTML = `
      <div class="supplier-card-title">Assigned Supplier</div>
      <div class="supplier-info">
        <div class="supplier-name">${data.supplier.Supplier_Name || data.supplier.supplier_name}</div>
        <span style="color:var(--text-muted)">•</span>
        <span style="font-size:0.8rem;color:var(--text-muted)">ID: ${data.supplier.Supplier_ID || data.supplier.supplier_id}</span>
        <span style="color:var(--text-muted)">•</span>
        <span style="font-size:0.8rem;color:var(--text-muted)">Lead Time: ${data.supplier.Delivery_Time || data.supplier.delivery_time}d</span>
        <span style="color:var(--text-muted)">•</span>
        <span style="font-size:0.8rem;color:var(--text-muted)">Reliability: ${data.supplier.Reliability || data.supplier.reliability}%</span>
      </div>
    `;
  }
});

// ─── Suppliers Page ───────────────────────────────────────
async function loadSuppliers() {
  const data = await apiFetch('/suppliers');
  if (!data) return;

  const grid = $('#suppliers-grid');
  grid.innerHTML = '';

  data.suppliers.forEach((s, i) => {
    const score = s.score;
    const scoreColor = score > 40 ? 'var(--green-light)' : score > 30 ? 'var(--yellow)' : 'var(--red-light)';

    const card = document.createElement('div');
    card.className = 'supplier-card-main';
    card.innerHTML = `
      <div class="supplier-rank">${i + 1}</div>
      <div class="supplier-main-name">${s.supplier_name}</div>
      <div class="supplier-main-id">${s.supplier_id}</div>
      <div class="supplier-main-score" style="background:linear-gradient(135deg,${scoreColor},var(--cyan-light));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">
        ${fmtDec(score, 2)}
      </div>
      <div class="supplier-stats">
        <div class="sup-stat">
          <span class="sup-stat-label">Reliability</span>
          <div class="sup-stat-val" style="color:var(--green-light)">${s.reliability}%</div>
        </div>
        <div class="sup-stat">
          <span class="sup-stat-label">Cost/Unit</span>
          <div class="sup-stat-val">$${s.cost_per_unit}</div>
        </div>
        <div class="sup-stat">
          <span class="sup-stat-label">Lead Time</span>
          <div class="sup-stat-val">${s.delivery_time}d</div>
        </div>
      </div>
      <div class="sup-products">${fmt(s.products_count)} product lines assigned</div>
    `;
    grid.appendChild(card);
  });
}

// ─── Feature Importance ───────────────────────────────────
async function loadFeatureImportance() {
  // Could add a modal or section – skipped for brevity
}

// ─── Page Router ──────────────────────────────────────────
async function loadPageData(page) {
  switch (page) {
    case 'dashboard': await loadDashboard();  break;
    case 'inventory': await loadInventory();  break;
    case 'suppliers': await loadSuppliers();  break;
    case 'forecast':  /* form-driven */       break;
    case 'optimizer': /* form-driven */       break;
  }
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  await checkApiStatus();
  await loadStores();
  await loadDashboard();
  setInterval(checkApiStatus, 30000);
}

document.addEventListener('DOMContentLoaded', init);
