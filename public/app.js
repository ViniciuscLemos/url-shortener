// the page: make a link, list the ones made in this browser, open the numbers of one

const $ = (id) => document.getElementById(id);
const STORE = 'trail.links';
const host = location.host;

function saved() {
  try {
    // links made before the rename were kept under the old name
    const old = localStorage.getItem('curto.links');
    if (old && !localStorage.getItem(STORE)) {
      localStorage.setItem(STORE, old);
      localStorage.removeItem('curto.links');
    }
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
      body: JSON.stringify({ url: $('url').value, alias: $('alias').value, expiresAt: $('ends').value || undefined }),
    });
    // the owner token comes only in this answer: it's what lets this browser change the link later
    save([{ code: link.code, url: link.url, createdAt: link.createdAt, token: link.ownerToken },
      ...saved().filter((l) => l.code !== link.code)]);
    showResult(link);
    $('url').value = '';
    $('alias').value = '';
    $('ends').value = '';
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
  setQr($('result-qr'), link.code);
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
  // the public demo shows its example links to someone who hasn't made any yet
  if (!list.length && examples.length) {
    list.push(...examples.map((code) => ({ code, url: '', createdAt: null, example: true })));
  }
  $('links-section').hidden = !list.length;
  if (!list.length) return;

  const rows = list.map((link) => {
    const clicks = el('td', { class: 'num' }, '…');
    const row = el('tr', { tabindex: '0', 'data-code': link.code },
      el('td', { class: 'code' }, `${host}/${link.code}`),
      el('td', { class: 'dest-cell', title: link.url }, plain(link.url)),
      clicks,
      el('td', { class: 'when' }, link.example ? 'example' : ago(link.createdAt)));
    row.addEventListener('click', () => openStats(link.code));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openStats(link.code); });
    return { row, clicks, link };
  });
  $('links').replaceChildren(...rows.map((r) => r.row));

  // the whole list in one request; a link that's gone from the server comes back missing
  let found;
  try {
    found = await api(`/api/links?codes=${rows.map((r) => r.link.code).join(',')}`);
  } catch {
    for (const r of rows) r.clicks.textContent = '–';
    return;
  }
  const byCode = new Map(found.map((l) => [l.code, l]));
  for (const { clicks, link, row } of rows) {
    const data = byCode.get(link.code);
    if (!data) {
      row.remove();
      save(saved().filter((l) => l.code !== link.code));
      continue;
    }
    clicks.replaceChildren(week(data.week), el('span', {}, data.clicks.toLocaleString('en-US')));
    row.children[1].textContent = plain(data.url);
    if (data.disabled) row.children[3].textContent = 'turned off';
    else if (data.expired) row.children[3].textContent = 'ended';
    row.classList.toggle('is-off', data.disabled || data.expired);
  }
}

// seven thin bars, one per day up to today: enough to see if a link is still being used
function week(days) {
  const top = Math.max(...days, 1);
  const total = days.reduce((a, b) => a + b, 0);
  const box = el('span', { class: 'week', title: `${total} in the last 7 days`, 'aria-label': `${total} clicks in the last 7 days` });
  for (const n of days) {
    const bar = el('i', {});
    bar.style.height = `${n ? Math.max(2, Math.round((n / top) * 14)) : 1}px`;
    if (!n) bar.className = 'none';
    box.append(bar);
  }
  return box;
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
  showOwner(data);
  setQr($('stats-qr'), data.code);
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

// the same image works to look at and to download (a file named after the link)
function setQr(link, code) {
  const src = `/api/links/${encodeURIComponent(code)}/qr.svg`;
  link.href = src;
  link.download = `trail-${code}.svg`;
  link.querySelector('img').src = src;
  link.querySelector('img').alt = `QR code for ${host}/${code}`;
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

// changing a link: only shown in the browser that made it, the one holding its token

let current = null;

function tokenOf(code) {
  return saved().find((l) => l.code === code)?.token;
}

function showOwner(data) {
  current = data;
  $('stats-off').hidden = !data.disabled;
  $('owner').hidden = !tokenOf(data.code);
  $('owner-error').hidden = true;
  $('delete-sure').hidden = true;
  $('owner-ends').value = data.expiresAt ? localDay(data.expiresAt) : '';
  $('ends-clear').hidden = !data.expiresAt;
  const ends = $('stats-ends');
  ends.hidden = !data.expiresAt || data.disabled;
  if (data.expiresAt) {
    const when = new Date(data.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    ends.textContent = data.expired
      ? `Ended on ${when}: people who open it see a "this link has ended" page.`
      : `Works until the end of ${when}, then it stops on its own.`;
  }
  $('new-url').value = data.url;
  $('toggle-off').textContent = data.disabled ? 'Turn it back on' : 'Turn off';
}

async function change(body) {
  const error = $('owner-error');
  error.hidden = true;
  try {
    const data = await api(`/api/links/${current.code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOf(current.code)}` },
      body: JSON.stringify(body),
    });
    save(saved().map((l) => (l.code === data.code ? { ...l, url: data.url } : l)));
    $('stats-off').hidden = !data.disabled;
    $('stats-dest').textContent = `→ ${data.url}`;
    showOwner({ ...current, ...data });
    renderLinks();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

$('redirect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if ($('new-url').value.trim() && $('new-url').value.trim() !== current.url) change({ url: $('new-url').value });
});

// the day in São Paulo, which is how the end date was picked
function localDay(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

$('owner-ends').addEventListener('change', () => change({ expiresAt: $('owner-ends').value || null }));
$('ends-clear').addEventListener('click', (e) => { e.preventDefault(); change({ expiresAt: null }); });

$('toggle-off').addEventListener('click', () => change({ disabled: !current.disabled }));

// deleting asks once, in place, with the number of clicks that go with it
$('delete-link').addEventListener('click', () => {
  const n = current.clicks ?? current.stats?.total ?? 0;
  $('delete-question').textContent = n
    ? `This also deletes its ${n.toLocaleString('en-US')} click${n === 1 ? '' : 's'}, and anyone who opens ${host}/${current.code} gets "not found".`
    : `Anyone who opens ${host}/${current.code} will get "not found".`;
  $('delete-sure').hidden = false;
  $('delete-yes').focus();
});
$('delete-no').addEventListener('click', () => { $('delete-sure').hidden = true; });
$('delete-yes').addEventListener('click', async () => {
  const error = $('owner-error');
  error.hidden = true;
  try {
    await api(`/api/links/${current.code}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${tokenOf(current.code)}` },
    });
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    return;
  }
  save(saved().filter((l) => l.code !== current.code));
  $('stats').hidden = true;
  renderLinks();
});

$('stats-close').addEventListener('click', () => {
  $('stats').hidden = true;
  for (const tr of $('links').children) tr.setAttribute('aria-selected', 'false');
});

for (const id of ['ends', 'owner-ends']) $(id).min = localDay(new Date().toISOString());

let examples = [];
api('/api/config').then((config) => { examples = config.examples; }).catch(() => {}).finally(renderLinks);
