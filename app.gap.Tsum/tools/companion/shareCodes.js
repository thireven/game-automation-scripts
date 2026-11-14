// Writes build/shareCodes.json: the share-code table (SHARE_SLOTS with each slot's
// kind, default and dropdown `share` ids) and golden cases the settings page
// made, so the Tsum Tsum Stats site can read and write the same codes without
// copying the codec by hand. The site syncs this file and tests against `cases`.
//
//   node tools/companion/shareCodes.js [out]
//
// Runs the built page scripts (build/*.js) in a vm, like settings.js. The
// codec itself stays in src/settings.ts.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadPage } = require('./settings');

const projectDir = path.join(__dirname, '..', '..');
const version = require(path.join(projectDir, 'package.json')).version;
// The version a code's head carries; fixed per release so the cases are stable.
const major = Number.isNaN(parseInt(version, 10)) ? 0 : parseInt(version, 10);

function generate() {
  const { ctx } = loadPage(0);
  // The cases need the page's VERSION; settings.js leaves `$VERSION` unreplaced.
  ctx.VERSION = version;
  const all = ctx.settingsByKey();
  const run = (code) => require('vm').runInContext(code, ctx);

  // One entry per slot, in slot order; a slot this build has no row for is null.
  const slots = ctx.SHARE_SLOTS.map((key) => {
    const s = key ? all[key] : undefined;
    if (!s) return null;
    const d = s.default;
    const kind = typeof d === 'boolean' ? 'bool' : typeof d === 'number' ? 'int' : s.dropdown ? 'enum' : 'string';
    // English labels, for showing a preset; the codec ignores them.
    const slot = { key, kind, default: ctx.SHARE_DEFAULTS[key], label: ctx.i18nText(s.title) };
    if (s.scale > 1) slot.scale = s.scale;
    // The row's range in stored units, so the site can refuse values the page would clamp.
    if (kind === 'int' && typeof s.min === 'number' && typeof s.max === 'number') {
      slot.min = s.min;
      slot.max = s.max;
      if (s.allowZero) slot.allowZero = true;
    }
    if (kind === 'enum') {
      slot.ids = {};
      slot.options = {};
      for (const o of s.dropdown) {
        if (typeof o.share === 'string') slot.ids[o.key] = o.share;
        slot.options[o.key] = ctx.i18nText(o.title);
      }
    }
    return slot;
  });
  const table = { prefix: run('SHARE_PREFIX'), otherPrefix: run('SHARE_PREFIX_PATTERN'),
    suffix: run('SHARE_SUFFIX'), version: major, slots };

  // Golden cases: values -> the page's code -> the page's reading of it.
  const live = slots.filter(Boolean);
  const other = (s) => Object.keys(s.ids).find((v) => v !== s.default);
  const cases = [];
  const add = (name, values) => {
    const full = {};
    for (const s of live) full[s.key] = s.key in values ? values[s.key] : s.default;
    const code = ctx.buildSettingsCode(full);
    cases.push({ name, values, code, decoded: JSON.parse(JSON.stringify(ctx.parseSettingsCode(code).s)) });
  };
  const flip = (s) => (s.kind === 'bool' ? !s.default : s.kind === 'int' ? s.default + 7
    : s.kind === 'enum' ? (other(s) || s.default) : s.default);
  add('defaults', {});
  add('every bool flipped', Object.fromEntries(live.filter((s) => s.kind === 'bool').map((s) => [s.key, !s.default])));
  add('numbers', Object.fromEntries(live.filter((s) => s.kind === 'int').map((s, i) => [s.key, s.default + i + 1])));
  add('enums with ids', Object.fromEntries(live.filter((s) => s.kind === 'enum' && other(s)).map((s) => [s.key, other(s)])));
  // A dropdown value with no `share` id travels raw, escaped.
  const firstEnum = live.find((s) => s.kind === 'enum');
  if (firstEnum) add('raw enum value', { [firstEnum.key]: 'new skill.(x)~ é' });
  add('mixed', Object.fromEntries(live.filter((_, i) => i % 3 === 0).map((s) => [s.key, flip(s)])));

  // `Name: code` lines, as the Export presets row writes them, and what pasting them back reads.
  const full = (over) => Object.assign(Object.fromEntries(live.map((s) => [s.key, s.default])), over);
  const exportText = ctx.presetsExportText([
    { name: 'Coins', values: full({}) },
    { name: 'Burst: fast', values: full(cases[3].values) },
  ]);
  const fromText = JSON.parse(JSON.stringify(ctx.presetsFromText(exportText)
    .map((p) => ({ name: p.name, values: p.values }))));

  return { script: version, table, cases, exportText, fromText };
}

if (require.main === module) {
  const out = process.argv[2] || path.join(projectDir, 'build', 'shareCodes.json');
  const data = generate();
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
  console.log(`[companion] ${path.relative(projectDir, out)}: ${data.table.slots.filter(Boolean).length} slots, `
    + `${data.cases.length} cases`);
}

module.exports = { generate };
