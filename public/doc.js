const collapsedSet = new Set();

function docTitle(p) {
  return p.name[S.lang] || p.name.en || p.route;
}

function groupLabel(g) {
  return g.name.en || g.name.km || 'Untitled section';
}

function numbering() {
  const nums = {};
  let n = 0;
  S.doc.outline.forEach((o) => {
    if (o.t === 'g') {
      const g = S.doc.groups.find((x) => x.id === o.id);
      if (!g.pageIds.length) return;
      n++;
      nums['g' + o.id] = String(n);
      g.pageIds.forEach((id, i) => {
        nums['p' + id] = n + '.' + (i + 1);
      });
    } else {
      n++;
      nums['p' + o.id] = String(n);
    }
  });
  return nums;
}

function pageLi(id, nums, pm) {
  const p = pm[id];
  if (!p) return '';
  const thumb = '/files/' + S.project.id + '/' + S.userId + '/raw/' + id + '.png?v=' + p.capturedAt;
  const options =
    '<option value="">Move to…</option><option value="__root">Top level</option>' +
    S.doc.groups.map((g) => '<option value="' + esc(g.id) + '">' + esc(groupLabel(g)) + '</option>').join('');
  return (
    '<li class="node page" data-kind="p" data-id="' + esc(id) + '"><div class="nrow"><span class="nhandle" title="Drag to move">⠿</span>' +
    '<span class="nnum">' + esc(nums['p' + id] || '') + '</span><img class="nthumb" src="' + thumb + '" alt="" draggable="false">' +
    '<div class="ntext"><strong>' + esc(docTitle(p)) + '</strong><code>' + esc(p.route) + '</code></div>' +
    '<select class="mv" data-id="' + esc(id) + '">' + options + '</select>' +
    '<span class="nbtns"><button class="btn sm" data-act="node-up" data-kind="p" data-id="' + esc(id) + '">↑</button>' +
    '<button class="btn sm" data-act="node-down" data-kind="p" data-id="' + esc(id) + '">↓</button>' +
    '<button class="btn sm bad" data-act="del-page" data-id="' + esc(id) + '" title="Remove from the document (back to unapproved in Review)">✕</button></span></div></li>'
  );
}

function groupLi(g, nums, pm) {
  const closed = collapsedSet.has(g.id);
  const kids = g.pageIds.length
    ? g.pageIds.map((id) => pageLi(id, nums, pm)).join('')
    : '<li class="gdrop" data-gid="' + esc(g.id) + '">Empty section, drop pages here (it is skipped in the document)</li>';
  return (
    '<li class="node group' + (closed ? ' collapsed' : '') + '" data-kind="g" data-id="' + esc(g.id) + '"><div class="nrow"><span class="nhandle" title="Drag to move">⠿</span>' +
    '<button class="btn sm tgl" data-act="toggle-group" data-id="' + esc(g.id) + '" title="' + (closed ? 'Expand' : 'Collapse') + '">' + (closed ? '▸' : '▾') + '</button>' +
    '<span class="nnum">' + esc(nums['g' + g.id] || '') + '</span><div class="gname">' +
    '<input type="text" data-gid="' + esc(g.id) + '" data-gl="en" value="' + esc(g.name.en) + '" placeholder="Section name (EN)">' +
    '<input type="text" data-gid="' + esc(g.id) + '" data-gl="km" value="' + esc(g.name.km) + '" placeholder="Section name (KM)"></div>' +
    '<span class="nbtns"><button class="btn sm" data-act="node-up" data-kind="g" data-id="' + esc(g.id) + '">↑</button>' +
    '<button class="btn sm" data-act="node-down" data-kind="g" data-id="' + esc(g.id) + '">↓</button>' +
    '<button class="btn sm bad" data-act="del-group" data-id="' + esc(g.id) + '" title="Remove section, keep its pages">✕</button></span></div>' +
    '<span class="gcount">' + g.pageIds.length + '</span>' +
    '<ul class="tree" data-gid="' + esc(g.id) + '">' + kids + '</ul></li>'
  );
}

function treeHtml() {
  const nums = numbering();
  const pm = {};
  S.doc.pages.forEach((p) => {
    pm[p.id] = p;
  });
  const gm = new Map(S.doc.groups.map((g) => [g.id, g]));
  const rows = S.doc.outline.map((o) => (o.t === 'g' ? groupLi(gm.get(o.id), nums, pm) : pageLi(o.id, nums, pm))).join('');
  return '<ul class="tree root">' + rows + '<li class="rootend">Drop here to move to the end, outside any section</li></ul>';
}

function treePanelHtml() {
  return (
    '<div class="phd"><h3>Structure</h3><div class="trow"><button class="btn sm" data-act="add-group">+ Add section</button>' +
    '<button class="btn sm" data-act="expand-all">Expand all</button><button class="btn sm" data-act="collapse-all">Collapse all</button>' +
    '<button class="btn sm" data-act="auto-group" title="Group pages that share the first part of their URL">Auto-group by URL</button></div></div>' +
    '<p class="muted small">Drag ⠿ to reorder. Drop a page on a section to put it inside. The numbers are the chapter numbers in the document.</p>' +
    treeHtml()
  );
}

function outputsHtml() {
  const list = S.doc.outputs || [];
  if (!list.length) return '<p class="muted small">No files yet.</p>';
  const root = '/files/' + S.project.id + '/' + S.userId + '/out/documents/';
  return (
    '<ul class="outs">' +
    list
      .map(
        (o) =>
          '<li><a href="' + root + esc(o.name) + '" target="_blank">' + esc(o.name) + '</a><small>' +
          (o.size / 1048576 >= 1 ? (o.size / 1048576).toFixed(1) + ' MB' : Math.round(o.size / 1024) + ' KB') + ' · ' +
          new Date(o.at).toLocaleString() + '</small></li>'
      )
      .join('') +
    '</ul>'
  );
}

function logoBoxHtml() {
  const d = S.doc;
  const img = d.logo ? '<img src="/files/' + S.project.id + '/' + S.userId + '/' + d.logo + '?v=' + d.logoAt + '" alt="">' : '<span class="muted small">No logo</span>';
  return img + (d.logo ? '<button type="button" class="btn sm bad" data-act="logo-remove">Remove</button>' : '');
}

function settingsHtml() {
  const s = S.doc.settings;
  const f = (label, name, value, ph) => '<label>' + label + '<input type="text" name="' + name + '" value="' + esc(value) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>';
  const aiOff = S.config.ready ? '' : ' disabled title="Turn on AI drafting in .env"';
  return (
    '<form id="docform" autocomplete="off"><h3>Cover</h3><div class="form">' +
    f('Title (EN)', 'title_en', s.title.en) + f('Title (KM)', 'title_km', s.title.km) +
    f('Subtitle (EN)', 'subtitle_en', s.subtitle.en) + f('Subtitle (KM)', 'subtitle_km', s.subtitle.km) +
    f('Organization (EN)', 'org_en', s.org.en) + f('Organization (KM)', 'org_km', s.org.km) +
    f('Version', 'version', s.version) + f('Date', 'date', s.date, 'Leave empty for today') +
    '<label>Accent color<input type="color" name="accent" value="' + esc(s.accent) + '"></label>' +
    f('Khmer font name', 'font', s.font, 'Noto Sans Khmer') +
    '</div><div class="logorow"><span class="muted small">Logo</span><div id="logo-box" class="logobox">' + logoBoxHtml() + '</div>' +
    '<label class="btn sm filebtn">Upload<input type="file" id="logo-file" accept="image/png,image/jpeg" hidden></label></div>' +
    '<h3>System overview</h3><div class="stack">' +
    '<label>English<textarea name="overview_en" rows="5">' + esc(s.overview.en) + '</textarea></label>' +
    '<label>Khmer<textarea name="overview_km" rows="5">' + esc(s.overview.km) + '</textarea></label>' +
    '<div class="trow"><button type="button" class="btn sm" data-act="draft-overview"' + aiOff + '>Draft with AI</button>' +
    '<span class="muted small">Left empty, the overview page is skipped.</span></div></div></form>' +
    '<h3>Generate</h3><div class="stack"><div class="trow"><b>Format</b>' +
    '<label class="chk"><input type="checkbox" id="fmt-pdf" checked> PDF</label><label class="chk"><input type="checkbox" id="fmt-docx"> Word</label></div>' +
    '<div class="trow"><b>Language</b><label class="chk"><input type="checkbox" id="lang-en" checked> English</label>' +
    '<label class="chk"><input type="checkbox" id="lang-km"> Khmer</label></div>' +
    '<label class="chk"><input type="checkbox" id="force"> Re-shoot every page first (otherwise only changed pages)</label>' +
    '<button type="button" class="btn primary block" data-act="generate">Generate</button></div>' +
    '<h3>Files</h3><div id="doc-outputs">' + outputsHtml() + '</div>'
  );
}

function renderDocView() {
  const el = $('grid');
  if (!S.project || !S.userId) {
    el.innerHTML = '';
    return;
  }
  if (!S.doc) {
    el.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }
  if (!S.doc.pages.length) {
    el.innerHTML =
      '<div class="empty"><h2>No approved pages yet</h2><p>Approve the pages you want in the document first.</p><button class="btn primary" data-act="view" data-v="review">Go to Review</button></div>';
    return;
  }
  el.innerHTML =
    '<div class="docgrid"><section class="panel" id="doc-tree">' + treePanelHtml() + '</section><section class="panel">' + settingsHtml() + '</section></div>';
  syncGenerate();
}

function renderTree() {
  const box = $('doc-tree');
  if (box) box.innerHTML = treePanelHtml();
}

function syncGenerate() {
  const b = document.querySelector('[data-act=generate]');
  if (!b) return;
  const busy = hasActive('generate');
  b.disabled = busy || !S.doc || !S.doc.pages.length;
  b.textContent = busy ? 'Generating…' : 'Generate';
}

async function loadDoc() {
  if (!S.project || !S.userId) return;
  const pid = S.project.id;
  const uid = S.userId;
  const d = await api('GET', base() + '/document');
  if (!S.project || pid !== S.project.id || uid !== S.userId) return;
  S.doc = d;
  if (S.view === 'doc') renderBody();
}

async function refreshOutputs() {
  const d = await api('GET', base() + '/document');
  if (!S.doc) return;
  S.doc.outputs = d.outputs;
  const box = $('doc-outputs');
  if (box) box.innerHTML = outputsHtml();
}

function readSettings() {
  const f = $('docform');
  const v = (n) => (f.elements[n] ? f.elements[n].value : '');
  return {
    title: { en: v('title_en'), km: v('title_km') },
    subtitle: { en: v('subtitle_en'), km: v('subtitle_km') },
    org: { en: v('org_en'), km: v('org_km') },
    overview: { en: v('overview_en'), km: v('overview_km') },
    version: v('version'),
    date: v('date'),
    accent: v('accent'),
    font: v('font'),
  };
}

async function saveSettings() {
  if (!$('docform')) return;
  S.doc.settings = readSettings();
  await api('PUT', base() + '/document', { settings: S.doc.settings });
}

async function flushStructure() {
  clearTimeout(S.saveTimer);
  S.saveTimer = null;
  if (!S.doc) return;
  await api('PUT', base() + '/document', { groups: S.doc.groups, outline: S.doc.outline });
}

function queueStructure() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => guard(flushStructure), 300);
}

function removeNode(kind, id) {
  const d = S.doc;
  if (kind === 'g') {
    d.outline = d.outline.filter((o) => !(o.t === 'g' && o.id === id));
    return;
  }
  d.outline = d.outline.filter((o) => !(o.t === 'p' && o.id === id));
  d.groups.forEach((g) => {
    g.pageIds = g.pageIds.filter((x) => x !== id);
  });
}

function applyMove(drag, spec) {
  const d = S.doc;
  if (spec.ref && spec.ref.kind === drag.kind && spec.ref.id === drag.id) return false;

  if (spec.mode === 'into') {
    const g = d.groups.find((x) => x.id === spec.ref.id);
    if (!g || drag.kind !== 'p') return false;
    removeNode('p', drag.id);
    g.pageIds.push(drag.id);
    return true;
  }

  if (spec.mode === 'end') {
    removeNode(drag.kind, drag.id);
    d.outline.push({ t: drag.kind, id: drag.id });
    return true;
  }

  const holder = spec.ref.kind === 'p' ? d.groups.find((x) => x.pageIds.includes(spec.ref.id)) : null;
  if (holder && drag.kind === 'g' && holder.id === drag.id) return false;

  removeNode(drag.kind, drag.id);

  if (holder && drag.kind === 'p') {
    const i = holder.pageIds.indexOf(spec.ref.id);
    holder.pageIds.splice(spec.mode === 'before' ? i : i + 1, 0, drag.id);
    return true;
  }

  const target = holder ? { t: 'g', id: holder.id } : { t: spec.ref.kind, id: spec.ref.id };
  const idx = d.outline.findIndex((o) => o.t === target.t && o.id === target.id);
  if (idx < 0) {
    d.outline.push({ t: drag.kind, id: drag.id });
    return true;
  }
  d.outline.splice(spec.mode === 'before' ? idx : idx + 1, 0, { t: drag.kind, id: drag.id });
  return true;
}

function shiftNode(kind, id, delta) {
  const d = S.doc;
  const holder = kind === 'p' ? d.groups.find((g) => g.pageIds.includes(id)) : null;
  const list = holder ? holder.pageIds : d.outline;
  const i = holder ? list.indexOf(id) : list.findIndex((o) => o.t === kind && o.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

function newGroupId() {
  return 'g' + Math.random().toString(16).slice(2, 8);
}

function autoGroup() {
  const d = S.doc;
  const pm = {};
  d.pages.forEach((p) => {
    pm[p.id] = p;
  });
  const buckets = new Map();
  d.outline.forEach((o) => {
    if (o.t !== 'p') return;
    const seg = (pm[o.id].route.split('/').filter(Boolean)[0] || '').trim();
    if (!seg || seg.startsWith(':')) return;
    if (!buckets.has(seg)) buckets.set(seg, []);
    buckets.get(seg).push(o.id);
  });
  let made = 0;
  buckets.forEach((ids, seg) => {
    if (ids.length < 2) return;
    const title = seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    let g = d.groups.find((x) => x.name.en.toLowerCase() === title.toLowerCase());
    const at = d.outline.findIndex((o) => o.t === 'p' && o.id === ids[0]);
    if (!g) {
      g = { id: newGroupId(), name: { en: title, km: '' }, pageIds: [] };
      d.groups.push(g);
      d.outline.splice(at, 0, { t: 'g', id: g.id });
      made++;
    }
    ids.forEach((id) => {
      d.outline = d.outline.filter((o) => !(o.t === 'p' && o.id === id));
      g.pageIds.push(id);
    });
  });
  return made;
}

async function docAction(act, el) {
  const d = S.doc;
  switch (act) {
    case 'view':
      S.view = el.dataset.v;
      renderToolbar();
      renderBody();
      if (S.view === 'doc') await loadDoc();
      return true;
    case 'toggle-group':
      if (collapsedSet.has(el.dataset.id)) collapsedSet.delete(el.dataset.id);
      else collapsedSet.add(el.dataset.id);
      renderTree();
      break;
    case 'expand-all':
      collapsedSet.clear();
      renderTree();
      break;
    case 'collapse-all':
      d.groups.forEach((g) => collapsedSet.add(g.id));
      renderTree();
      break;
    case 'add-group': {
      const g = { id: newGroupId(), name: { en: 'New section', km: '' }, pageIds: [] };
      d.groups.push(g);
      d.outline.push({ t: 'g', id: g.id });
      renderTree();
      queueStructure();
      const input = document.querySelector('input[data-gid="' + g.id + '"][data-gl="en"]');
      if (input) {
        input.focus();
        input.select();
      }
      return true;
    }
    case 'del-page': {
      const id = el.dataset.id;
      removeNode('p', id);
      d.pages = d.pages.filter((p) => p.id !== id);
      renderTree();
      clearTimeout(S.saveTimer);
      S.saveTimer = null;
      await api('PATCH', base() + '/features/' + id, { status: 'new' });
      await api('PUT', base() + '/document', { groups: d.groups, outline: d.outline });
      if (S.guide) {
        const f = S.guide.features.find((x) => x.id === id);
        if (f) f.status = 'new';
        S.guideJson = JSON.stringify(S.guide);
      }
      if (!d.pages.length) renderBody();
      return true;
    }
    case 'del-group': {
      const g = d.groups.find((x) => x.id === el.dataset.id);
      if (!g) return true;
      const at = d.outline.findIndex((o) => o.t === 'g' && o.id === g.id);
      d.outline.splice(at, 1, ...g.pageIds.map((id) => ({ t: 'p', id })));
      d.groups = d.groups.filter((x) => x.id !== g.id);
      renderTree();
      queueStructure();
      return true;
    }
    case 'auto-group': {
      const made = autoGroup();
      renderTree();
      queueStructure();
      toast(made ? made + ' section' + (made === 1 ? '' : 's') + ' created from the URLs' : 'No pages share a URL prefix', made ? 'good' : '');
      return true;
    }
    case 'node-up':
    case 'node-down':
      if (shiftNode(el.dataset.kind, el.dataset.id, act === 'node-up' ? -1 : 1)) {
        renderTree();
        queueStructure();
      }
      return true;
    case 'draft-overview': {
      const r = await api('POST', base() + '/document/overview', {});
      const f = $('docform');
      f.elements.overview_en.value = r.en;
      f.elements.overview_km.value = r.km;
      await saveSettings();
      toast('Overview drafted. Please read and edit it.', 'good');
      return true;
    }
    case 'logo-remove': {
      const r = await api('DELETE', base() + '/document/logo');
      d.logo = r.logo;
      $('logo-box').innerHTML = logoBoxHtml();
      return true;
    }
    case 'generate': {
      const formats = ['pdf', 'docx'].filter((x) => $('fmt-' + x).checked);
      const langs = ['en', 'km'].filter((x) => $('lang-' + x).checked);
      if (!formats.length || !langs.length) {
        toast('Choose a format and a language', 'bad');
        return true;
      }
      await saveSettings();
      await flushStructure();
      await api('POST', base() + '/generate', { formats, langs, force: $('force').checked });
      await tick();
      syncGenerate();
      return true;
    }
    default:
      return false;
  }
}

function docChange(e) {
  const t = e.target;
  if (t.id === 'logo-file') {
    const file = t.files && t.files[0];
    if (!file) return true;
    if (file.size > 2 * 1024 * 1024) {
      toast('The logo must be smaller than 2 MB', 'bad');
      return true;
    }
    const reader = new FileReader();
    reader.onload = () =>
      guard(async () => {
        const r = await api('POST', base() + '/document/logo', { dataUrl: reader.result });
        S.doc.logo = r.logo;
        S.doc.logoAt = r.logoAt;
        $('logo-box').innerHTML = logoBoxHtml();
      });
    reader.readAsDataURL(file);
    return true;
  }
  if (t.closest && t.closest('#docform')) {
    guard(saveSettings);
    return true;
  }
  if (t.dataset && t.dataset.gid && t.dataset.gl) {
    const g = S.doc.groups.find((x) => x.id === t.dataset.gid);
    if (g) {
      g.name[t.dataset.gl] = t.value.trim();
      document.querySelectorAll('select.mv option[value="' + g.id + '"]').forEach((o) => {
        o.textContent = groupLabel(g);
      });
      queueStructure();
    }
    return true;
  }
  if (t.classList && t.classList.contains('mv')) {
    if (t.value) {
      const spec = t.value === '__root' ? { mode: 'end' } : { mode: 'into', ref: { kind: 'g', id: t.value } };
      if (applyMove({ kind: 'p', id: t.dataset.id }, spec)) queueStructure();
      renderTree();
    }
    return true;
  }
  return false;
}

function dropSpec(e) {
  const drag = S.nodeDrag;
  const t = e.target.closest ? e.target.closest('li.node, li.gdrop, li.rootend') : null;
  if (!t || !drag) return null;
  if (t.classList.contains('rootend')) return { mode: 'end', el: t };
  if (t.classList.contains('gdrop')) {
    if (drag.kind === 'g') return null;
    return { mode: 'into', ref: { kind: 'g', id: t.dataset.gid }, el: t.closest('li.node') };
  }

  let el = t;
  let kind = t.dataset.kind;
  let id = t.dataset.id;
  const outer = t.parentElement ? t.parentElement.closest('li.node.group') : null;

  if (drag.kind === 'g') {
    if (outer) {
      el = outer;
      kind = 'g';
      id = outer.dataset.id;
    }
    if (id === drag.id) return null;
  } else if (kind === 'p' && id === drag.id) {
    return null;
  }

  if (drag.kind === 'p' && kind === 'g') {
    const hdr = el.querySelector('.nrow').getBoundingClientRect();
    if (e.clientY < hdr.top + hdr.height * 0.3) return { mode: 'before', ref: { kind: 'g', id }, el };
    return { mode: 'into', ref: { kind: 'g', id }, el };
  }

  const r = el.getBoundingClientRect();
  return { mode: e.clientY < r.top + r.height / 2 ? 'before' : 'after', ref: { kind, id }, el };
}

function clearDrop() {
  document.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
}

function initDocEvents() {
  const grid = $('grid');

  grid.addEventListener('mousedown', (e) => {
    const h = e.target.closest ? e.target.closest('.nhandle') : null;
    if (h) h.closest('li.node').draggable = true;
  });

  grid.addEventListener('mouseup', () => {
    grid.querySelectorAll('li.node[draggable=true]').forEach((n) => {
      n.draggable = false;
    });
  });

  grid.addEventListener('dragstart', (e) => {
    const li = e.target.closest ? e.target.closest('li.node') : null;
    if (!li || !li.draggable) return;
    S.nodeDrag = { kind: li.dataset.kind, id: li.dataset.id };
    S.nodeSpec = null;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
    e.stopPropagation();
  });

  grid.addEventListener('dragover', (e) => {
    if (!S.nodeDrag) return;
    e.preventDefault();
    const spec = dropSpec(e);
    clearDrop();
    S.nodeSpec = spec;
    if (spec && spec.el) spec.el.classList.add('drop-' + (spec.mode === 'end' ? 'before' : spec.mode));
  });

  grid.addEventListener('drop', (e) => {
    if (!S.nodeDrag) return;
    e.preventDefault();
    const spec = S.nodeSpec;
    const drag = S.nodeDrag;
    clearDrop();
    if (spec && applyMove(drag, spec)) {
      renderTree();
      queueStructure();
    }
  });

  grid.addEventListener('dragend', () => {
    if (!S.nodeDrag) return;
    S.nodeDrag = null;
    S.nodeSpec = null;
    clearDrop();
    grid.querySelectorAll('li.node.dragging').forEach((n) => n.classList.remove('dragging'));
    grid.querySelectorAll('li.node[draggable=true]').forEach((n) => {
      n.draggable = false;
    });
  });
}
