// the page: make a link, list the ones made in this browser, open the numbers of one

const $ = (id) => document.getElementById(id);
const STORE = 'curto.links';
const host = location.host;

function saved() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || [];
  } catch {
    return [];
  }
}
function save(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 50)));
  } catch {
    // private window or storage blocked: the list just won't stick
  }
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.error || 'Something went wrong, try again.'), { status: res.status });
  return body;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const plain = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// make a link

$('prefix').textContent = `${host}/`;

$('shorten').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('error');
  const button = event.target.querySelector('.go');
  error.hidden = true;
  button.disabled = true;
  try {
    const link = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: $('url').value, alias: $('alias').value }),
    });
    save([{ code: link.code, url: link.url, createdAt: link.createdAt }, ...saved().filter((l) => l.code !== link.code)]);
    showResult(link);
    $('url').value = '';
    $('alias').value = '';
    renderLinks();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    $('url').focus();
  } finally {
    button.disabled = false;
  }
});

function showResult(link) {
  $('result-link').href = link.shortUrl;
  $('result-link').textContent = plain(link.shortUrl);
  $('result-dest').textContent = `→ ${link.url}`;
  $('result').hidden = false;
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('result-link').href);
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Select and copy';
  }
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1800);
});

// the list, with fresh click counts

async function renderLinks() {
  const list = saved();
  $('links-section').hidden = !list.length;
  if (!list.length) return;

  const rows = list.map((link) => {
    const clicks = el('td', { class: 'num' }, '…');
    const row = el('tr', { tabindex: '0', 'data-code': link.code },
      el('td', { class: 'code' }, `${host}/${link.code}`),
      el('td', { class: 'dest-cell', title: link.url }, plain(link.url)),
      clicks,
      el('td', { class: 'when' }, ago(link.createdAt)));
    row.addEventListener('click', () => openStats(link.code));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openStats(link.code); });
    return { row, clicks, link };
  });
  $('links').replaceChildren(...rows.map((r) => r.row));

  // one request per link is fine for a handful; a link deleted on the server leaves the list
  await Promise.all(rows.map(async ({ clicks, link, row }) => {
    try {
      const data = await api(`/api/links/${link.code}?days=1`);
      clicks.textContent = data.clicks.toLocaleString('en-US');
    } catch (err) {
      if (err.status === 404) {
        row.remove();
        save(saved().filter((l) => l.code !== link.code));
      } else {
        clicks.textContent = '–';
      }
    }
  }));
}

// the numbers of one link

async function openStats(code) {
  for (const tr of $('links').children) tr.setAttribute('aria-selected', String(tr.dataset.code === code));
  let data;
  try {
    data = await api(`/api/links/${code}`);
  } catch (err) {
    return;
  }
  const { stats } = data;
  $('stats-title').textContent = `${host}/${data.code}`;
  $('stats-dest').textContent = `→ ${data.url}`;
  $('stats-total').textContent = stats.total.toLocaleString('en-US');
  $('stats-week').textContent = stats.days.slice(-7).reduce((sum, d) => sum + d.clicks, 0).toLocaleString('en-US');
  drawChart(stats.days);
  bars('referrers', stats.referrers, (name) => (name === 'direct' ? 'Direct or app' : name));
  bars('devices', stats.devices, (name) => name[0].toUpperCase() + name.slice(1));
  bars('browsers', stats.browsers, (name) => name);
  $('stats').hidden = false;
  $('stats').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('stats').focus({ preventScroll: true });
}

function drawChart(days) {
  const svg = $('chart');
  const width = 600;
  const height = 120;
  const gap = 3;
  const barWidth = width / days.length - gap;
  const max = Math.max(1, ...days.map((d) => d.clicks));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const ns = 'http://www.w3.org/2000/svg';
  const parts = [];
  const base = document.createElementNS(ns, 'line');
  Object.entries({ x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5 }).forEach(([k, v]) => base.setAttribute(k, v));
  parts.push(base);
  days.forEach((d, i) => {
    // a day with no clicks still gets a sliver, so the 30 days read as a row
    const h = d.clicks ? Math.max(3, (d.clicks / max) * (height - 8)) : 2;
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', i * (barWidth + gap));
    rect.setAttribute('y', height - h);
    rect.setAttribute('width', barWidth);
    rect.setAttribute('height', h);
    rect.setAttribute('class', i === days.length - 1 ? 'today' : d.clicks ? '' : 'zero');
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${d.day}: ${d.clicks} click${d.clicks === 1 ? '' : 's'}`;
    rect.append(title);
    parts.push(rect);
  });
  svg.replaceChildren(...parts);

  const best = days.reduce((a, b) => (b.clicks > a.clicks ? b : a), days[0]);
  $('chart-label').textContent = `Clicks per day for the last 30 days. Busiest day: ${best.day} with ${best.clicks}.`;
  const [y, m, dd] = days[0].day.split('-').map(Number);
  $('axis-start').textContent = new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function bars(id, rows, label) {
  const list = $(id);
  if (!rows.length) {
    list.replaceChildren(el('li', {}, el('span', { class: 'empty' }, 'No clicks yet')));
    return;
  }
  const max = rows[0].clicks;
  list.replaceChildren(...rows.map((r) => {
    const fill = el('span', { class: 'bar-fill' });
    fill.style.width = `${(100 * r.clicks) / max}%`;
    return el('li', {}, el('span', {}, label(r.name)), el('span', { class: 'count' }, String(r.clicks)),
      el('span', { class: 'bar-track' }, fill));
  }));
}

$('stats-close').addEventListener('click', () => {
  $('stats').hidden = true;
  for (const tr of $('links').children) tr.setAttribute('aria-selected', 'false');
});

renderLinks();
