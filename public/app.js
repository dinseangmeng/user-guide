const $ = (id) => document.getElementById(id);

const S = {
  config: {},
  projects: [],
  project: null,
  userId: '',
  guide: null,
  guideJson: '',
  jobs: [],
  jobsJson: '',
  wasActive: false,
  seenInit: false,
  filter: 'all',
  lang: 'en',
  draftAfter: true,
  exploreAfter: true,
  modal: null,
  view: 'review',
  doc: null,
  saveTimer: null,
  nodeDrag: null,
  nodeSpec: null,
  genWasActive: false,
  dragging: null,
};

const seen = new Set();

const JOB_LABEL = {
  discover: 'Discovering pages',
  'draft-all': 'Drafting with AI',
  render: 'Rendering approved pages',
  capture: 'Re-shooting a page',
  explore: 'Exploring clicks',
  restart: 'Starting over',
  'add-page': 'Capturing a new page',
  generate: 'Building documents',
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paramNames(route) {
  const names = [];
  const re = /:([A-Za-z0-9_]+)(?:\([^)]*\))?\??/g;
  let m;
  while ((m = re.exec(route || ''))) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

const base = () => '/api/projects/' + S.project.id + '/users/' + S.userId;

function counts() {
  const c = { all: 0, new: 0, draft: 0, approved: 0, rejected: 0 };
  (S.guide ? S.guide.features : []).forEach((f) => {
    c.all++;
    c[f.status] = (c[f.status] || 0) + 1;
  });
  return c;
}

const isActive = (j) => j.status === 'queued' || j.status === 'running';
const hasActive = (type) => S.jobs.some((j) => j.type === type && isActive(j));

function rawUrl(f) {
  return '/files/' + S.project.id + '/' + S.userId + '/raw/' + f.id + '.png?v=' + f.capturedAt;
}

function boxStyle(f, r) {
  const vp = f.viewport || S.guide.viewport;
  const pct = (n, d) => ((n / d) * 100).toFixed(3) + '%';
  return 'left:' + pct(r.x, vp.width) + ';top:' + pct(r.y, vp.height) + ';width:' + pct(r.w, vp.width) + ';height:' + pct(r.h, vp.height);
}

function renderSide() {
  const c = S.config;
  let label = 'AI drafting is off';
  if (c.ready) label = 'AI drafting on · ' + c.model;
  else if (!c.allowCloudAi) label = 'AI drafting off: ALLOW_CLOUD_AI is not true';
  else if (!c.hasKey) label = 'AI drafting off: OPENROUTER_API_KEY is missing';
  const items = S.projects
    .map(
      (p) =>
        '<li class="' + (S.project && S.project.id === p.id ? 'active' : '') + '" data-act="select-project" data-id="' + esc(p.id) + '"><span>' +
        esc(p.name) + '</span><small>' + p.userCount + ' user' + (p.userCount === 1 ? '' : 's') + '</small></li>'
    )
    .join('');
  $('side').innerHTML =
    '<div class="brand">Guide Studio</div><button class="btn primary block" data-act="new-project">New project</button><ul class="plist">' +
    items + '</ul><div class="ai ' + (c.ready ? 'ok' : 'off') + '">' + esc(label) + '</div>';
}

function renderHead() {
  if (!S.project) {
    $('head').innerHTML =
      '<div class="empty"><h2>Welcome to Guide Studio</h2><p>Create a project for each web app, add the users you want guides for, then discover and review their pages.</p><button class="btn primary" data-act="new-project">Create your first project</button></div>';
    return;
  }
  const p = S.project;
  const tabs = p.users
    .map((u) => '<button class="tab ' + (u.id === S.userId ? 'active' : '') + '" data-act="select-user" data-id="' + esc(u.id) + '">' + esc(u.name) + '</button>')
    .join('');
  $('head').innerHTML =
    '<div class="phead"><div><h1>' + esc(p.name) + '</h1><div class="muted">' + esc(p.appUrl) +
    '</div></div><div class="trow"><button class="btn" data-act="edit-vars">Shared variables</button><button class="btn" data-act="edit-project">Project settings</button></div></div><div class="tabs">' +
    tabs + '<button class="tab add" data-act="add-user">+ Add user</button></div>';
}

function viewTabs() {
  const c = counts();
  return (
    '<div class="seg"><button class="' + (S.view === 'review' ? 'on' : '') + '" data-act="view" data-v="review">Review</button>' +
    '<button class="' + (S.view === 'doc' ? 'on' : '') + '" data-act="view" data-v="doc">Document <small>' + c.approved + ' approved</small></button></div>'
  );
}

function renderToolbar() {
  const el = $('toolbar');
  if (!S.project || !S.userId || !S.guide) {
    el.innerHTML = '';
    return;
  }
  const c = counts();
  if (S.view === 'doc') {
    const l = [['en', 'EN'], ['km', 'KM']]
      .map(([v, t]) => '<button class="' + (S.lang === v ? 'on' : '') + '" data-act="lang" data-v="' + v + '">' + t + '</button>')
      .join('');
    el.innerHTML = '<div class="toolbar"><div class="trow">' + viewTabs() + '<div class="seg">' + l + '</div></div></div>';
    return;
  }
  const aiOff = S.config.ready ? '' : ' disabled title="Turn on AI drafting in .env"';
  const filters = [['all', 'All'], ['new', 'New'], ['draft', 'Draft'], ['approved', 'Approved'], ['rejected', 'Rejected']]
    .map(([v, l]) => '<button class="' + (S.filter === v ? 'on' : '') + '" data-act="filter" data-v="' + v + '">' + l + ' <small>' + (c[v] || 0) + '</small></button>')
    .join('');
  const langs = [['en', 'EN'], ['km', 'KM']]
    .map(([v, l]) => '<button class="' + (S.lang === v ? 'on' : '') + '" data-act="lang" data-v="' + v + '">' + l + '</button>')
    .join('');
  el.innerHTML =
    '<div class="toolbar"><div class="trow">' + viewTabs() + '<span class="vsep"></span>' +
    '<button class="btn primary" data-act="discover"' + (hasActive('discover') ? ' disabled' : '') + '>Discover pages</button>' +
    '<label class="chk"><input type="checkbox" id="draft-after" ' + (S.draftAfter ? 'checked' : '') + '> Draft with AI</label>' +
    '<label class="chk"><input type="checkbox" id="explore-after" ' + (S.exploreAfter ? 'checked' : '') + '> Explore clicks</label>' +
    '<button class="btn" data-act="draft-new"' + aiOff + '>Draft new</button>' +
    '<button class="btn" data-act="draft-all"' + aiOff + '>Redraft unapproved</button>' +
    '<button class="btn" data-act="add-page">+ Add page</button>' +
    '<button class="btn bad" data-act="restart">Start over</button>' +
    '<button class="btn" data-act="edit-user">User settings</button></div>' +
    '<div class="trow"><div class="seg">' + filters + '</div><div class="seg">' + langs + '</div><span class="grow"></span>' +
    '<button class="btn" data-act="approve-all">Approve all drafts</button>' +
    '<button class="btn primary" data-act="view" data-v="doc"' + (c.approved ? '' : ' disabled') + '>Next: build the document</button>' +
    '</div></div>';
}

function renderJobbar() {
  const act = S.jobs.filter(isActive);
  const failed = S.jobs.find((j) => j.status === 'failed' && Date.now() - j.finishedAt < 60000);
  let html = '';
  if (act.length) {
    const j = act.find((x) => x.status === 'running') || act[0];
    const last = j.logs[j.logs.length - 1] || 'Starting…';
    html =
      '<div class="jobline"><span class="spin"></span><span class="txt"><b>' + esc(JOB_LABEL[j.type] || j.type) + '</b> · ' + esc(last) +
      (act.length > 1 ? ' (+' + (act.length - 1) + ' queued)' : '') + '</span><button class="btn sm" data-act="show-log">Log</button></div>';
  } else if (failed) {
    html =
      '<div class="jobline fail"><span class="txt"><b>' + esc(JOB_LABEL[failed.type] || failed.type) + ' failed:</b> ' + esc(failed.error) +
      '</span><button class="btn sm" data-act="show-log">Log</button></div>';
  }
  $('jobbar').innerHTML = html;
}

function statusLabel(f) {
  if (!f.capturedAt && f.missingParams.length) return 'Needs values';
  return { new: 'New', draft: 'Draft', approved: 'Approved', rejected: 'Rejected' }[f.status] || f.status;
}

function cardHtml(f) {
  const title = f.name[S.lang] || f.name.en || f.route;
  let shot;
  if (f.capturedAt) {
    const boxes = f.rects
      .map((r, i) => (r ? '<span class="box" style="' + boxStyle(f, r) + '"><b>' + (i + 1) + '</b></span>' : ''))
      .join('');
    shot = '<img src="' + rawUrl(f) + '" alt="" draggable="false">' + boxes;
  } else {
    shot = '<div class="noshot">' + esc(f.error || 'Not captured yet') + '</div>';
  }
  const busy = f.busy ? '<div class="busy"><span class="spin"></span> Working…</div>' : '';
  const items = f.items.length
    ? '<ol class="items">' +
      f.items
        .map((it, i) => {
          const lost = !f.rects[i];
          return (
            '<li class="' + (it.needsReview || lost ? 'warn' : '') + '"><b>' + esc(it.title[S.lang] || it.title.en) + '</b><span>' +
            esc(it.description[S.lang] || it.description.en) + '</span>' +
            (lost ? '<em>Element not found on the latest screenshot</em>' : '') + '</li>'
          );
        })
        .join('') + '</ol>'
    : '<div class="items muted" style="padding-left:12px">No callouts yet.</div>';
  const notes =
    (f.capturedAt && f.error ? '<div class="note bad">' + esc(f.error) + '</div>' : '') +
    (f.trigger ? '<div class="note info">State after clicking “' + esc(f.trigger.label) + '”</div>' : '') +
    (f.review && f.review.notes ? '<div class="note info">Supervisor (' + esc(f.review.verdict) + '): ' + esc(f.review.notes) + '</div>' : '') +
    (f.missingParams.length ? '<div class="note">Needs a sample value for: ' + esc(f.missingParams.join(', ')) + '. Click Edit to set it.</div>' : '');
  const handle = S.filter === 'all' ? '<span class="drag" title="Drag to reorder">⠿</span>' : '';
  const off = f.busy ? ' disabled' : '';
  const approve = '<button class="btn ok" data-act="approve" data-id="' + esc(f.id) + '"' + (f.busy || !f.capturedAt || f.status === 'approved' ? ' disabled' : '') + '>Approve</button>';
  const reject =
    f.status === 'rejected'
      ? '<button class="btn" data-act="restore" data-id="' + esc(f.id) + '"' + off + '>Restore</button>'
      : '<button class="btn bad" data-act="reject" data-id="' + esc(f.id) + '"' + off + '>Reject</button>';
  return (
    '<article class="card s-' + f.status + '" data-id="' + esc(f.id) + '"><header class="chead">' + handle +
    '<div class="ctitle"><strong>' + esc(title) + '</strong><code>' + esc(f.resolved) + '</code></div><span class="pill ' + f.status + '">' +
    esc(statusLabel(f)) + '</span></header><div class="shot" data-act="edit" data-id="' + esc(f.id) + '">' + shot + busy + '</div>' +
    notes + items + '<footer class="cfoot">' + approve + reject +
    '<button class="btn" data-act="edit" data-id="' + esc(f.id) + '">Edit</button>' +
    '<button class="btn" data-act="reshoot" data-id="' + esc(f.id) + '"' + off + '>Re-shoot</button>' +
    (f.parentId ? '' : '<button class="btn" data-act="explore" data-id="' + esc(f.id) + '"' + (f.busy || !f.capturedAt || !S.config.ready ? ' disabled' : '') + '>Explore clicks</button>') +
    '<button class="btn" data-act="redraft" data-id="' + esc(f.id) + '"' + (f.busy || !S.config.ready ? ' disabled' : '') + '>Re-draft</button></footer></article>'
  );
}

function renderGrid() {
  const el = $('grid');
  if (!S.project) {
    el.innerHTML = '';
    return;
  }
  if (!S.userId) {
    el.innerHTML =
      '<div class="empty"><h2>Add a user</h2><p>Each user gets their own guide, captured while signed in as that user.</p><button class="btn primary" data-act="add-user">Add user</button></div>';
    return;
  }
  if (!S.guide) {
    el.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }
  const list = S.filter === 'all' ? S.guide.features : S.guide.features.filter((f) => f.status === S.filter);
  if (!list.length) {
    el.innerHTML = S.guide.features.length
      ? '<div class="empty">No pages with this status.</div>'
      : '<div class="empty"><h2>No pages yet</h2><p>Discover crawls the app as this user. Dynamic pages such as /view/:id need a sample value: add them with "+ Add page".</p></div>';
    return;
  }
  el.innerHTML = '<div class="grid">' + list.map(cardHtml).join('') + '</div>';
}

function renderBody() {
  renderToolbar();
  if (S.view === 'doc') renderDocView();
  else renderGrid();
}

function renderAll() {
  renderSide();
  renderHead();
  renderJobbar();
  renderBody();
}

function paramsHtml(route, params) {
  const shared = (S.project && S.project.variables) || {};
  return paramNames(route)
    .map((n) => {
      const ph = shared[n] ? 'shared value: ' + shared[n] : 'e.g. 12';
      return (
        '<label>Value for <code>:' + esc(n) + '</code>' + (shared[n] ? ' <span class="muted">(blank = shared)</span>' : '') +
        '<input type="text" name="param:' + esc(n) + '" value="' + esc((params && params[n]) || '') + '" placeholder="' + esc(ph) + '"></label>'
      );
    })
    .join('');
}

function varNames() {
  const names = new Map();
  Object.keys((S.project && S.project.variables) || {}).forEach((k) => names.set(k, 0));
  ((S.guide && S.guide.features) || []).forEach((f) => {
    paramNames(f.route).forEach((n) => names.set(n, (names.get(n) || 0) + 1));
  });
  return [...names.entries()];
}

function varsModalHtml(m) {
  const rows = varNames()
    .map(
      ([n, count]) =>
        '<label>:' + esc(n) + ' <span class="muted">(' + (count ? 'used by ' + count + ' page' + (count === 1 ? '' : 's') : 'not used yet') + ')</span>' +
        '<input type="text" name="var:' + esc(n) + '" value="' + esc(m.data[n] || '') + '" placeholder="not set"></label>'
    )
    .join('');
  return (
    '<div class="backdrop"><div class="dialog"><h2>Shared variables</h2><form id="modal-form" autocomplete="off">' +
    '<p class="muted">Set a value once and every page whose route contains it (for example <code>/departments/:department</code>) uses it. A value typed on a single page (Edit) still wins for that page. Applies to all users in this project.</p>' +
    '<div class="stack">' + (rows || '<p class="muted">No pages use a <code>:variable</code> yet. You can add one below.</p>') + '</div>' +
    '<div class="form" style="margin-top:10px"><label>Add variable name<input type="text" name="newname" placeholder="department"></label>' +
    '<label>Value<input type="text" name="newvalue" placeholder="e.g. 12"></label></div>' +
    '<div class="mfoot"><span class="grow"></span><button type="button" class="btn" data-act="close">Cancel</button>' +
    '<button type="button" class="btn primary" data-act="save-vars">Save</button></div></form></div></div>'
  );
}

function projectModalHtml(m) {
  const d = m.data;
  const edit = m.mode === 'edit';
  return (
    '<div class="backdrop"><div class="dialog"><h2>' + (edit ? 'Project settings' : 'New project') + '</h2><form id="modal-form" autocomplete="off"><div class="form">' +
    '<label class="full">Project name<input type="text" name="name" value="' + esc(d.name) + '"></label>' +
    '<label class="full">App URL<input type="text" name="appUrl" value="' + esc(d.appUrl) + '" placeholder="https://app.example.com"></label>' +
    '<label>Login path<input type="text" name="loginPath" value="' + esc(d.loginPath) + '"></label>' +
    '<label>Viewport width x height<span style="display:flex;gap:6px"><input type="number" name="width" value="' + d.viewport.width + '"><input type="number" name="height" value="' + d.viewport.height + '"></span></label>' +
    '<label>Username field selector<input type="text" name="userSelector" value="' + esc(d.userSelector) + '"></label>' +
    '<label>Password field selector<input type="text" name="passSelector" value="' + esc(d.passSelector) + '"></label>' +
    '<label class="full">Login button selector<input type="text" name="submitSelector" value="' + esc(d.submitSelector) + '"></label>' +
    '<label class="full">About this app (helps the AI write better text)<textarea name="context" rows="2">' + esc(d.context) + '</textarea></label></div>' +
    '<div class="mfoot">' + (edit ? '<button type="button" class="btn danger" data-act="delete-project">Delete project</button><span class="grow"></span>' : '') +
    '<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn primary" data-act="save-project">' + (edit ? 'Save' : 'Create') + '</button></div></form></div></div>'
  );
}

function userModalHtml(m) {
  const d = m.data;
  const edit = m.mode === 'edit';
  return (
    '<div class="backdrop"><div class="dialog"><h2>' + (edit ? 'User settings' : 'Add user') + '</h2><form id="modal-form" autocomplete="off"><div class="stack">' +
    '<label>Label shown in the tabs (for example HR Admin)<input type="text" name="name" value="' + esc(d.name) + '"></label>' +
    '<label>Username or email<input type="text" name="username" value="' + esc(d.username) + '"></label>' +
    '<label>Password' + (edit ? ' (leave blank to keep the current one)' : '') + '<input type="password" name="password" value="" autocomplete="new-password"></label></div>' +
    '<p class="muted">Use a dedicated account on a staging site with fake data. Passwords are stored in plain text on this computer only.</p>' +
    '<div class="mfoot">' + (edit ? '<button type="button" class="btn danger" data-act="delete-user">Delete user</button><span class="grow"></span>' : '') +
    '<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn primary" data-act="save-user">' + (edit ? 'Save' : 'Add user') + '</button></div></form></div></div>'
  );
}

function featureModalHtml(m) {
  const d = m.data;
  return (
    '<div class="backdrop"><div class="dialog"><h2>Add a page</h2><form id="modal-form" autocomplete="off"><div class="stack">' +
    '<label>Route (use :name for dynamic parts, for example /view/:id)<input type="text" name="route" value="' + esc(d.route) + '" placeholder="/view/:id"></label>' +
    '<label>Page name (optional)<input type="text" name="name_en" value="' + esc(d.name.en) + '"></label>' +
    '<div class="stack" id="params-box" style="margin-top:0">' + paramsHtml(d.route, d.params) + '</div>' +
    '<label class="chk"><input type="checkbox" name="draft" ' + (d.draft ? 'checked' : '') + '> Draft with AI after capturing</label></div>' +
    '<div class="mfoot"><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn primary" data-act="save-feature">Add and capture</button></div></form></div></div>'
  );
}

function itemsHtml(items) {
  return items
    .map(
      (it, i) =>
        '<div class="irow" data-i="' + i + '"><div class="inum">' + (i + 1) + '</div><div class="ifields"><code>' + esc(it.selector) + '</code>' +
        '<input type="text" data-f="title.en" value="' + esc(it.title.en) + '" placeholder="Title (EN)">' +
        '<input type="text" data-f="title.km" value="' + esc(it.title.km) + '" placeholder="Title (KM)">' +
        '<input type="text" data-f="description.en" value="' + esc(it.description.en) + '" placeholder="Description (EN)">' +
        '<input type="text" data-f="description.km" value="' + esc(it.description.km) + '" placeholder="Description (KM)"></div>' +
        '<div class="iact"><button type="button" class="btn sm" data-act="item-up" data-i="' + i + '">↑</button>' +
        '<button type="button" class="btn sm" data-act="item-down" data-i="' + i + '">↓</button>' +
        '<button type="button" class="btn sm bad" data-act="item-del" data-i="' + i + '">✕</button></div></div>'
    )
    .join('');
}

function editModalHtml(m) {
  const d = m.data;
  const options = m.elements
    .map((e, i) => '<option value="' + i + '">' + esc((e.label || '(no label)') + ' · ' + e.tag) + '</option>')
    .join('');
  return (
    '<div class="backdrop"><div class="dialog wide"><h2>Edit page</h2><form id="modal-form" autocomplete="off"><div class="form">' +
    '<label>Name (EN)<input type="text" name="name_en" value="' + esc(d.name.en) + '"></label>' +
    '<label>Name (KM)<input type="text" name="name_km" value="' + esc(d.name.km) + '"></label>' +
    '<label>Route<input type="text" name="route" value="' + esc(d.route) + '"></label>' +
    '<label>Wait for this selector before the screenshot (optional)<input type="text" name="waitFor" value="' + esc(d.waitFor) + '"></label>' +
    '<div class="full stack" id="params-box" style="margin-top:0">' + paramsHtml(d.route, d.params) + '</div>' +
    '<label class="full">Click these selectors first, one per line (optional, to open a tab or dialog)<textarea name="steps" rows="2">' + esc(d.stepsText) + '</textarea></label></div>' +
    '<h3>Callouts</h3><div id="items-box">' + itemsHtml(d.items) + '</div>' +
    '<div class="addrow"><select id="add-el"><option value="">Add an element from the screenshot…</option>' + options + '</select>' +
    '<button type="button" class="btn" data-act="add-item">Add</button></div>' +
    '<div class="mfoot"><button type="button" class="btn danger" data-act="delete-feature">Delete page</button><span class="grow"></span>' +
    '<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn" data-act="save-edit">Save</button>' +
    '<button type="button" class="btn primary" data-act="save-recapture">Save and re-shoot</button></div></form></div></div>'
  );
}

function renderModalHtml() {
  const m = S.modal;
  if (m.type === 'project') return projectModalHtml(m);
  if (m.type === 'user') return userModalHtml(m);
  if (m.type === 'vars') return varsModalHtml(m);
  if (m.type === 'feature') return featureModalHtml(m);
  if (m.type === 'edit') return editModalHtml(m);
  if (m.type === 'log') {
    const text = S.jobs.map((j) => '[' + (JOB_LABEL[j.type] || j.type) + ' · ' + j.status + ']\n' + j.logs.join('\n')).join('\n\n') || 'No jobs yet.';
    return '<div class="backdrop" data-backdrop><div class="dialog wide"><h2>Job log</h2><pre class="log">' + esc(text) + '</pre><div class="mfoot"><button type="button" class="btn" data-act="close">Close</button></div></div></div>';
  }
  return '';
}

function renderModal(focus) {
  const box = $('modal');
  const old = box.querySelector('.backdrop');
  const top = old ? old.scrollTop : 0;
  box.innerHTML = S.modal ? renderModalHtml() : '';
  document.body.classList.toggle('noscroll', !!S.modal);
  const bd = box.querySelector('.backdrop');
  if (bd) bd.scrollTop = top;
  if (focus) {
    const first = box.querySelector('input[type=text],textarea');
    if (first) first.focus();
  }
}

function closeModal() {
  S.modal = null;
  renderModal();
}

function formObject() {
  const form = $('modal-form');
  const out = { params: {} };
  if (!form) return out;
  for (const [k, v] of new FormData(form).entries()) {
    if (k.startsWith('param:')) out.params[k.slice(6)] = v;
    else out[k] = v;
  }
  return out;
}

function syncModal() {
  const m = S.modal;
  if (!m || !$('modal-form')) return;
  const d = formObject();
  if (m.type === 'edit') {
    m.data.name = { en: d.name_en || '', km: d.name_km || '' };
    m.data.route = d.route || '';
    m.data.waitFor = d.waitFor || '';
    m.data.stepsText = d.steps || '';
    m.data.params = d.params;
    document.querySelectorAll('#items-box .irow').forEach((row) => {
      const it = m.data.items[Number(row.dataset.i)];
      if (!it) return;
      row.querySelectorAll('input[data-f]').forEach((inp) => {
        const [a, b] = inp.dataset.f.split('.');
        it[a][b] = inp.value;
      });
    });
  }
}

async function loadProjects() {
  S.projects = await api('GET', '/api/projects');
}

function remember() {
  try {
    localStorage.setItem('gs.last', JSON.stringify({ p: S.project ? S.project.id : '', u: S.userId }));
  } catch (e) {
    return;
  }
}

async function selectProject(pid, uid) {
  S.project = await api('GET', '/api/projects/' + pid);
  const wanted = uid && S.project.users.some((u) => u.id === uid) ? uid : '';
  S.userId = wanted || (S.project.users[0] ? S.project.users[0].id : '');
  S.guide = null;
  S.guideJson = '';
  S.jobs = [];
  S.jobsJson = '';
  S.seenInit = false;
  S.filter = 'all';
  S.doc = null;
  remember();
  renderAll();
  if (S.userId) {
    await loadGuide(true);
    if (S.view === 'doc') await loadDoc();
    await tick();
  }
}

async function selectUser(uid) {
  S.userId = uid;
  S.guide = null;
  S.guideJson = '';
  S.jobs = [];
  S.jobsJson = '';
  S.seenInit = false;
  S.filter = 'all';
  S.doc = null;
  remember();
  renderAll();
  await loadGuide(true);
  if (S.view === 'doc') await loadDoc();
  await tick();
}

async function loadGuide(force) {
  if (!S.project || !S.userId) return;
  const pid = S.project.id;
  const uid = S.userId;
  const g = await api('GET', '/api/projects/' + pid + '/users/' + uid + '/guide');
  if (!S.project || pid !== S.project.id || uid !== S.userId) return;
  const json = JSON.stringify(g);
  if (!force && json === S.guideJson) return;
  S.guideJson = json;
  S.guide = g;
  if (!S.dragging) {
    if (S.view === 'doc') renderToolbar();
    else renderBody();
  }
}

async function tick() {
  if (!S.project || !S.userId) return;
  try {
    const jobs = await api('GET', '/api/jobs?uid=' + S.userId);
    if (!S.seenInit) {
      jobs.filter((j) => !isActive(j)).forEach((j) => seen.add(j.id));
      S.seenInit = true;
    }
    jobs
      .filter((j) => j.status === 'failed' && !seen.has(j.id))
      .forEach((j) => {
        seen.add(j.id);
        toast(j.error, 'bad');
      });
    const active = jobs.some(isActive);
    const json = JSON.stringify(jobs.map((j) => [j.id, j.status, j.logs.length]));
    const changed = json !== S.jobsJson;
    S.jobsJson = json;
    S.jobs = jobs;
    if (active || S.wasActive || changed) await loadGuide(false);
    S.wasActive = active;
    const genActive = jobs.some((j) => j.type === 'generate' && isActive(j));
    if (changed) {
      renderJobbar();
      renderToolbar();
      if (S.modal && S.modal.type === 'log') renderModal();
    }
    if (S.view === 'doc') {
      syncGenerate();
      if (S.genWasActive && !genActive) await refreshOutputs();
    }
    S.genWasActive = genActive;
  } catch (e) {
    return;
  }
}

async function setStatus(id, status) {
  const f = S.guide.features.find((x) => x.id === id);
  if (f) f.status = status;
  S.guideJson = JSON.stringify(S.guide);
  renderToolbar();
  renderGrid();
  await api('PATCH', base() + '/features/' + id, { status });
}

async function openEdit(id) {
  const f = S.guide.features.find((x) => x.id === id);
  if (!f) return;
  S.modal = {
    type: 'edit',
    id,
    elements: [],
    data: {
      name: { en: f.name.en || '', km: f.name.km || '' },
      route: f.route,
      params: { ...f.params },
      waitFor: f.waitFor || '',
      stepsText: (f.actions || []).map((a) => a.click).join('\n'),
      items: JSON.parse(JSON.stringify(f.items)),
    },
  };
  renderModal(true);
  try {
    const r = await api('GET', base() + '/features/' + id);
    if (S.modal && S.modal.id === id) {
      syncModal();
      S.modal.elements = r.elements;
      renderModal(false);
    }
  } catch (e) {
    return;
  }
}

async function saveEdit(recapture) {
  syncModal();
  const m = S.modal;
  const d = m.data;
  await api('PATCH', base() + '/features/' + m.id, {
    name: d.name,
    route: d.route.trim(),
    params: d.params,
    waitFor: d.waitFor.trim(),
    steps: d.stepsText.split('\n').map((s) => s.trim()).filter(Boolean),
    items: d.items,
  });
  if (recapture) await api('POST', base() + '/features/' + m.id + '/recapture', { draft: false });
  closeModal();
  await loadGuide(true);
  await tick();
}

function moveItem(i, delta) {
  syncModal();
  const items = S.modal.data.items;
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  renderModal(false);
}

async function onAction(act, el) {
  const id = el.dataset.id;
  switch (act) {
    case 'new-project':
      S.modal = { type: 'project', mode: 'create', data: { name: '', appUrl: '', loginPath: '/login', userSelector: '#username', passSelector: '#password', submitSelector: 'button[type=submit]', context: '', viewport: { width: 1440, height: 900 } } };
      renderModal(true);
      break;
    case 'edit-project':
      S.modal = { type: 'project', mode: 'edit', data: { ...S.project, context: S.project.context || '' } };
      renderModal(true);
      break;
    case 'edit-vars':
      S.modal = { type: 'vars', data: { ...(S.project.variables || {}) } };
      renderModal(true);
      break;
    case 'save-vars': {
      const d = formObject();
      const vars = {};
      new FormData($('modal-form')).forEach((v, k) => {
        if (k.startsWith('var:') && String(v).trim()) vars[k.slice(4)] = String(v).trim();
      });
      const nn = (d.newname || '').trim().replace(/^:/, '');
      if (nn && String(d.newvalue || '').trim()) vars[nn] = String(d.newvalue).trim();
      const pid = S.project.id;
      await api('PUT', '/api/projects/' + pid, { variables: vars });
      closeModal();
      await loadProjects();
      await selectProject(pid, S.userId);
      toast('Shared variables saved. Click Discover pages to capture pages that were waiting for values.', 'good');
      break;
    }
    case 'select-project':
      await selectProject(id);
      break;
    case 'select-user':
      await selectUser(id);
      break;
    case 'add-user':
      S.modal = { type: 'user', mode: 'create', data: { name: '', username: '' } };
      renderModal(true);
      break;
    case 'edit-user': {
      const u = S.project.users.find((x) => x.id === S.userId);
      S.modal = { type: 'user', mode: 'edit', data: { name: u.name, username: u.username } };
      renderModal(true);
      break;
    }
    case 'close':
      closeModal();
      break;
    case 'save-project': {
      const d = formObject();
      const body = { name: d.name, appUrl: d.appUrl, loginPath: d.loginPath, userSelector: d.userSelector, passSelector: d.passSelector, submitSelector: d.submitSelector, context: d.context, viewport: { width: Number(d.width), height: Number(d.height) } };
      if (S.modal.mode === 'edit') {
        const pid = S.project.id;
        await api('PUT', '/api/projects/' + pid, body);
        closeModal();
        await loadProjects();
        await selectProject(pid, S.userId);
      } else {
        const p = await api('POST', '/api/projects', body);
        closeModal();
        await loadProjects();
        await selectProject(p.id);
      }
      break;
    }
    case 'delete-project': {
      if (!confirm('Delete project "' + S.project.name + '" and all its screenshots?')) break;
      await api('DELETE', '/api/projects/' + S.project.id);
      closeModal();
      S.project = null;
      S.userId = '';
      S.guide = null;
      await loadProjects();
      if (S.projects.length) await selectProject(S.projects[0].id);
      else renderAll();
      break;
    }
    case 'save-user': {
      const d = formObject();
      if (S.modal.mode === 'edit') {
        await api('PUT', '/api/projects/' + S.project.id + '/users/' + S.userId, { name: d.name, username: d.username, password: d.password });
        closeModal();
        await selectProject(S.project.id, S.userId);
      } else {
        const r = await api('POST', '/api/projects/' + S.project.id + '/users', { name: d.name, username: d.username, password: d.password });
        closeModal();
        await loadProjects();
        await selectProject(S.project.id, r.id);
      }
      break;
    }
    case 'delete-user': {
      if (!confirm('Delete this user and their guide?')) break;
      await api('DELETE', '/api/projects/' + S.project.id + '/users/' + S.userId);
      closeModal();
      await loadProjects();
      await selectProject(S.project.id);
      break;
    }
    case 'filter':
      S.filter = el.dataset.v;
      renderBody();
      break;
    case 'lang':
      S.lang = el.dataset.v;
      renderBody();
      break;
    case 'discover':
      await api('POST', base() + '/discover', { draft: S.draftAfter && !!S.config.ready, explore: S.exploreAfter && !!S.config.ready });
      await tick();
      break;
    case 'draft-new':
      await api('POST', base() + '/draft-all', { scope: 'new' });
      await tick();
      break;
    case 'draft-all':
      await api('POST', base() + '/draft-all', { scope: 'all' });
      await tick();
      break;
    case 'approve-all': {
      const r = await api('POST', base() + '/approve-all', {});
      toast(r.count + ' page' + (r.count === 1 ? '' : 's') + ' approved', 'good');
      await loadGuide(true);
      break;
    }
    case 'show-log':
      S.modal = { type: 'log' };
      renderModal();
      break;
    case 'add-page':
      S.modal = { type: 'feature', data: { route: '', name: { en: '', km: '' }, params: {}, draft: !!S.config.ready } };
      renderModal(true);
      break;
    case 'save-feature': {
      const d = formObject();
      await api('POST', base() + '/features', { route: (d.route || '').trim(), name: d.name_en, params: d.params, draft: d.draft === 'on' });
      closeModal();
      await loadGuide(true);
      await tick();
      break;
    }
    case 'approve':
      await setStatus(id, 'approved');
      break;
    case 'reject':
      await setStatus(id, 'rejected');
      break;
    case 'restore': {
      const f = S.guide.features.find((x) => x.id === id);
      await setStatus(id, f && f.items.length ? 'draft' : 'new');
      break;
    }
    case 'edit':
      await openEdit(id);
      break;
    case 'reshoot':
      await api('POST', base() + '/features/' + id + '/recapture', { draft: false });
      await loadGuide(true);
      await tick();
      break;
    case 'explore':
      await api('POST', base() + '/features/' + id + '/explore', {});
      await loadGuide(true);
      await tick();
      break;
    case 'restart': {
      const ai = S.config.ready;
      const msg =
        'Start over for this user?\n\nThis DELETES every page, screenshot, callout and approval for this guide, then discovers and captures all pages again' +
        (ai ? (S.draftAfter ? ', drafts with AI' : '') + (S.exploreAfter ? ' and explores clicks' : '') : '') +
        '.\n\nYour cover settings and already generated PDF/Word files are kept. This cannot be undone.';
      if (!confirm(msg)) break;
      S.doc = null;
      await api('POST', base() + '/restart', { confirm: true, draft: S.draftAfter && !!ai, explore: S.exploreAfter && !!ai });
      await loadGuide(true);
      await tick();
      break;
    }
    case 'redraft':
      await api('POST', base() + '/features/' + id + '/recapture', { draft: true });
      await loadGuide(true);
      await tick();
      break;
    case 'save-edit':
      await saveEdit(false);
      break;
    case 'save-recapture':
      await saveEdit(true);
      break;
    case 'delete-feature': {
      if (!confirm('Delete this page and its screenshot?')) break;
      const fid = S.modal.id;
      await api('DELETE', base() + '/features/' + fid);
      closeModal();
      await loadGuide(true);
      break;
    }
    case 'item-up':
      moveItem(Number(el.dataset.i), -1);
      break;
    case 'item-down':
      moveItem(Number(el.dataset.i), 1);
      break;
    case 'item-del':
      syncModal();
      S.modal.data.items.splice(Number(el.dataset.i), 1);
      renderModal(false);
      break;
    case 'add-item': {
      const sel = $('add-el');
      if (!sel || sel.value === '') break;
      syncModal();
      const e = S.modal.elements[Number(sel.value)];
      S.modal.data.items.push({ selector: e.selector, title: { en: e.label || '', km: '' }, description: { en: '', km: '' }, needsReview: false });
      renderModal(false);
      break;
    }
    default:
      await docAction(act, el);
      break;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('backdrop') && e.target.hasAttribute('data-backdrop')) {
    closeModal();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  guard(() => onAction(el.dataset.act, el));
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const m = S.modal;
  if (!m) return;
  const map = { project: 'save-project', user: 'save-user', feature: 'save-feature', edit: 'save-edit' };
  const act = map[m.type];
  if (act) guard(() => onAction(act, document.body));
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'explore-after') {
    S.exploreAfter = e.target.checked;
    return;
  }
  if (e.target.id === 'draft-after') {
    S.draftAfter = e.target.checked;
    return;
  }
  docChange(e);
});

document.addEventListener('input', (e) => {
  if (e.target.name !== 'route' || !S.modal || (S.modal.type !== 'feature' && S.modal.type !== 'edit')) return;
  const box = $('params-box');
  if (!box) return;
  const current = {};
  box.querySelectorAll('input').forEach((i) => {
    current[i.name.slice(6)] = i.value;
  });
  box.innerHTML = paramsHtml(e.target.value, { ...S.modal.data.params, ...current });
});

const gridEl = $('grid');

gridEl.addEventListener('mousedown', (e) => {
  const h = e.target.closest('.drag');
  if (h) h.closest('.card').draggable = true;
});

gridEl.addEventListener('mouseup', () => {
  gridEl.querySelectorAll('.card[draggable=true]').forEach((c) => {
    c.draggable = false;
  });
});

gridEl.addEventListener('dragstart', (e) => {
  const card = e.target.closest ? e.target.closest('.card') : null;
  if (!card) return;
  if (!card.draggable) {
    e.preventDefault();
    return;
  }
  S.dragging = card;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.id);
});

gridEl.addEventListener('dragover', (e) => {
  if (!S.dragging) return;
  e.preventDefault();
  const target = e.target.closest('.card');
  if (!target || target === S.dragging) return;
  const cards = [...target.parentNode.children];
  if (cards.indexOf(S.dragging) < cards.indexOf(target)) target.after(S.dragging);
  else target.before(S.dragging);
});

gridEl.addEventListener('drop', (e) => {
  if (S.dragging) e.preventDefault();
});

gridEl.addEventListener('dragend', () => {
  const card = S.dragging;
  if (!card) return;
  card.classList.remove('dragging');
  card.draggable = false;
  S.dragging = null;
  const ids = [...gridEl.querySelectorAll('.card')].map((c) => c.dataset.id);
  if (ids.join() === S.guide.features.map((f) => f.id).join()) return;
  const by = new Map(S.guide.features.map((f) => [f.id, f]));
  S.guide.features = ids.map((id) => by.get(id)).filter(Boolean);
  S.guideJson = JSON.stringify(S.guide);
  guard(async () => {
    try {
      await api('PUT', base() + '/order', { ids });
    } catch (err) {
      await loadGuide(true);
      throw err;
    }
  });
});

async function init() {
  S.config = await api('GET', '/api/config').catch(() => ({}));
  await loadProjects();
  renderAll();
  let last = {};
  try {
    last = JSON.parse(localStorage.getItem('gs.last') || '{}');
  } catch (e) {
    last = {};
  }
  const first = S.projects.find((p) => p.id === last.p) || S.projects[0];
  if (first) await selectProject(first.id, last.u);
  setInterval(tick, 1500);
}

initDocEvents();
guard(init);
