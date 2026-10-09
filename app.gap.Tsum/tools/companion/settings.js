// Writes dist/companionSettings.json: the settings page's own schema (`tabs` in
// src/settings.ts) in the shape GAP Companion draws, so the phone's Settings tab
// follows the script with no phone or adapter release.
//
//   node tools/companion/settings.js [--channel-status N] [out]
//
// Runs the built page scripts (build/*.js) in a vm with a stub DOM, walks `tabs`
// once per language, and keeps English as the text plus a per-language
// `translations` table. The engine reads the file (`gapSettingsSchema`,
// src/index.ts), adds when each change applies and drops what the phone may not
// set. Shape: "Settings from the script" in the companion repo's
// cloud/adapters/README.md (UI contract 2).
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectDir = path.join(__dirname, '..', '..');
const local = (...parts) => path.join(projectDir, ...parts);

/** The UI contract this file targets (cloud/adapters/README.md). */
const UI = 2;

// index.html's load order, minus nothing: settings.js reads all of them.
const PAGE_FILES = ['i18n', 'uiEn', 'uiZhTw', 'uiJa', 'releaseStatus', 'skillOptions', 'bubbleOptions',
  'stopAfterOptions', 'runPlan', 'settingDefaults', 'qrCode', 'presets', 'pageStyle', 'settings'];

// Properties that name things rather than show text; never translated.
const NOT_TEXT = new Set(['key', 'value', 'control', 'button', 'name', 'id', 'type', 'enables']);

function argValue(argv, name) {
  const at = argv.indexOf('--' + name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** A vm holding the page's globals, with just enough DOM for them to load. */
function loadPage(releaseStatus) {
  const store = {};
  const noop = () => {};
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
      documentElement: { setAttribute: noop, getAttribute: () => null } },
    window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    navigator: {},
    setInterval: noop,
    setTimeout: noop,
    clearTimeout: noop,
  };
  vm.createContext(ctx);
  for (const name of PAGE_FILES) {
    const file = local('build', name + '.js');
    const source = fs.readFileSync(file, 'utf8').replaceAll('$RELEASE_STATUS', String(releaseStatus));
    vm.runInContext(source, ctx, { filename: file });
  }
  return { ctx, store };
}

/** The schema with every text in the page's current language. */
function walk(ctx) {
  const t = (key) => (key === undefined ? undefined : ctx.i18nText(key));
  const badge = (status) => {
    const flag = ctx.statusFlag(status);
    return flag === undefined ? undefined : t(flag.title);
  };
  const controls = [];
  const buttons = [];
  const layout = [];

  function control(row) {
    const c = { key: row.key, label: t(row.title), help: t(row.help), confirm: t(row.confirm),
      badge: badge(row.status) };
    if (row.dropdown !== undefined) {
      c.type = 'enum';
      c.options = row.dropdown.filter((o) => ctx.offeredHere(o.status)).map((o) => ({
        value: o.key, label: t(o.title), group: t(o.group), badge: badge(o.status),
        enables: o.enables && o.enables.length > 0 ? o.enables : undefined,
      }));
    } else if (typeof row.default === 'boolean') {
      c.type = 'bool';
    } else if (typeof row.default === 'number') {
      if (row.min === undefined || row.max === undefined) {
        throw new Error('number row without min/max: ' + row.key);
      }
      // The page's stepper: `step` is the big step, the fine step (1, or a tenth
      // of a scaled unit) is what a value may land on.
      const scale = row.scale || 1;
      const fine = scale > 1 ? Math.max(1, Math.round(scale / 10)) : 1;
      Object.assign(c, { type: 'int', min: row.min, max: row.max, step: fine });
      if ((row.step || 1) !== fine) c.bigStep = row.step;
      if (scale > 1) c.scale = scale;
    } else {
      c.type = 'string';
    }
    return c;
  }

  for (const tab of ctx.tabs) {
    const groups = [];
    for (const group of tab.groups) {
      const items = [];
      for (const row of group.rows) {
        if (!ctx.offeredHere(row.status)) continue;
        const remote = (row.buttons || []).filter((b) => b.remote !== undefined);
        for (const b of remote) {
          if (!buttons.some((x) => x.name === b.remote)) {
            buttons.push({ name: b.remote, label: b.text(), confirm: t(b.confirm), whenRunning: true });
          }
        }
        const button = remote.length > 0 ? remote[0].remote : undefined;
        if (row.key !== undefined && row.default !== undefined) {
          controls.push(control(row));
          items.push({ control: row.key, button: button });
        } else if (button !== undefined) {
          items.push({ button: button, label: t(row.title), help: t(row.help), badge: badge(row.status) });
        }
      }
      if (items.length > 0) {
        groups.push({ label: t(group.title), help: t(group.help), warn: group.warn || undefined, items });
      }
    }
    if (groups.length > 0) layout.push({ id: tab.id, label: t(tab.title), groups });
  }
  const keys = new Set(controls.map((c) => c.key));
  const presetFields = ctx.SHARE_SLOTS.filter((k) => keys.has(k));
  // Through JSON, so every `undefined` above simply drops out.
  return JSON.parse(JSON.stringify({ ui: UI, controls, layout, buttons, presetFields }));
}

/** English text -> `other`'s text, for every text that differs between the two walks. */
function pairTexts(en, other, out) {
  if (typeof en === 'string') {
    if (typeof other === 'string' && other !== en) out[en] = other;
    return;
  }
  if (en === null || typeof en !== 'object' || other === null || typeof other !== 'object') return;
  for (const k of Object.keys(en)) {
    if (!NOT_TEXT.has(k)) pairTexts(en[k], other[k], out);
  }
}

function generate(releaseStatus) {
  const { ctx, store } = loadPage(releaseStatus);
  const locales = ctx.i18nLocales();
  const english = locales[0].tag;
  store.tsumtsumlanguage = english;
  const schema = walk(ctx);
  schema.translations = {};
  for (const loc of locales.slice(1)) {
    store.tsumtsumlanguage = loc.tag;
    const pairs = {};
    pairTexts(schema, walk(ctx), pairs);
    if (Object.keys(pairs).length > 0) schema.translations[loc.tag] = pairs;
  }
  return schema;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const status = Number(argValue(argv, 'channel-status') || 0);
  const out = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))[0]
    || local('dist', 'companionSettings.json');
  const schema = generate(status);
  fs.writeFileSync(out, JSON.stringify(schema));
  console.log(`[companion] ${path.relative(projectDir, out)}: ${schema.controls.length} settings, `
    + `${schema.layout.length} pages, ${schema.buttons.length} buttons, `
    + `languages: ${['en'].concat(Object.keys(schema.translations)).join(', ')}`);
}

module.exports = { generate, UI };
