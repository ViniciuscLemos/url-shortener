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

// Campaign tags go on the long link before it's shortened, so Google Analytics on the other
// side knows the visit came from, say, the Instagram bio. Tags already in the link are
// replaced, the rest of it is left as it is; empty fields add nothing.
function withUtm(raw) {
  const tags = [['utm_source', 'utm-source'], ['utm_medium', 'utm-medium'], ['utm_campaign', 'utm-campaign']]
    .map(([name, id]) => [name, $(id).value.trim().toLowerCase().replace(/\s+/g, '-')])
    .filter(([, value]) => value);
  if (!tags.length || !raw.trim()) return raw;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return raw; // the server says what's wrong with it
  }
  for (const [name, value] of tags) url.searchParams.set(name, value);
  return url.toString();
}

for (const id of ['url', 'utm-source', 'utm-medium', 'utm-campaign']) {
  $(id).addEventListener('input', () => {
    const tagged = withUtm($('url').value);
    $('utm-preview').textContent = tagged !== $('url').value ? `It will point to ${tagged}` : '';
  });
}

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
      body: JSON.stringify({ url: withUtm($('url').value), alias: $('alias').value, expiresAt: $('ends').value || undefined, password: $('pass').value || undefined }),
    });
    // the owner token comes only in this answer: it's what lets this browser change the link later
    save([{ code: link.code, url: link.url, createdAt: link.createdAt, token: link.ownerToken },
      ...saved().filter((l) => l.code !== link.code)]);
    showResult(link);
    $('url').value = '';
    $('alias').value = '';
    $('ends').value = '';
    $('pass').value = '';
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
    // a link behind a password doesn't say where it goes in this list; the address kept here does
    row.children[1].textContent = plain(data.url ?? link.url);
    if (data.disabled) row.children[3].textContent = 'turned off';
    else if (data.expired) row.children[3].textContent = 'ended';
    row.classList.toggle('is-off', data.disabled || data.expired);
  }
}

// seven thin bars, one per day up to today: enough to see if a link is still being used
function week(days) {
  const top = Math.max(...days, 1);
  const total = days.reduce((a, b) => a + b, 0);
  const box = el('span', { class: 'week', role: 'img', title: `${total} in the last 7 days`, 'aria-label': `${total} clicks in the last 7 days` });
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
    // with the token, a link behind a password still shows its owner where it goes
    const token = tokenOf(code);
    data = await api(`/api/links/${code}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  } catch (err) {
    return;
  }
  const { stats } = data;
  $('stats-title').textContent = `${host}/${data.code}`;
  $('stats-dest').textContent = data.url ? `→ ${data.url}` : '→ behind a password';
  showOwner(data);
  setQr($('stats-qr'), data.code, qrColorPicked());
  $('stats-total').textContent = stats.total.toLocaleString('en-US');
  $('stats-week').textContent = stats.days.slice(-7).reduce((sum, d) => sum + d.clicks, 0).toLocaleString('en-US');
  drawChart(stats.days);
  drawHours(stats.hours);
  bars('referrers', stats.referrers, (name) => (name === 'direct' ? 'Direct or app' : name));
  bars('devices', stats.devices, (name) => name[0].toUpperCase() + name.slice(1));
  bars('browsers', stats.browsers, (name) => name);
  $('stats').hidden = false;
  $('stats').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('stats').focus({ preventScroll: true });
}

// the same image works to look at and to download (a file named after the link)
function setQr(link, code, color = '161513') {
  const base = `/api/links/${encodeURIComponent(code)}/qr`;
  const tint = color === '161513' ? '' : `?color=${color}`;
  link.href = `${base}.svg${tint}`;
  link.download = `trail-${code}.svg`;
  link.querySelector('img').src = `${base}.svg${tint}`;
  link.querySelector('img').alt = `QR code for ${host}/${code}`;
  if (link.id === 'stats-qr') {
    $('qr-png').href = `${base}.png${tint ? `${tint}&` : '?'}size=1200`;
    $('qr-png').download = `trail-${code}.png`;
  }
}

// the color of the QR in the stats: picked once, kept for the next links in this browser
function qrColorPicked() {
  try { return localStorage.getItem('trail.qrColor') || '161513'; } catch { return '161513'; }
}
document.querySelectorAll('input[name=qr-color]').forEach((radio) => {
  radio.checked = radio.value === qrColorPicked();
  radio.addEventListener('change', () => {
    try { localStorage.setItem('trail.qrColor', radio.value); } catch { /* fine, just not kept */ }
    if (current) setQr($('stats-qr'), current.code, radio.value);
  });
});

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

// The 24 hours side by side, and the three in a row that got the most clicks: that's when
// the people who click it are around, so it's when to post it again.
function drawHours(hours) {
  const max = Math.max(1, ...hours);
  $('hours').replaceChildren(...hours.map((n, h) => {
    const li = el('li', { title: `${h}h: ${n} click${n === 1 ? '' : 's'}` },
      el('span', { class: 'sr-only' }, `${h}h, ${n} click${n === 1 ? '' : 's'}`));
    li.style.setProperty('--h', `${n ? Math.max(6, (100 * n) / max) : 3}%`);
    if (!n) li.className = 'zero';
    return li;
  }));
  const total = hours.reduce((s, n) => s + n, 0);
  let best = 0;
  for (let h = 1; h < 24; h++) {
    const sum = (start) => hours[start] + hours[(start + 1) % 24] + hours[(start + 2) % 24];
    if (sum(h) > sum(best)) best = h;
  }
  const window3 = hours[best] + hours[(best + 1) % 24] + hours[(best + 2) % 24];
  $('hours-note').textContent = total < 5
    ? '· a few more clicks and it shows the busy hours'
    : `· ${Math.round((100 * window3) / total)}% of the clicks come between ${best}h and ${(best + 3) % 24}h`;
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
    // an end still to come is just information; one that passed is a warning, like turned off
    ends.className = data.expired ? 'off-note' : 'off-note is-info';
    ends.textContent = data.expired
      ? `Ended on ${when}: people who open it see a "this link has ended" page.`
      : `Works until the end of ${when}, then it stops on its own.`;
  }
  $('new-url').value = data.url ?? '';
  $('stats-locked').hidden = !data.locked;
  $('owner-pass').value = '';
  $('owner-pass').placeholder = data.locked ? 'a new one' : '';
  $('pass-save').textContent = data.locked ? 'change' : 'set';
  $('pass-clear').hidden = !data.locked;
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

$('pass-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if ($('owner-pass').value) change({ password: $('owner-pass').value });
});
$('pass-clear').addEventListener('click', () => change({ password: null }));

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

// the token goes in a header, so the file is fetched here and handed to the browser as a download
$('download-csv').addEventListener('click', async () => {
  const error = $('owner-error');
  error.hidden = true;
  try {
    const res = await fetch(`/api/links/${current.code}/clicks.csv`, { headers: { Authorization: `Bearer ${tokenOf(current.code)}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not get the file.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await res.blob());
    link.download = `${current.code}-clicks.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

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

// many links at once: a list pasted or a CSV opened, each line made or refused on its own
let bulkMade = [];

$('bulk-file').addEventListener('change', async () => {
  const file = $('bulk-file').files[0];
  if (!file) return;
  $('bulk-text').value = (await file.text()).trim();
  $('bulk-file').value = '';
  $('bulk-text').focus();
});

$('bulk-go').addEventListener('click', async () => {
  const error = $('bulk-error');
  const button = $('bulk-go');
  error.hidden = true;
  button.disabled = true;
  try {
    const { made, links } = await api('/api/links/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('bulk-text').value }),
    });
    bulkMade = links.filter((l) => l.ok);
    // newest on top of "your links", with their tokens, the same as one made by hand
    const fresh = bulkMade.map((l) => ({ code: l.code, url: l.url, createdAt: l.createdAt, token: l.ownerToken }));
    save([...fresh.reverse(), ...saved().filter((l) => !fresh.some((f) => f.code === l.code))]);
    const refused = links.length - made;
    $('bulk-summary').textContent = `${made} made${refused ? `, ${refused} not (see why below)` : ''}.`;
    $('bulk-list').replaceChildren(...links.map((l) => el('li', { class: l.ok ? '' : 'is-refused' },
      el('span', { class: 'bulk-line' }, `line ${l.line}`),
      l.ok ? el('a', { class: 'code', href: l.shortUrl, target: '_blank', rel: 'noopener' }, plain(l.shortUrl)) : el('span', { class: 'bulk-input' }, l.input),
      el('span', { class: 'bulk-note' }, l.ok ? `→ ${l.url}` : l.error))));
    $('bulk-csv').hidden = !made;
    $('bulk-result').hidden = false;
    // what worked leaves the box; what didn't stays, to fix and send again
    const lines = $('bulk-text').value.split(/\r?\n/);
    const failed = new Set(links.filter((l) => !l.ok).map((l) => l.line));
    $('bulk-text').value = lines.filter((_, i) => failed.has(i + 1)).join('\n');
    renderLinks();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('bulk-csv').addEventListener('click', () => {
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = ['short link,goes to', ...bulkMade.map((l) => [l.shortUrl, l.url].map(cell).join(','))].join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'short-links.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
