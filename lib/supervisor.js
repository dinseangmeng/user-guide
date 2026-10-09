const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const ai = require('./ai');
const docstore = require('./docstore');
const jobs = require('./jobs');
const capture = require('./capture');
const { effectiveParams, missingParams, refsFor } = require('./routes');

const RETRY = new Set(['reshoot', 'redraft', 'refine', 'explore']);
const DESTRUCTIVE = new Set(['restart', 'delete_page']);
const MAX_ATTEMPTS = 2;
const MAX_ROUNDS = 3; // the last round only decides (approve/reject/keep), no more retries

const pipeline = () => require('./pipeline');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const S = (v) => (typeof v === 'string' ? v.trim() : '');
const pairOf = (v) => ({ en: S(v && v.en), km: S(v && v.km) });
const title = (f) => f.name.en || f.name.km || f.route;

// ---- facts the supervisor model decides from ------------------------------

function pageFacts(pid, uid) {
  const project = store.getProject(pid);
  const guide = store.getGuide(pid, uid);
  const seen = new Map();
  return guide.features.map((f) => {
    const elements = store.readElements(pid, uid, f.id);
    const bySel = new Map(elements.map((e) => [e.selector, e]));
    let duplicateOf = '';
    try {
      const h = sha1(fs.readFileSync(store.rawFile(pid, uid, f.id)));
      if (seen.has(h)) duplicateOf = seen.get(h);
      else seen.set(h, f.id);
    } catch (e) {
      // not captured
    }
    const sup = f.supervisor || {};
    return {
      id: f.id,
      route: f.route,
      title: title(f),
      status: f.status,
      decidedBy: f.statusBy || '',
      isState: !!f.parentId,
      trigger: f.trigger ? f.trigger.label : '',
      captured: !!f.capturedAt,
      needsValues: missingParams(f.route, effectiveParams(project, f)),
      error: (f.error || '').slice(0, 200),
      elements: elements.length,
      clickable: elements.filter((e) => !e.unsafe && (e.tag === 'button' || e.role === 'tab' || e.role === 'button')).length,
      callouts: f.items.length,
      headingCallouts: f.items.filter((i) => ['h1', 'h2', 'th'].includes((bySel.get(i.selector) || {}).tag)).length,
      missingTargets: f.items.filter((i) => !bySel.has(i.selector)).length,
      needsReview: f.items.filter((i) => i.needsReview).length,
      reviewer: f.review ? f.review.verdict : '',
      duplicateOf,
      explored: !!f.exploredAt,
      attempts: sup.attempts || 0,
      refs: refsFor(f).map((r) => r.name + '=' + r.ref).join(','),
    };
  });
}

function needsDecision(f) {
  return !(f.statusBy === 'user' && (f.status === 'approved' || f.status === 'rejected'));
}

// ---- actions (shared by the automatic pass and the chat) ------------------

function setStatus(pid, uid, id, status, by) {
  return store.updateFeature(pid, uid, id, (f) => {
    f.status = status;
    f.statusBy = by;
  });
}

function noteDecision(pid, uid, id, patch) {
  store.updateFeature(pid, uid, id, (f) => {
    f.supervisor = { ...(f.supervisor || {}), ...patch, at: Date.now() };
  });
}

function bump(pid, uid, id) {
  store.updateFeature(pid, uid, id, (f) => {
    f.supervisor = { ...(f.supervisor || {}), attempts: ((f.supervisor && f.supervisor.attempts) || 0) + 1 };
  });
}

function idsOf(ctx, a) {
  const guide = store.getGuide(ctx.pid, ctx.uid);
  if (a.ids === 'all_drafts') return guide.features.filter((f) => f.status === 'draft').map((f) => f.id);
  const known = new Set(guide.features.map((f) => f.id));
  const list = Array.isArray(a.ids) ? a.ids : typeof a.ids === 'string' ? [a.ids] : a.id ? [a.id] : [];
  return list.filter((id) => known.has(id));
}

async function inlineSession(ctx) {
  if (!ctx.session) {
    const c = pipeline().context(ctx.pid, ctx.uid);
    ctx.session = await capture.openSession(c.project, c.user, c.dir);
  }
  return ctx.session;
}

async function retry(ctx, type, id) {
  const p = pipeline();
  if (!ctx.inline) {
    const opts = { reshoot: { capture: true, draft: true }, redraft: { draft: true }, refine: { refine: true }, explore: { explore: true } }[type];
    p.queueFeature(ctx.pid, ctx.uid, id, type === 'reshoot' ? 'capture' : type, { ...opts, supervise: false });
    return;
  }
  const c = p.context(ctx.pid, ctx.uid);
  if (type === 'reshoot') {
    const s = await inlineSession(ctx);
    if (await p.captureOne(s.page, c, id, ctx.log)) await p.draftOne(c, id, ctx.log);
  } else if (type === 'redraft') await p.draftOne(c, id, ctx.log);
  else if (type === 'refine') await p.refineOne(c, id, ctx.log);
  else if (type === 'explore') await p.exploreMany(ctx.pid, ctx.uid, [id], ctx.log);
}

function itemsFrom(ctx, id, list) {
  const sels = new Set(store.readElements(ctx.pid, ctx.uid, id).map((e) => e.selector));
  return (Array.isArray(list) ? list : [])
    .filter((i) => i && sels.has(i.selector))
    .map((i) => ({ selector: i.selector, title: pairOf(i.title), description: pairOf(i.description), needsReview: false }));
}

const HANDLERS = {
  async approve(ctx, a) {
    const ok = [];
    idsOf(ctx, a).forEach((id) => {
      const f = store.getFeature(ctx.pid, ctx.uid, id);
      const bulk = a.ids === 'all_drafts';
      if (!f.capturedAt || ((!ctx.user || bulk) && (f.error || !f.items.length))) return;
      setStatus(ctx.pid, ctx.uid, id, 'approved', ctx.user ? 'user' : 'supervisor');
      ok.push(id);
    });
    return 'Approved ' + ok.length + ' page(s)';
  },
  async reject(ctx, a) {
    const ids = idsOf(ctx, a);
    ids.forEach((id) => setStatus(ctx.pid, ctx.uid, id, 'rejected', ctx.user ? 'user' : 'supervisor'));
    return 'Rejected ' + ids.length + ' page(s)';
  },
  async restore(ctx, a) {
    const ids = idsOf(ctx, a);
    ids.forEach((id) => {
      const f = store.getFeature(ctx.pid, ctx.uid, id);
      setStatus(ctx.pid, ctx.uid, id, f.items.length ? 'draft' : 'new', ctx.user ? 'user' : 'supervisor');
    });
    return 'Restored ' + ids.length + ' page(s)';
  },
  async reshoot(ctx, a) {
    const ids = idsOf(ctx, a);
    for (const id of ids) await retry(ctx, 'reshoot', id);
    return (ctx.inline ? 'Re-shot ' : 'Queued re-shoot for ') + ids.length + ' page(s)';
  },
  async redraft(ctx, a) {
    const ids = idsOf(ctx, a);
    for (const id of ids) await retry(ctx, 'redraft', id);
    return (ctx.inline ? 'Redrafted ' : 'Queued redraft for ') + ids.length + ' page(s)';
  },
  async refine(ctx, a) {
    const ids = idsOf(ctx, a);
    for (const id of ids) await retry(ctx, 'refine', id);
    return (ctx.inline ? 'Refined boxes on ' : 'Queued box review for ') + ids.length + ' page(s)';
  },
  async explore(ctx, a) {
    const ids = idsOf(ctx, a);
    for (const id of ids) await retry(ctx, 'explore', id);
    return (ctx.inline ? 'Explored clicks on ' : 'Queued click exploration for ') + ids.length + ' page(s)';
  },
  async discover(ctx) {
    const { pid, uid } = ctx;
    if (ctx.inline) {
      await pipeline().discover(pid, uid, { draft: ai.status().ready, explore: ai.status().ready, supervise: false }, ctx.log);
      return 'Discovery finished: ' + store.getGuide(pid, uid).features.length + ' page(s) in the guide';
    }
    if (jobs.findActive(uid, 'discover')) return 'Discover is already running';
    jobs.enqueue({ type: 'discover', pid, uid, run: (log) => pipeline().discover(pid, uid, { draft: ai.status().ready, explore: ai.status().ready, supervise: true }, log) });
    return 'Queued page discovery';
  },
  async run_supervisor(ctx, a) {
    const { pid, uid } = ctx;
    if (ctx.inline) {
      const only = Array.isArray(a && a.ids) && a.ids.length ? idsOf(ctx, a) : null;
      await runPass(pid, uid, { log: ctx.log, act: true, only });
      const run = store.getGuide(pid, uid).supervisorRun;
      return 'Automatic check finished' + (run && run.summary ? ': ' + run.summary : '');
    }
    if (jobs.findActive(uid, 'supervise')) return 'The supervisor check is already running';
    jobs.enqueue({ type: 'supervise', pid, uid, run: (log) => runPass(pid, uid, { log, act: true }) });
    return 'Queued a full supervisor check';
  },
  async detect_login(ctx) {
    const project = store.getProject(ctx.pid);
    const r = await capture.detectLogin(project.appUrl, project.loginPath);
    store.updateProject(ctx.pid, { userSelector: r.userSelector, passSelector: r.passSelector, submitSelector: r.submitSelector });
    return 'Login fields detected (' + r.via + '): ' + [r.userSelector, r.passSelector, r.submitSelector].join(' | ');
  },
  async set_items(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    const items = itemsFrom(ctx, id, a.items);
    if (!items.length) return 'No valid callouts (selectors must exist on the page)';
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.items = items;
      if (f.status === 'new') f.status = 'draft';
    });
    return 'Updated ' + items.length + ' callouts on ' + id;
  },
  async add_item(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    const [item] = itemsFrom(ctx, id, [a]);
    if (!item) return 'That selector is not on the page (read_page lists the valid selectors)';
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.items = f.items.filter((i) => i.selector !== item.selector).concat(item);
      if (f.status === 'new') f.status = 'draft';
    });
    return 'Added a callout to ' + id;
  },
  async remove_item(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.items = f.items.filter((i) => i.selector !== a.selector);
    });
    return 'Removed a callout from ' + id;
  },
  async rename_page(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.name = pairOf(a.name);
      f.nameLocked = true;
    });
    return 'Renamed ' + id;
  },
  async set_page_params(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    const params = {};
    Object.keys(a.params || {}).forEach((k) => {
      if (/^[A-Za-z0-9_]{1,40}$/.test(k)) params[k] = S(String(a.params[k]));
    });
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.params = { ...f.params, ...params };
    });
    return 'Updated route values on ' + id;
  },
  async set_variable(ctx, a) {
    const ref = S(a.ref || a.name);
    if (!/^[A-Za-z0-9_]{1,40}$/.test(ref)) return 'Bad variable name';
    const vars = { ...(store.getProject(ctx.pid).variables || {}) };
    if (S(String(a.value == null ? '' : a.value))) vars[ref] = S(String(a.value));
    else delete vars[ref];
    store.updateProject(ctx.pid, { variables: vars });
    return 'Set shared variable ' + ref;
  },
  async set_ref(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id || !/^[a-z][a-z0-9_]{0,38}$/.test(S(a.ref)) || !/^[A-Za-z0-9_]{1,40}$/.test(S(a.param))) return 'Bad page or name';
    store.updateFeature(ctx.pid, ctx.uid, id, (f) => {
      f.alias = { ...(f.alias || {}), [S(a.param)]: S(a.ref) };
    });
    return 'Mapped :' + a.param + ' on ' + id + ' to ' + a.ref;
  },
  async set_document(ctx, a) {
    const settings = {};
    ['title', 'subtitle', 'org', 'overview'].forEach((k) => {
      if (a[k]) settings[k] = pairOf(a[k]);
    });
    ['version', 'date'].forEach((k) => {
      if (typeof a[k] === 'string') settings[k] = a[k];
    });
    if (!Object.keys(settings).length) return 'Nothing to change';
    docstore.save(ctx.pid, ctx.uid, { settings });
    return 'Updated document settings (' + Object.keys(settings).join(', ') + ')';
  },
  async draft_overview(ctx) {
    const project = store.getProject(ctx.pid);
    const v = docstore.view(ctx.pid, ctx.uid);
    if (!v.pages.length) return 'Approve some pages first';
    const text = await ai.draftOverview({ context: project.context, name: project.name, titles: v.pages.map((p) => p.name.en || p.route) });
    docstore.save(ctx.pid, ctx.uid, { settings: { overview: text } });
    return 'Wrote the System overview';
  },
  async organize_document(ctx) {
    const v = docstore.view(ctx.pid, ctx.uid);
    if (v.pages.length < 3) return 'Need at least 3 approved pages to organise';
    const sections = await ai.organizeDocument({ pages: v.pages.map((p) => ({ id: p.id, title: p.name.en || p.route, route: p.route })) });
    if (!sections.length) return 'The model did not propose any sections';
    const groups = sections.map((s) => ({ id: 'g-' + crypto.randomBytes(3).toString('hex'), name: s.name, pageIds: s.pageIds }));
    const placed = new Set(groups.flatMap((g) => g.pageIds));
    const outline = groups.map((g) => ({ t: 'g', id: g.id })).concat(v.pages.filter((p) => !placed.has(p.id)).map((p) => ({ t: 'p', id: p.id })));
    docstore.save(ctx.pid, ctx.uid, { groups, outline });
    return 'Organised the document into ' + groups.length + ' sections';
  },
  // Full document order in one call: items are {page} or {section:{en,km}, pages:[...]}.
  // Existing sections are reused by name so their ids stay stable; pages left out are appended by docstore.
  async set_outline(ctx, a) {
    const v = docstore.view(ctx.pid, ctx.uid);
    const valid = new Set(v.pages.map((p) => p.id));
    const byName = new Map(v.groups.map((g) => [(g.name.en || g.name.km).toLowerCase(), g.id]));
    const placed = new Set();
    const take = (id) => (valid.has(id) && !placed.has(id) && placed.add(id) ? id : null);
    const groups = [];
    const outline = [];
    (Array.isArray(a.items) ? a.items : []).forEach((it) => {
      if (!it) return;
      if (it.section) {
        const name = pairOf(it.section);
        const pageIds = (Array.isArray(it.pages) ? it.pages : []).map(take).filter(Boolean);
        if (!pageIds.length || !(name.en || name.km)) return;
        const id = byName.get((name.en || name.km).toLowerCase()) || 'g-' + crypto.randomBytes(3).toString('hex');
        byName.delete((name.en || name.km).toLowerCase());
        groups.push({ id, name, pageIds });
        outline.push({ t: 'g', id });
      } else if (it.page && take(it.page)) outline.push({ t: 'p', id: it.page });
    });
    if (!outline.length) return 'No valid pages or sections given (use ids from guide_overview)';
    docstore.save(ctx.pid, ctx.uid, { groups, outline });
    const left = v.pages.length - placed.size;
    return 'Reordered the document: ' + groups.length + ' section(s), ' + placed.size + ' page(s) placed' + (left ? ', ' + left + ' page(s) not mentioned were added at the end' : '');
  },
  async generate(ctx, a) {
    const { pid, uid } = ctx;
    const formats = ['pdf', 'docx'].filter((f) => (a.formats || ['pdf']).includes(f));
    const langs = ['en', 'km'].filter((l) => (a.langs || ['en']).includes(l));
    if (!formats.length || !langs.length) return 'Choose formats and languages';
    if (ctx.inline) {
      await pipeline().generate(pid, uid, { formats, langs, force: false }, ctx.log);
      return 'Built ' + formats.join('+') + ' in ' + langs.join('+') + ' (see Files)';
    }
    if (jobs.findActive(uid, 'generate')) return 'A document is already being built';
    jobs.enqueue({ type: 'generate', pid, uid, run: (log) => pipeline().generate(pid, uid, { formats, langs, force: false }, log) });
    return 'Queued document build (' + formats.join('+') + ', ' + langs.join('+') + ')';
  },
};

const CONFIRMED = {
  async restart(ctx) {
    const { pid, uid } = ctx;
    if (jobs.hasActive(uid)) return 'Wait for the running jobs to finish first';
    jobs.enqueue({ type: 'restart', pid, uid, run: (log) => pipeline().restart(pid, uid, { draft: ai.status().ready, explore: ai.status().ready, supervise: ai.status().ready }, log) });
    return 'Started over: clearing and rebuilding this guide';
  },
  async delete_page(ctx, a) {
    const [id] = idsOf(ctx, a);
    if (!id) return 'Unknown page';
    store.removeFeature(ctx.pid, ctx.uid, id);
    return 'Deleted page ' + id;
  },
};

async function execute(ctx, action) {
  const h = HANDLERS[action.type];
  if (!h) return 'Unknown action: ' + String(action.type).slice(0, 40);
  try {
    return await h(ctx, action);
  } catch (err) {
    return action.type + ' failed: ' + err.message;
  }
}

// ---- automatic pass: monitor, decide, act ---------------------------------

async function runPass(pid, uid, { log = () => {}, act = true, only = null } = {}) {
  if (!ai.status().ready) {
    log('Supervisor skipped: AI is off (ALLOW_CLOUD_AI / OPENROUTER_API_KEY)');
    return;
  }
  const project = store.getProject(pid);
  const ctx = { pid, uid, log, inline: true, user: false, session: null };
  const counts = {};
  let summary = '';
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      let facts = pageFacts(pid, uid).filter((f) => needsDecision({ status: f.status, statusBy: f.decidedBy }));
      if (only) facts = facts.filter((f) => only.includes(f.id) || only.includes(store.getFeature(pid, uid, f.id).parentId));
      if (!facts.length) break;
      log('Supervisor round ' + round + ': checking ' + facts.length + ' page(s)');
      const out = await ai.supervisorDecide({ pages: facts, context: project.context });
      if (out.summary) summary = out.summary;

      if (act) {
        out.aliases.forEach((a) => {
          store.updateFeature(pid, uid, a.id, (f) => {
            f.alias = { ...(f.alias || {}), [a.param]: a.ref };
          });
          log('Supervisor: ' + a.id + ' :' + a.param + ' → ' + a.ref);
        });
      }

      let retried = 0;
      for (const d of out.decisions) {
        const f = store.getFeature(pid, uid, d.id);
        if (!f) continue;
        let action = d.action;
        if (round === MAX_ROUNDS && RETRY.has(action)) action = 'keep';
        const attempts = (f.supervisor && f.supervisor.attempts) || 0;
        if (RETRY.has(action) && (attempts >= MAX_ATTEMPTS || (action === 'explore' && (f.parentId || f.exploredAt)))) action = 'keep';
        if (RETRY.has(action) && !f.capturedAt) {
          // nothing to redraft/refine/explore yet: capture first, unless route values are missing
          const missing = missingParams(f.route, effectiveParams(project, f));
          if (missing.length) {
            action = 'keep';
            d.reason = 'Needs a value for ' + missing.join(', ') + ' (set it in Shared variables)';
          } else action = 'reshoot';
        }
        if ((action === 'approve' || action === 'reject') && f.status === 'approved' && f.statusBy === 'supervisor' && action === 'approve') continue;
        noteDecision(pid, uid, d.id, { decision: action, reason: d.reason, applied: act && action !== 'keep' });
        counts[action] = (counts[action] || 0) + 1;
        log('Supervisor: ' + d.id + ' → ' + action + (d.reason ? ' (' + d.reason + ')' : ''));
        if (!act || action === 'keep') continue;
        if (RETRY.has(action)) {
          bump(pid, uid, d.id);
          retried++;
        }
        const result = await execute(ctx, { type: action, ids: [d.id] });
        if (/failed/.test(result)) log('Supervisor: ' + result);
      }
      if (!retried) break;
    }
  } finally {
    if (ctx.session) await ctx.session.browser.close().catch(() => {});
  }
  store.updateGuide(pid, uid, (g) => {
    g.supervisorRun = { at: Date.now(), summary, counts, acted: !!act };
  });
  log('Supervisor done' + (summary ? ': ' + summary : ''));
}

module.exports = { runPass, execute, pageFacts, idsOf, CONFIRMED, DESTRUCTIVE, HANDLERS };
