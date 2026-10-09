const store = require('./store');
const capture = require('./capture');
const ai = require('./ai');
const fs = require('fs');
const path = require('path');
const renderer = require('./render');
const docstore = require('./docstore');
const docmodel = require('./docmodel');
const pdfBuilder = require('./pdf');
const docxBuilder = require('./docx');
const jobs = require('./jobs');
const explore = require('./explore');
const supervisor = require('./supervisor');
const { resolveRoute, missingParams, effectiveParams } = require('./routes');

function context(pid, uid) {
  const project = store.getProject(pid);
  if (!project) throw new Error('Project not found');
  const user = project.users.find((u) => u.id === uid);
  if (!user) throw new Error('User not found');
  return { pid, uid, project, user, dir: store.userDir(pid, uid) };
}

async function captureOne(page, c, fid, log) {
  const feature = store.getFeature(c.pid, c.uid, fid);
  if (!feature) return false;
  jobs.setBusy(c.uid, fid, true);
  try {
    const elements = await capture.captureFeature(page, c.project, c.dir, feature);
    store.updateFeature(c.pid, c.uid, fid, (f) => {
      f.capturedAt = Date.now();
      f.viewport = c.project.viewport;
      f.error = '';
    });
    log('Captured ' + feature.route + ' (' + elements.length + ' elements)');
    return true;
  } catch (err) {
    store.updateFeature(c.pid, c.uid, fid, (f) => {
      f.error = err.message;
    });
    log('FAILED capture ' + feature.route + ': ' + err.message);
    return false;
  } finally {
    jobs.setBusy(c.uid, fid, false);
  }
}

async function draftOne(c, fid, log) {
  const feature = store.getFeature(c.pid, c.uid, fid);
  if (!feature) return false;
  const elements = store.readElements(c.pid, c.uid, fid);
  if (!feature.capturedAt || !elements.length) {
    log('Skipped draft for ' + feature.route + ' (not captured yet)');
    return false;
  }
  jobs.setBusy(c.uid, fid, true);
  try {
    const route = resolveRoute(feature.route, effectiveParams(c.project, feature));
    const image = store.readRawBase64(c.pid, c.uid, fid);
    const trigger = feature.trigger ? feature.trigger.label : '';
    const out = await ai.draftFeature({ route, elements, image, context: c.project.context, trigger });
    let review = null;
    if (process.env.REVIEW !== 'false' && out.items.length) {
      try {
        const r = await ai.superviseFeature({ route, elements, image, items: out.items, context: c.project.context, trigger });
        if (r.items.length) out.items = r.items;
        review = { verdict: r.verdict, notes: r.notes, at: Date.now() };
        log('Supervisor ' + route + ': ' + r.verdict + (r.notes ? ' – ' + r.notes : ''));
      } catch (err) {
        log('Supervisor skipped for ' + route + ': ' + err.message);
      }
    }
    store.updateFeature(c.pid, c.uid, fid, (f) => {
      f.review = review;
      f.items = out.items;
      if (!f.nameLocked && (out.title.en || out.title.km)) f.name = out.title;
      f.status = 'draft';
      f.draftedAt = Date.now();
      f.error = '';
    });
    log('Drafted ' + feature.route + ' (' + out.items.length + ' items)');
    return true;
  } catch (err) {
    store.updateFeature(c.pid, c.uid, fid, (f) => {
      f.error = 'AI draft failed: ' + err.message;
    });
    log('FAILED draft ' + feature.route + ': ' + err.message);
    return false;
  } finally {
    jobs.setBusy(c.uid, fid, false);
  }
}

// Re-run the reviewer on the existing callouts (fix boxes without a new draft).
async function refineOne(c, fid, log) {
  const feature = store.getFeature(c.pid, c.uid, fid);
  if (!feature || !feature.capturedAt || !feature.items.length) return false;
  jobs.setBusy(c.uid, fid, true);
  try {
    const route = resolveRoute(feature.route, effectiveParams(c.project, feature));
    const r = await ai.superviseFeature({
      route,
      elements: store.readElements(c.pid, c.uid, fid),
      image: store.readRawBase64(c.pid, c.uid, fid),
      items: feature.items,
      context: c.project.context,
      trigger: feature.trigger ? feature.trigger.label : '',
    });
    store.updateFeature(c.pid, c.uid, fid, (f) => {
      if (r.items.length) f.items = r.items;
      f.review = { verdict: r.verdict, notes: r.notes, at: Date.now() };
    });
    log('Refined ' + route + ': ' + r.verdict + (r.notes ? ' – ' + r.notes : ''));
    return true;
  } catch (err) {
    log('FAILED refine ' + feature.route + ': ' + err.message);
    return false;
  } finally {
    jobs.setBusy(c.uid, fid, false);
  }
}

// Queue a single-page job (re-shoot, redraft, explore...) and mark the page busy.
function queueFeature(pid, uid, fid, type, opts) {
  jobs.setBusy(uid, fid, true);
  return jobs.enqueue({
    type,
    pid,
    uid,
    fid,
    run: async (log) => {
      try {
        await featureJob(pid, uid, fid, opts, log);
      } finally {
        jobs.setBusy(uid, fid, false);
      }
    },
  });
}

async function featureJob(pid, uid, fid, opts, log) {
  const c = context(pid, uid);
  if (opts.capture) {
    const session = await capture.openSession(c.project, c.user, c.dir);
    try {
      await captureOne(session.page, c, fid, log);
    } finally {
      await session.browser.close();
    }
  }
  if (opts.draft) {
    if (ai.status().ready) await draftOne(c, fid, log);
    else log('AI draft skipped: set ALLOW_CLOUD_AI=true and OPENROUTER_API_KEY in .env');
  }
  if (opts.refine) await refineOne(context(pid, uid), fid, log);
  if (opts.explore) await exploreMany(pid, uid, [fid], log);
  if (opts.supervise) await supervisor.runPass(pid, uid, { log, act: true, only: [fid] });
}

async function exploreMany(pid, uid, fids, log) {
  if (!ai.status().ready) {
    log('Explore skipped: set ALLOW_CLOUD_AI=true and OPENROUTER_API_KEY in .env');
    return;
  }
  const c = context(pid, uid);
  const parents = store
    .getGuide(pid, uid)
    .features.filter((f) => fids.includes(f.id) && !f.parentId && f.capturedAt);
  if (!parents.length) return;
  const session = await capture.openSession(c.project, c.user, c.dir);
  try {
    for (const p of parents) {
      jobs.setBusy(uid, p.id, true);
      try {
        await explore.exploreFeature(session, c, p, { log, draft: draftOne });
        store.updateFeature(pid, uid, p.id, (f) => {
          f.exploredAt = Date.now();
        });
      } catch (err) {
        log('FAILED explore ' + p.route + ': ' + err.message);
      } finally {
        jobs.setBusy(uid, p.id, false);
      }
    }
  } finally {
    await session.browser.close();
  }
}

async function draftMany(pid, uid, scope, log) {
  ai.assertReady();
  const c = context(pid, uid);
  const targets = store
    .getGuide(pid, uid)
    .features.filter((f) => f.capturedAt && (scope === 'all' ? f.status !== 'approved' : f.status === 'new'));
  log('Drafting ' + targets.length + ' pages');
  for (const f of targets) {
    await draftOne(c, f.id, log);
  }
}

async function discover(pid, uid, opts, log) {
  const c = context(pid, uid);
  log('Signing in as ' + c.user.username);
  const session = await capture.openSession(c.project, c.user, c.dir);
  try {
    const routes = await capture.discoverRoutes(session.page);
    log('Routes found: ' + routes.length);

    const known = new Set(store.getGuide(pid, uid).features.map((f) => f.route));
    routes.forEach((r) => {
      if (!known.has(r)) store.addFeature(pid, uid, { route: r });
    });

    const todo = store.getGuide(pid, uid).features.filter((f) => !f.capturedAt);
    for (const f of todo) {
      const missing = missingParams(f.route, effectiveParams(c.project, f));
      if (missing.length) {
        store.updateFeature(pid, uid, f.id, (x) => {
          x.error = 'Needs sample values for: ' + missing.join(', ');
        });
        log('Needs sample values: ' + f.route);
        continue;
      }
      await captureOne(session.page, c, f.id, log);
    }
  } finally {
    await session.browser.close();
  }

  if (opts.draft) {
    if (ai.status().ready) await draftMany(pid, uid, 'new', log);
    else log('AI draft skipped: set ALLOW_CLOUD_AI=true and OPENROUTER_API_KEY in .env');
  }

  if (opts.explore) {
    const ids = store
      .getGuide(pid, uid)
      .features.filter((f) => !f.parentId && f.capturedAt && !f.exploredAt)
      .map((f) => f.id);
    await exploreMany(pid, uid, ids, log);
  }

  if (opts.supervise) await supervisor.runPass(pid, uid, { log, act: true });
}

async function restart(pid, uid, opts, log) {
  context(pid, uid);
  log('Clearing all pages, screenshots and callouts for this user');
  store.resetGuide(pid, uid);
  await discover(pid, uid, opts, log);
}

function fileStem(project, user) {
  const ascii = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [ascii(project.name), ascii(user.name)].filter(Boolean).join('-') || 'user-guide';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

async function generate(pid, uid, opts, log) {
  const c = context(pid, uid);
  const view = docstore.view(pid, uid);
  const guide = store.getGuide(pid, uid);
  const byId = new Map(guide.features.map((f) => [f.id, f]));

  const order = [];
  view.outline.forEach((o) => {
    if (o.t === 'g') view.groups.find((g) => g.id === o.id).pageIds.forEach((id) => order.push(id));
    else order.push(o.id);
  });
  const features = order.map((id) => byId.get(id)).filter(Boolean);
  if (!features.length) throw new Error('No approved pages to put in the document. Approve pages in Review first.');

  const stale = features.filter((f) => {
    const r = guide.renders[f.id];
    return opts.force || !r || !r.ok || r.hash !== renderer.renderHash(f, c.project) || !fs.existsSync(renderer.imagePath(c.dir, f.id));
  });

  if (stale.length) {
    log('Taking numbered screenshots of ' + stale.length + ' of ' + features.length + ' pages');
    const results = await renderer.renderPages(c.project, c.user, c.dir, stale, log);
    store.updateGuide(pid, uid, (g) => {
      stale.forEach((f) => {
        const r = results[f.id];
        if (!r) return;
        g.renders[f.id] = r.ok
          ? { ok: true, hash: renderer.renderHash(f, c.project), at: Date.now(), missing: r.missing }
          : { ok: false, error: r.error, at: Date.now() };
      });
    });
  } else {
    log('All ' + features.length + ' screenshots are up to date');
  }

  const outDir = path.join(c.dir, 'out', 'documents');
  fs.mkdirSync(outDir, { recursive: true });
  const base = fileStem(c.project, c.user);
  const when = stamp();

  for (const lang of opts.langs) {
    const model = docmodel.build(pid, uid, lang);
    const pages = model.entries.filter((e) => e.kind === 'page').length;
    if (!pages) throw new Error('No page could be rendered, see the log above');
    if (pages < features.length) log('Warning: ' + (features.length - pages) + ' page(s) left out because their screenshot failed');

    if (opts.formats.includes('pdf')) {
      const name = base + '-' + lang + '-' + when + '.pdf';
      log('Building ' + name);
      await pdfBuilder.build(model, path.join(outDir, name), log);
      log('Saved ' + name);
    }
    if (opts.formats.includes('docx')) {
      const name = base + '-' + lang + '-' + when + '.docx';
      log('Building ' + name);
      await docxBuilder.build(model, path.join(outDir, name));
      log('Saved ' + name);
    }
  }
}

module.exports = { context, captureOne, draftOne, refineOne, queueFeature, featureJob, draftMany, exploreMany, discover, restart, generate };
