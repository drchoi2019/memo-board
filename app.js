// Memo Board — posts are Markdown files in this repo, written through the GitHub API.
const OWNER = 'drchoi2019';
const REPO = 'memo-board';
const BRANCH = 'main';
const REPO_API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const app = document.getElementById('app');
let index = [];        // [{id, title, tags, excerpt, created, updated}]
let query = '';        // list search text

// ---------- storage ----------
function load(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function store(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }
let token = load('mb_token');

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64enc = s => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }); };
const tagHref = t => '#/tag/' + encodeURIComponent(t);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 1800);
}

// ---------- front matter ----------
function serialize(p) {
  return `---\ntitle: ${JSON.stringify(p.title)}\ntags: ${JSON.stringify(p.tags)}\ncreated: ${p.created}\nupdated: ${p.updated}\n---\n\n${p.body}`;
}
function parse(text) {
  text = text.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?\n?([\s\S]*)$/);
  if (!m) return { title: '', tags: [], body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    try { meta[k] = JSON.parse(v); } catch { meta[k] = v; }
  }
  return { ...meta, title: String(meta.title ?? ''), tags: Array.isArray(meta.tags) ? meta.tags : [], body: m[2] };
}
function excerptOf(body) {
  return body.replace(/[#>*_`~\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// ---------- GitHub ----------
async function api(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { ...opts, headers, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || r.statusText;
    throw new Error(`GitHub ${r.status}: ${msg}`);
  }
  return r.status === 204 ? {} : r.json();
}

// Owner (has token): read through the API so edits show up at once.
// Visitors: read the published Pages files (no API rate limit, ~1 min behind).
async function readFile(path) {
  if (token) {
    const j = await api(`${REPO_API}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`);
    return j ? { text: b64dec(j.content), sha: j.sha } : null;
  }
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Load failed (${r.status})`);
  return { text: await r.text(), sha: null };
}
function writeFile(path, text, sha, message) {
  return api(`${REPO_API}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64enc(text), branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}
function deleteFile(path, sha, message) {
  return api(`${REPO_API}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
}

async function loadIndex() {
  const f = await readFile('posts/index.json');
  index = f ? JSON.parse(f.text) : [];
  return f?.sha || null;
}
async function saveIndex(mutate, message) {
  const sha = await loadIndex();               // re-read so we never overwrite a newer index
  mutate(index);
  index.sort((a, b) => b.id - a.id);
  await writeFile('posts/index.json', JSON.stringify(index, null, 2) + '\n', sha, message);
}

function allTags() {
  const count = {};
  for (const p of index) for (const t of p.tags) count[t] = (count[t] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
}

// ---------- views ----------
function renderList(tag) {
  const tags = allTags();
  app.innerHTML = `
    <input id="search" type="search" placeholder="Search title, tags, text" value="${esc(query)}">
    <div class="tagbar row">
      <a class="chip ${tag ? '' : 'on'}" href="#/">All <span class="muted">${index.length}</span></a>
      ${tags.map(t => `<a class="chip ${t.name === tag ? 'on' : ''}" href="${tagHref(t.name)}">${esc(t.name)} <span>${t.n}</span></a>`).join('')}
    </div>
    <div id="results"></div>`;
  const s = document.getElementById('search');
  s.addEventListener('input', () => { query = s.value; drawResults(tag); });
  drawResults(tag);
}

function drawResults(tag) {
  const q = query.toLowerCase();
  const items = index.filter(p =>
    (!tag || p.tags.includes(tag)) &&
    (!q || (p.title + ' ' + p.tags.join(' ') + ' ' + p.excerpt).toLowerCase().includes(q)));
  document.getElementById('results').innerHTML =
    items.length ? `<ul class="list">${items.map(p => `
      <li>
        <a class="title" href="#/${p.id}">${esc(p.title || 'Untitled')}</a>
        <div class="meta row"><span class="muted">${fmtDate(p.created)}</span>${p.tags.map(t => `<a class="chip" href="${tagHref(t)}">${esc(t)}</a>`).join('')}</div>
        ${p.excerpt ? `<div class="excerpt">${esc(p.excerpt)}</div>` : ''}
      </li>`).join('')}</ul>`
      : `<p class="muted">${index.length ? 'No matching posts.' : 'No posts yet.'}</p>`;
}

async function renderView(id) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const f = await readFile(`posts/${id}.md`);
  if (!f) { app.innerHTML = '<p class="muted">This post does not exist.</p>'; return; }
  const p = parse(f.text);
  document.title = `${p.title || 'Untitled'} · Memo Board`;
  app.innerHTML = `
    <article class="post">
      <h1 class="ptitle">${esc(p.title || 'Untitled')}</h1>
      <div class="meta row">
        <span class="muted">${fmtDate(p.created)}${p.updated && p.updated !== p.created ? ` · edited ${fmtDate(p.updated)}` : ''}</span>
        ${p.tags.map(t => `<a class="chip" href="${tagHref(t)}">${esc(t)}</a>`).join('')}
      </div>
      <div class="body">${DOMPurify.sanitize(marked.parse(p.body))}</div>
      <div class="actions row spread">
        <button class="btn ghost" id="copy">Copy link</button>
        <span class="row" ${token ? '' : 'hidden'}>
          <a class="btn ghost" href="#/${id}/edit">Edit</a>
          <button class="btn danger" id="del">Delete</button>
        </span>
      </div>
    </article>`;
  document.getElementById('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
    catch { prompt('Copy this link:', location.href); }
  };
  document.getElementById('del').onclick = async e => {
    if (!confirm('Delete this post? It stays in the repository history.')) return;
    e.target.disabled = true;
    try {
      await deleteFile(`posts/${id}.md`, f.sha, `Delete post ${id}`);
      await saveIndex(ix => { const i = ix.findIndex(x => x.id === id); if (i >= 0) ix.splice(i, 1); }, `Index: remove ${id}`);
      toast('Deleted');
      location.hash = '#/';
    } catch (err) { e.target.disabled = false; alert(err.message); }
  };
}

async function renderEdit(id) {
  if (!token) { toast('Add your token first'); location.hash = '#/settings'; return; }
  app.innerHTML = '<p class="muted">Loading…</p>';
  let p = { title: '', tags: [], body: '' }, sha = null;
  if (id != null) {
    const f = await readFile(`posts/${id}.md`);
    if (!f) { app.innerHTML = '<p class="muted">This post does not exist.</p>'; return; }
    p = parse(f.text); sha = f.sha;
  }
  document.title = (id == null ? 'New post' : 'Edit') + ' · Memo Board';
  app.innerHTML = `
    <div class="field"><input id="title" type="text" placeholder="Title" value="${esc(p.title)}"></div>
    <div class="field tagwrap">
      <div class="tagbox" id="tagbox"><input id="tagIn" type="text" placeholder="Add tag" autocomplete="off"></div>
      <div class="suggest" id="suggest" hidden></div>
    </div>
    <div class="field"><textarea id="body" placeholder="Write in Markdown">${esc(p.body)}</textarea></div>
    <div class="row spread">
      <a class="btn ghost" href="${id == null ? '#/' : '#/' + id}">Cancel</a>
      <button class="btn" id="save">Save</button>
    </div>
    <p id="err" class="error"></p>`;
  const tags = tagInput(p.tags);
  if (id == null) document.getElementById('title').focus();

  document.getElementById('save').onclick = async e => {
    const btn = e.target, err = document.getElementById('err');
    const title = document.getElementById('title').value.trim();
    const body = document.getElementById('body').value;
    if (!title && !body.trim()) { err.textContent = 'Write something first.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
    try {
      const now = new Date().toISOString();
      let postId = id;
      if (postId == null) { await loadIndex(); postId = index.reduce((m, x) => Math.max(m, x.id), 0) + 1; }
      const post = { title, tags: tags.get(), body, created: p.created || now, updated: now };
      await writeFile(`posts/${postId}.md`, serialize(post), sha, `${id == null ? 'Add' : 'Edit'} post ${postId}: ${title}`);
      const entry = { id: postId, title, tags: post.tags, excerpt: excerptOf(body), created: post.created, updated: now };
      await saveIndex(ix => { const i = ix.findIndex(x => x.id === postId); i >= 0 ? (ix[i] = entry) : ix.push(entry); }, `Index: ${postId}`);
      toast('Saved');
      location.hash = '#/' + postId;
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Save'; err.textContent = ex.message;
    }
  };
}

// Tag field: shows tags already used in a popup; pick one or type a new one.
function tagInput(initial) {
  const box = document.getElementById('tagbox'), input = document.getElementById('tagIn'), pop = document.getElementById('suggest');
  let selected = [...initial], options = [], active = -1;

  function drawChips() {
    box.querySelectorAll('.chip').forEach(c => c.remove());
    selected.forEach((t, i) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = `${esc(t)}<button type="button" aria-label="Remove">×</button>`;
      c.querySelector('button').onclick = () => { selected.splice(i, 1); drawChips(); drawPop(); };
      box.insertBefore(c, input);
    });
  }
  function drawPop() {
    const q = input.value.trim(), ql = q.toLowerCase();
    const known = allTags().filter(t => !selected.includes(t.name) && t.name.toLowerCase().includes(ql));
    options = known.map(t => ({ name: t.name, label: `${esc(t.name)}<span class="count">${t.n}</span>` }));
    if (q && !selected.includes(q) && !known.some(t => t.name === q)) options.push({ name: q, label: `Create “${esc(q)}”` });
    if (active >= options.length) active = options.length - 1;
    if (q && active < 0 && options.length) active = 0;
    pop.innerHTML = options.map((o, i) => `<div data-i="${i}" class="${i === active ? 'active' : ''}">${o.label}</div>`).join('');
    pop.hidden = !options.length || document.activeElement !== input;
  }
  function add(name) {
    name = name.trim().replace(/,/g, '');
    if (name && !selected.includes(name)) selected.push(name);
    input.value = ''; active = -1; drawChips(); drawPop();
  }

  input.addEventListener('focus', drawPop);
  input.addEventListener('blur', () => (pop.hidden = true));
  input.addEventListener('input', () => { active = -1; drawPop(); });
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, options.length - 1); drawPop(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); drawPop(); }
    else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (active >= 0 && options[active]) add(options[active].name); else if (input.value.trim()) add(input.value);
    }
    else if (e.key === 'Escape') pop.hidden = true;
    else if (e.key === 'Backspace' && !input.value && selected.length) { selected.pop(); drawChips(); drawPop(); }
  });
  pop.addEventListener('mousedown', e => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    e.preventDefault();
    add(options[+d.dataset.i].name);
  });
  box.addEventListener('click', e => { if (e.target === box) input.focus(); });

  drawChips();
  return { get: () => { if (input.value.trim()) add(input.value); return [...selected]; } };
}

function renderSettings() {
  document.title = 'Settings · Memo Board';
  app.innerHTML = `
    <h2>Settings</h2>
    <p>To write, edit and delete posts, paste a GitHub fine-grained token that can write <b>${OWNER}/${REPO}</b> only.
      It is kept in this browser only.</p>
    <ol class="muted">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">New fine-grained token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → ${REPO}.</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b>.</li>
      <li>Generate, then paste it below.</li>
    </ol>
    <div class="field"><input id="tok" type="password" placeholder="github_pat_…" value="${esc(token)}" autocomplete="off"></div>
    <div class="row">
      <button class="btn" id="saveTok">Save</button>
      <button class="btn ghost" id="clearTok">Remove</button>
    </div>
    <p id="tokMsg" class="muted"></p>`;
  const msg = document.getElementById('tokMsg');
  document.getElementById('saveTok').onclick = async () => {
    const v = document.getElementById('tok').value.trim();
    if (!v) return;
    const prev = token; token = v;
    msg.className = 'muted'; msg.textContent = 'Checking…';
    try {
      const repo = await api(REPO_API);
      if (!repo?.permissions?.push) throw new Error('This token cannot write to the repository.');
      store('mb_token', v); updateNav(); await loadIndex();
      msg.textContent = 'Saved. You can write posts now.';
    } catch (e) { token = prev; msg.className = 'error'; msg.textContent = e.message; }
  };
  document.getElementById('clearTok').onclick = async () => {
    token = ''; store('mb_token', ''); updateNav();
    document.getElementById('tok').value = '';
    msg.className = 'muted'; msg.textContent = 'Removed from this browser.';
    await loadIndex();
  };
}

function updateNav() { document.getElementById('newBtn').hidden = !token; }

// ---------- router ----------
async function route() {
  window.scrollTo(0, 0);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (!parts.length) { document.title = 'Memo Board'; return renderList(); }
    if (parts[0] === 'tag') { const t = parts.slice(1).join('/'); document.title = `#${t} · Memo Board`; return renderList(t); }
    if (parts[0] === 'new') return await renderEdit(null);
    if (parts[0] === 'settings') return renderSettings();
    const id = Number(parts[0]);
    if (!Number.isInteger(id)) { location.hash = '#/'; return; }
    return parts[1] === 'edit' ? await renderEdit(id) : await renderView(id);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

window.addEventListener('hashchange', route);
(async () => {
  updateNav();
  try { await loadIndex(); } catch (e) { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  route();
})();
