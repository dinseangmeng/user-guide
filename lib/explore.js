const store = require('./store');
const capture = require('./capture');
const ai = require('./ai');
const { assertSafeClick } = require('./safety');
const { resolveRoute, slug, effectiveParams } = require('./routes');

const MAX_PICKS = () => Math.max(1, Math.min(10, Number(process.env.EXPLORE_MAX) || 4));

function clickable(e) {
  if (e.unsafe) return false;
  if (e.tag === 'input' || e.tag === 'textarea') return false;
  if (e.type === 'submit') return false;
  if (e.tag === 'a' && e.href && !e.href.startsWith('#')) return false;
  return true;
}

function placeAfterFamily(g, parentId, child) {
  g.features = g.features.filter((f) => f.id !== child.id);
  let at = g.features.findIndex((f) => f.id === parentId);
  while (at + 1 < g.features.length && g.features[at + 1].parentId === parentId) at++;
  g.features.splice(at + 1, 0, child);
}

// Plans clicks for one captured page, performs each on a fresh load, and saves
// every click that visibly changed the screen as a child page ("state").
// draft(c, fid, log) is called for each new state so it gets callouts.
async function exploreFeature(session, c, parent, { log, draft }) {
  const elements = store.readElements(c.pid, c.uid, parent.id);
  const candidates = elements.filter(clickable);
  if (!parent.capturedAt || !candidates.length) {
    log('Explore skipped for ' + parent.route + ' (nothing to click)');
    return 0;
  }

  const route = resolveRoute(parent.route, effectiveParams(c.project, parent));
  const known = new Set(
    store.getGuide(c.pid, c.uid).features.filter((f) => f.parentId === parent.id && f.trigger).map((f) => f.trigger.selector)
  );
  const plans = (
    await ai.planClicks({
      route,
      elements: candidates,
      image: store.readRawBase64(c.pid, c.uid, parent.id),
      context: c.project.context,
      max: MAX_PICKS(),
    })
  ).filter((p) => !known.has(p.selector));
  log('Explore ' + route + ': model picked ' + plans.length + ' click(s)');

  let created = 0;
  for (const plan of plans) {
    const label = (elements.find((e) => e.selector === plan.selector) || {}).label || plan.selector;
    try {
      await capture.openFeature(session.page, c.project, parent);
      const before = await capture.snapshot(session.page);
      const beforeSel = new Set(before.elements.map((e) => e.selector));
      const basePath = new URL(session.page.url()).pathname;

      await assertSafeClick(session.page, plan.selector);
      await session.page.click(plan.selector, { timeout: 8000 });
      await capture.settle(session.page, '');

      if (new URL(session.page.url()).pathname !== basePath) {
        log('Skipped "' + label + '": it navigates to another page');
        continue;
      }

      const after = await capture.snapshot(session.page);
      const marked = after.elements.map((e) => ({ ...e, isNew: !beforeSel.has(e.selector) }));
      const fresh = marked.filter((e) => e.isNew).length;
      if (!fresh && before.image.equals(after.image)) {
        log('Skipped "' + label + '": nothing changed on screen');
        continue;
      }

      const name = plan.stateName.en || plan.stateName.km ? plan.stateName : { en: parent.name.en + ' – ' + label, km: '' };
      const child = store.addFeature(c.pid, c.uid, {
        route: parent.route,
        params: parent.params,
        name: name.en,
        idStem: parent.id + '-' + (slug(label).slice(0, 24) || 'state'),
      });
      store.writeSnapshot(c.pid, c.uid, child.id, after.image, marked);
      store.updateGuide(c.pid, c.uid, (g) => {
        const f = g.features.find((x) => x.id === child.id);
        f.name = name;
        f.nameLocked = true;
        f.parentId = parent.id;
        f.trigger = { selector: plan.selector, label, reason: plan.reason };
        f.waitFor = parent.waitFor;
        f.actions = [...(parent.actions || []), { click: plan.selector }];
        f.capturedAt = Date.now();
        f.viewport = c.project.viewport;
        placeAfterFamily(g, parent.id, f);
      });
      created++;
      log('Saved state "' + (name.en || label) + '" (' + fresh + ' new elements)');
      if (draft) await draft(c, child.id, log);
    } catch (err) {
      log('Skipped "' + label + '": ' + String(err.message).split('\n')[0]);
    }
  }
  return created;
}

module.exports = { exploreFeature };
