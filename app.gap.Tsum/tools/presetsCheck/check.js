#!/usr/bin/env node
// Checks the GAP Companion preset store (src/gapPresets.ts), Tsum's setup of it
// (src/workflow.ts) and the pages' cache (src/presets.ts) by driving the built
// bundle and build/presets.js in vms.
//
//   npm run presets:check
//
// The contract is GAP Companion's docs/WORKFLOWS.md (two-way presets). Each
// case sets the store up on its own folder and plays the server's part by hand:
// it reads `gapPresetsStore` and answers with a `gapPresetsAdopt`.
//
// Cases: the name rule; the two files (alternate writes, a corrupt newest file,
// both corrupt = store-unreadable, empty files, a failed write); a first load
// from the legacy mirror; put / rename / delete / seed and their `base` rules;
// prevRev (own adopt, then an edit is plain); adopt refusals (wrong-script,
// stale), adopt keeping lids it was not told about as held, `drop`; the
// `gap.presets` event once per changing batch and never on adopt; Tsum's setup
// (device folder, emitEvent, old pages' presetsMirror); the pages' migration,
// marker and refresh.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRuntime } = require('../runtime/load');

const projectDir = path.join(__dirname, '..', '..');
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-presets-check-'));
const { ctx } = createRuntime({ quiet: true, storagePath: storage, build: process.argv.indexOf('--no-build') < 0 });

let failures = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    return;
  }
  failures++;
  console.log('FAIL ' + name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A case that throws (an entry it expected is missing) is a failure, not a crash.
process.on('uncaughtException', (err) => {
  console.log('FAIL (threw) ' + String(err && err.stack).split('\n').slice(0, 2).join(' '));
  console.log('presets:check: ' + passed + ' passed, ' + (failures + 1) + ' failed');
  process.exit(1);
});

// --- Tsum's setup, before any case replaces it ---------------------------------
// The bundle set the store up at load; nothing has read it yet, so the paths
// and the legacy mirror are resolved now.
const scriptDir = path.join(storage, 'script');
fs.mkdirSync(scriptDir, { recursive: true });
ctx.getScriptPath = () => scriptDir;
fs.writeFileSync(path.join(scriptDir, 'presets-' + ctx.getDeviceId() + '.json'),
  JSON.stringify([{ name: 'Mirror', values: { skillLevel: 2 } }]));
const emitted = [];
ctx.emitEvent = (name, data) => { emitted.push({ name, data: JSON.parse(JSON.stringify(data)) }); };
let tsum = JSON.parse(ctx.gapPresetsStore());
const deviceFile = path.join(ctx.getDevicePath(), 'presets-app.gap.Tsum.json');
check('tsum: the store is in the device folder', fs.existsSync(deviceFile), deviceFile);
check('tsum: a new store starts from the old mirror',
  tsum.presets.length === 1 && tsum.presets[0].name === 'Mirror' && tsum.presets[0].dirty === true
  && tsum.presets[0].id === undefined, tsum);
ctx.presetsMirror(JSON.stringify([{ name: 'A', values: { skillLevel: 3, bad: { x: 1 } } }, { nope: 1 }]));
check('tsum: an old page\'s presetsMirror is a seed',
  ctx.gapPresetsLocal() === JSON.stringify([{ name: 'A', values: { skillLevel: 3 } },
    { name: 'Mirror', values: { skillLevel: 2 } }]), ctx.gapPresetsLocal());
check('tsum: gap.presets through emitEvent, with the script id',
  emitted.length === 1 && emitted[0].name === 'gap.presets' && same(emitted[0].data, { script: 'app.gap.Tsum' }),
  emitted);

// --- The cases' own setup -----------------------------------------------------------
let dir = '';
let n = 0;
let events = [];
let warned = [];
function setup() {
  ctx.gapPresetsSetup({
    script: 'app.gap.Tsum',
    path: () => path.join(dir, 'presets.json'),
    legacyPath: () => path.join(dir, 'legacy.json'),
    emit: (name, data) => { events.push({ name, data }); },
    warn: (message, data) => { warned.push({ message, data }); },
  });
}
/** A new folder and a store with nothing in it yet. */
function fresh(legacy) {
  dir = path.join(storage, 'case' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  if (legacy !== undefined) {
    fs.writeFileSync(path.join(dir, 'legacy.json'), typeof legacy === 'string' ? legacy : JSON.stringify(legacy));
  }
  events = [];
  warned = [];
  setup();
}
const file = (bak) => path.join(dir, bak ? 'presets.bak.json' : 'presets.json');
const readFile = (bak) => { try { return JSON.parse(fs.readFileSync(file(bak), 'utf8')); } catch (e) { return {}; } };
const store = () => JSON.parse(ctx.gapPresetsStore());
const apply = (...ops) => JSON.parse(ctx.gapPresetsApply(JSON.stringify({ ops })));
const adoptRaw = (a) => JSON.parse(ctx.gapPresetsAdopt(JSON.stringify(a)));
const entry = (name) => store().presets.filter((e) => e.name === name)[0];
const put = (name, values, base) => apply({ op: 'put', name, values, base: base === undefined ? null : base });
const baseOf = (e) => ({ lid: e.lid, rev: e.rev === undefined ? null : e.rev });
let nextId = 0;
/**
 * The server's part: adopts `presets` (account presets) onto the store as it
 * stands. `mapped` maps lid -> {id, mine}; unspecified dirty entries get ids.
 */
function adopt(presets, opts) {
  const o = opts || {};
  const s = store();
  return adoptRaw(Object.assign({
    script: 'app.gap.Tsum', instance: s.instance, ver: s.ver, scope: 'scope-1', hash: 'hash-1',
    presets: presets.map((p) => Object.assign({ script: 'app.gap.Tsum', updatedAt: '2026-11-03T00:00:00.000Z' }, p)),
    map: o.map || {}, held: o.held || [], drop: o.drop || [],
  }, o.extra || {}));
}
/** Syncs every entry as the server would with no one else writing: ids made, revs bumped, all `mine`. */
function syncAll() {
  const s = store();
  const presets = [];
  const map = {};
  for (const e of s.presets) {
    const id = e.id || 'ps_' + String(++nextId).padStart(16, '0');
    const rev = e.id === undefined ? 1 : (e.dirty ? e.rev + 1 : e.rev);
    presets.push({ id, rev, name: e.name, values: e.values });
    map[e.lid] = { id, mine: e.dirty === true };
  }
  return adopt(presets, { map });
}

// --- The name rule (the fixture GAP Companion's phone and web share) ----------------
const clean = [
  ['  Ariel   coins ', 'Ariel coins'], ['Tab\there\nand there', 'Tab here and there'],
  ['No break　wide thin', 'No break wide thin'], ['﻿Marked', 'Marked'], [' \t\n ', ''],
  ['a'.repeat(41), 'a'.repeat(40)], ['  ' + 'b'.repeat(45), 'b'.repeat(40)],
  ['Max  ' + 'c'.repeat(40), 'Max ' + 'c'.repeat(36)],
];
for (const [raw, want] of clean) {
  check('name: clean ' + JSON.stringify(raw), ctx.gapPresetsCleanName(raw) === want, ctx.gapPresetsCleanName(raw));
}
check('name: a cut after a space drops it, so cleaning twice is the same',
  ctx.gapPresetsCleanName('x'.repeat(39) + ' yy') === 'x'.repeat(39));
check('name: keys ignore case and spacing', ctx.gapPresetsKey('  ariel   COINS ') === ctx.gapPresetsKey('Ariel coins')
  && ctx.gapPresetsKey('Ärger') === ctx.gapPresetsKey('ärger') && ctx.gapPresetsKey('Fast') !== ctx.gapPresetsKey('Fast 2'));
const takenOf = (names) => { const t = {}; for (const x of names) t[ctx.gapPresetsKey(x)] = true; return t; };
for (const [name, taken, want] of [['New preset', [], 'New preset'], ['New preset', ['new  PRESET'], 'New preset 2'],
  ['New preset', ['New preset', 'new preset 2'], 'New preset 3'], ['d'.repeat(40), ['d'.repeat(40)], 'd'.repeat(38) + ' 2'],
  ['constructor', [], 'constructor']]) {
  const got = ctx.gapPresetsFreeName(name, takenOf(taken));
  check('name: free ' + name + ' past ' + JSON.stringify(taken), got === want, got);
}

// --- The two files ------------------------------------------------------------------
fresh();
let s = store();
check('files: a new store', /^[a-z0-9]{16}$/.test(s.instance) && s.ver === 1 && s.scope === null && s.hash === null
  && same(s.presets, []) && same(s.deleted, []), s);
check('files: written at once, to the first file', readFile(false).ver === 1
  && !fs.existsSync(file(true)));
put('One', { skillLevel: 1 });
check('files: the next write goes to the other file', readFile(true).ver === 2 && readFile(false).ver === 1);
put('Two', { skillLevel: 2 });
check('files: and back', readFile(false).ver === 3 && readFile(true).ver === 2);
fs.writeFileSync(file(false), '{"instance": "x", "ver": 3, "pres');
setup();
s = store();
check('files: a torn newest file -> the older one', s.ver === 2 && s.presets.length === 1 && s.presets[0].name === 'One', s);
put('Three', { skillLevel: 3 });
check('files: the write after goes over the torn file', readFile(false).ver === 3 && readFile(true).ver === 2);
fs.writeFileSync(file(false), 'not json');
fs.writeFileSync(file(true), '[]');
setup();
events = [];
const unreadable = [ctx.gapPresetsStore(), ctx.gapPresetsLocal()].map((x) => JSON.parse(x));
check('files: both unreadable -> store and local say store-unreadable',
  unreadable.every((x) => x.error === 'store-unreadable'), unreadable);
check('files: both unreadable -> read, apply and adopt refuse',
  JSON.parse(ctx.gapPresetsRead()).error === 'store-unreadable'
  && put('Four', { skillLevel: 4 }).error === 'store-unreadable'
  && adoptRaw({ script: 'app.gap.Tsum', instance: 'x', ver: 3, presets: [] }).error === 'store-unreadable');
check('files: both unreadable -> nothing written over them, nothing emitted',
  fs.readFileSync(file(false), 'utf8') === 'not json' && fs.readFileSync(file(true), 'utf8') === '[]'
  && events.length === 0 && ctx.gapPresetsPending() === false);
fs.writeFileSync(file(false), '');
fs.writeFileSync(file(true), '');
setup();
s = store();
check('files: two empty files count as missing (a new store)', s.ver === 1 && s.presets.length === 0, s);

fresh();
put('Kept', { skillLevel: 1 });
const realWrite = ctx.writeFile;
ctx.writeFile = () => { throw new Error('disk full'); };
events = [];
const failed = put('Lost', { skillLevel: 2 });
ctx.writeFile = realWrite;
s = store();
check('files: a failed write is not-saved, and changes nothing', failed.ok === false && failed.error === 'not-saved'
  && s.ver === 2 && entry('Lost') === undefined && events.length === 0, { failed, s });
check('files: a failed write is reported through warn', warned.length === 1 && /disk full/.test(warned[0].data.errorText), warned);

// --- First load from the legacy mirror -----------------------------------------------
fresh([{ name: '  Fast  run ', values: { skillLevel: 3, bad: { x: 1 } } }, { nope: 1 },
  { name: 'fast RUN', values: { skillLevel: 9 } }, { name: 'Slow', values: { skillLevel: 1 } }]);
s = store();
check('legacy: entries without ids, dirty, scalar values, one per name (the last one\'s values)',
  s.presets.length === 2 && s.presets[0].name === 'Fast run' && same(s.presets[0].values, { skillLevel: 9 })
  && s.presets.every((e) => e.dirty === true && e.id === undefined && /^[a-z0-9]{12}$/.test(e.lid)), s);
check('legacy: pending until synced', ctx.gapPresetsPending() === true);
fresh('this is not a list');
check('legacy: an unreadable mirror starts an empty store', store().presets.length === 0);

// --- put ---------------------------------------------------------------------------------
fresh();
events = [];
let r = put('  My   preset ', { skillLevel: 4, gone: null });
let e = entry('My preset');
check('put: a new entry', r.ok === true && r.results[0].ok === true && r.results[0].lid === e.lid
  && e.dirty === true && e.id === undefined && same(e.values, { skillLevel: 4 }), { r, e });
check('put: one event for the batch', events.length === 1 && events[0].name === 'gap.presets'
  && same(events[0].data, { script: 'app.gap.Tsum' }), events);
check('put: the view shows lid, name, values (no dirty)', r.ver === 2 && same(Object.keys(r.presets[0]).sort(),
  ['lid', 'name', 'values']), r.presets);
put('MY PRESET', { skillLevel: 5 });
check('put: the same name in another case is the same entry, spelt as typed',
  store().presets.length === 1 && entry('MY PRESET').lid === e.lid && entry('MY PRESET').values.skillLevel === 5);
syncAll();
e = entry('MY PRESET');
check('sync: the adopted entry is clean, with id and rev', e.dirty === undefined && e.id !== undefined && e.rev === 1
  && ctx.gapPresetsPending() === false, e);
put('MY PRESET', { skillLevel: 6 }, baseOf(e));
let after = entry('MY PRESET');
check('put: base as stored -> a plain update (rev kept)', after.rev === 1 && after.dirty === true && after.id === e.id, after);
syncAll();
e = entry('MY PRESET');
put('MY PRESET', { skillLevel: 7 }, { lid: e.lid, rev: 0 });
check('put: an older base -> rev set back to it, so the server keeps both', entry('MY PRESET').rev === 0);
syncAll();
e = entry('MY PRESET');
put('my preset', { skillLevel: 8 }, null);
check('put: over a synced name the page never saw -> rev 0', entry('my preset').rev === 0 && entry('my preset').id === e.id);
syncAll();
e = entry('my preset');
put('my preset', { skillLevel: 9 }, { lid: 'gonegonegone', rev: e.rev });
check('put: a base lid that is gone -> by name, rev 0', entry('my preset').rev === 0);

fresh();
put('A', { v: 1 });
put('B', { v: 2 });
s = store();
r = put('B', { v: 3 }, baseOf(s.presets[0]));
check('put: renaming A onto B through its base -> name-taken', r.results[0].ok === false
  && r.results[0].error === 'name-taken' && entry('A').values.v === 1 && entry('B').values.v === 2, r.results);

// Full: 32 entries, held ones included.
fresh();
const many = [];
for (let i = 0; i < 31; i++) many.push({ op: 'put', name: 'P' + i, values: { v: i }, base: null });
apply(...many);
syncAll();
// One more local entry the account had no room for: held.
put('Local', { v: 99 });
adopt(store().presets.filter((x) => x.id !== undefined).map((x) => ({ id: x.id, rev: x.rev, name: x.name, values: x.values })), {
  map: Object.fromEntries(store().presets.filter((x) => x.id !== undefined).map((x) => [x.lid, { id: x.id, mine: false }])),
  held: [{ lid: entry('Local').lid, why: 'full', name: 'Local' }],
});
check('full: the held entry counts', store().presets.length === 32 && entry('Local').held.why === 'full');
events = [];
r = put('P32', { v: 32 });
check('full: a 33rd new name is refused, nothing emitted', r.results[0].ok === false && r.results[0].error === 'full'
  && store().presets.length === 32 && events.length === 0, r.results);
r = put('P3', { v: 33 }, baseOf(entry('P3')));
check('full: an update still goes', r.results[0].ok === true && entry('P3').values.v === 33);

// --- delete, and a save after it ----------------------------------------------------------
fresh();
put('Local only', { v: 1 });
put('Synced', { v: 2 });
syncAll();
put('Local only 2', { v: 3 });
s = store();
r = apply({ op: 'delete', lid: entry('Local only 2').lid, base: null });
check('delete: an entry the server never had leaves no tombstone', entry('Local only 2') === undefined
  && same(store().deleted, []));
e = entry('Synced');
apply({ op: 'delete', lid: e.lid, base: baseOf(e) });
check('delete: base as stored -> tombstone at its rev', same(store().deleted, [{ id: e.id, rev: e.rev, name: 'Synced' }]));
check('delete: pending', ctx.gapPresetsPending() === true);
put('synced', { v: 5 });
after = entry('synced');
check('put: after a delete, the same name is that id again', after.id === e.id && after.rev === e.rev
  && same(store().deleted, []) && after.lid !== e.lid, { after, deleted: store().deleted });
syncAll();
e = entry('synced');
apply({ op: 'delete', lid: e.lid, base: { lid: e.lid, rev: 0 } });
check('delete: a stale base -> tombstone at the base rev, so a newer edit wins',
  same(store().deleted, [{ id: e.id, rev: 0, name: 'synced' }]), store().deleted);
const ver = store().ver;
events = [];
r = apply({ op: 'delete', lid: 'nosuchentry0', base: null });
check('delete: a missing lid is ok and changes nothing', r.results[0].ok === true && store().ver === ver
  && events.length === 0);

// --- rename ----------------------------------------------------------------------------
fresh();
put('Old name', { v: 1 });
put('Other', { v: 2 });
syncAll();
e = entry('Old name');
r = apply({ op: 'rename', lid: e.lid, name: '  New   name ', base: baseOf(e) });
after = entry('New name');
check('rename: keeps lid and id, plain with its base', r.results[0].ok === true && after.lid === e.lid
  && after.id === e.id && after.rev === e.rev && after.dirty === true, after);
check('rename: to a taken name -> name-taken',
  apply({ op: 'rename', lid: e.lid, name: 'OTHER', base: baseOf(after) }).results[0].error === 'name-taken');
check('rename: a missing lid -> gone',
  apply({ op: 'rename', lid: 'nosuchentry0', name: 'X', base: null }).results[0].error === 'gone');
r = apply({ op: 'rename', lid: e.lid, name: 'NEW NAME', base: baseOf(after) });
check('rename: another case of its own name is fine', r.results[0].ok === true && entry('NEW NAME').lid === e.lid);
syncAll();
e = entry('NEW NAME');
apply({ op: 'rename', lid: e.lid, name: 'Newer', base: { lid: e.lid, rev: 0 } });
check('rename: a stale base sets rev back', entry('Newer').rev === 0);

// --- prevRev: our own write landing does not make the next edit a conflict ---------------
fresh();
put('Mine', { v: 1 });
const unsynced = baseOf(entry('Mine'));   // {lid, rev: null}: what the page saw
syncAll();
e = entry('Mine');
check('prevRev: our create landed -> prevRev null', e.prevRev === null && e.rev === 1, e);
put('Mine', { v: 2 }, unsynced);
after = entry('Mine');
check('prevRev: an edit from the page\'s older copy is plain', after.rev === 1 && after.prevRev === undefined, after);
const seen = baseOf(after);               // rev 1
syncAll();                                // our edit lands: rev 2, prevRev 1
e = entry('Mine');
check('prevRev: our edit landed -> prevRev is the rev before it', e.rev === 2 && e.prevRev === 1, e);
adopt([{ id: e.id, rev: 2, name: 'Mine', values: e.values }], { map: { [e.lid]: { id: e.id, mine: false } } });
check('prevRev: an adopt that leaves the rev alone keeps it', entry('Mine').prevRev === 1);
put('Mine', { v: 3 }, seen);
check('prevRev: the page\'s base at prevRev is plain', entry('Mine').rev === 2);
syncAll();
e = entry('Mine');
adopt([{ id: e.id, rev: 4, name: 'Mine', values: { v: 9 } }], { map: { [e.lid]: { id: e.id, mine: false } } });
check('prevRev: someone else\'s edit drops it', entry('Mine').prevRev === undefined && entry('Mine').rev === 4);
put('Mine', { v: 4 }, { lid: e.lid, rev: 3 });
check('prevRev: then the old base is a conflict', entry('Mine').rev === 3);

// --- seed (the pages' migration) ---------------------------------------------------------
fresh();
put('Same', { a: 1, b: true });
put('Synced', { a: 1 });
syncAll();
events = [];
let v0 = store().ver;
r = apply({ op: 'seed', presets: [{ name: 'same', values: { b: true, a: 1 } }, { name: 'Synced', values: { a: 1 } }] });
check('seed: the same values (any order, any case) change nothing', store().ver === v0 && events.length === 0
  && entry('Same').dirty === undefined);
apply({ op: 'seed', presets: [{ name: 'Same', values: { a: 1 } }] });
check('seed: a key missing is different values -> rev 0, dirty', entry('Same').rev === 0 && entry('Same').dirty === true
  && same(entry('Same').values, { a: 1 }));
events = [];
const seedMany = [];
for (let i = 0; i < 40; i++) seedMany.push({ name: 'S' + i, values: { v: i } });
r = apply({ op: 'seed', presets: seedMany });
check('seed: new names are added, never refused for count, one event', store().presets.length === 42
  && entry('S39').dirty === true && entry('S39').id === undefined && events.length === 1);
v0 = store().ver;
apply({ op: 'seed', presets: seedMany });
check('seed: twice is a no-op', store().ver === v0);

// --- A batch ---------------------------------------------------------------------------
fresh();
events = [];
v0 = store().ver;
r = apply({ op: 'put', name: 'X', values: { v: 1 }, base: null }, { op: 'put', name: 'Y', values: { v: 2 }, base: null },
  { op: 'nope' }, { op: 'delete', lid: 'nosuchentry0', base: null });
check('batch: ops on their own, one ver, one event', r.ok === true && r.ver === v0 + 1 && events.length === 1
  && same(r.results.map((x) => x.ok), [true, true, false, true]) && r.results[2].error === 'bad-op', r);
check('batch: bad json -> bad-ops', JSON.parse(ctx.gapPresetsApply('{')).error === 'bad-ops');

// --- read ----------------------------------------------------------------------------------
s = store();
check('read: the view', same(JSON.parse(ctx.gapPresetsRead()).presets.map((x) => x.name), ['X', 'Y']));
check('read: the page\'s copy current -> same', JSON.parse(ctx.gapPresetsRead(JSON.stringify({ instance: s.instance, ver: s.ver }))).same === true);
check('read: an older copy -> the list', JSON.parse(ctx.gapPresetsRead(JSON.stringify({ instance: s.instance, ver: s.ver - 1 }))).presets.length === 2);
check('local: [{name, values}]', ctx.gapPresetsLocal() === JSON.stringify([{ name: 'X', values: { v: 1 } }, { name: 'Y', values: { v: 2 } }]));

// --- adopt ---------------------------------------------------------------------------------
fresh();
put('Alpha', { v: 1 });
put('Beta', { v: 2 });
put('Gamma', { v: 3 });
put('Delta', { v: 4 });
s = store();
const lid = (name) => s.presets.filter((x) => x.name === name)[0].lid;
check('adopt: another script -> wrong-script', adopt([], { extra: { script: 'app.gap.Other' } }).error === 'wrong-script');
check('adopt: another ver -> stale', adopt([], { extra: { ver: s.ver - 1 } }).error === 'stale');
check('adopt: another instance -> stale', adopt([], { extra: { instance: 'zzzzzzzzzzzzzzzz' } }).error === 'stale');
check('adopt: not one -> bad-adopt', JSON.parse(ctx.gapPresetsAdopt('[]')).error === 'bad-adopt');
check('adopt: a refusal changes nothing', store().ver === s.ver);
put('Gamma', { v: 30 }, baseOf(s.presets.filter((x) => x.name === 'Gamma')[0]));
check('adopt: a page change since the read -> stale', adopt([], { extra: { ver: s.ver } }).error === 'stale');
s = store();
events = [];
r = adopt([
  { id: 'ps_alpha', rev: 1, name: 'Alpha', values: { v: 1 } },
  { id: 'ps_other', rev: 5, name: 'From the phone', values: { v: 7 } },
  { id: 'ps_held_dup', rev: 2, name: 'Delta', values: { v: 40 } },
], {
  map: { [lid('Alpha')]: { id: 'ps_alpha', mine: true } },
  held: [{ lid: lid('Beta'), why: 'too-large', name: 'Beta (Pixel)' }],
  drop: [],
  extra: { scope: 'scope-2', hash: 'hash-2' },
});
after = store();
check('adopt: ok, ver+1, scope and hash, tombstones cleared, no event', r.ok === true && after.ver === s.ver + 1
  && after.scope === 'scope-2' && after.hash === 'hash-2' && same(after.deleted, []) && events.length === 0, { r, after });
check('adopt: a mapped preset keeps its lid, clean', entry('Alpha').lid === lid('Alpha') && entry('Alpha').id === 'ps_alpha'
  && entry('Alpha').dirty === undefined && entry('Alpha').prevRev === null);
check('adopt: an account preset nobody mapped gets a new lid', entry('From the phone') !== undefined
  && [lid('Alpha'), lid('Beta'), lid('Gamma'), lid('Delta')].indexOf(entry('From the phone').lid) < 0);
check('adopt: a held lid takes the server\'s name and why, dirty, no id',
  entry('Beta (Pixel)').lid === lid('Beta') && entry('Beta (Pixel)').held.why === 'too-large'
  && entry('Beta (Pixel)').dirty === true && entry('Beta (Pixel)').id === undefined);
check('adopt: a lid the server did not name is kept, held full', entry('Gamma').lid === lid('Gamma')
  && entry('Gamma').held.why === 'full' && same(entry('Gamma').values, { v: 30 }));
check('adopt: a kept name another preset now has is made free', entry('Delta').id === 'ps_held_dup'
  && entry('Delta 2') !== undefined && entry('Delta 2').lid === lid('Delta') && entry('Delta 2').held.why === 'full');
check('adopt: held entries are not pending', ctx.gapPresetsPending() === false);
s = store();
adopt([{ id: 'ps_alpha', rev: 1, name: 'Alpha', values: { v: 1 } }], {
  map: { [entry('Alpha').lid]: { id: 'ps_alpha', mine: false } },
  drop: [entry('From the phone').lid, entry('Delta').lid],
});
check('adopt: drop removes only what it names', entry('From the phone') === undefined && entry('Delta') === undefined
  && entry('Gamma') !== undefined && entry('Beta (Pixel)') !== undefined && entry('Delta 2') !== undefined);
check('adopt: the unchanged entry keeps its prevRev', entry('Alpha').prevRev === null);
const beforeReload = store();
setup();
check('adopt: survives a reload', same(store(), beforeReload) && entry('Alpha').id === 'ps_alpha');

// --- The pages' cache (build/presets.js) -----------------------------------------------
function page() {
  const local = {};
  const broadcasts = [];
  const changes = [];
  const p = {
    console,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null),
      setItem: (k, v) => { local[k] = String(v); },
      removeItem: (k) => { delete local[k]; },
    },
    JavaScriptInterface: {
      // The host evaluates in the engine and calls back with the string answer.
      runScriptCallback: (code, callback) => {
        let result = '';
        try { result = String(vm.runInContext(code, ctx)); } catch (err) { result = ''; }
        p[callback](result);
      },
      broadcast: (topic) => { broadcasts.push(topic); },
    },
  };
  vm.createContext(p);
  vm.runInContext(fs.readFileSync(path.join(projectDir, 'build', 'presets.js'), 'utf8'), p);
  vm.runInContext('presetsOnChange = function () { changed(); };', Object.assign(p, { changed: () => changes.push(1) }));
  return { p, local, broadcasts, changes };
}
fresh();
const pg = page();
const oldList = JSON.stringify([{ name: 'Old', values: { skillLevel: 2 } }, { name: 'Two', values: { skillLevel: 3 } }]);
pg.local.tsumtsumpresets = oldList;
pg.p.presetsRefresh();
let cache = JSON.parse(pg.local.tsumtsumpresets);
let mark = JSON.parse(pg.local.tsumtsumpresetsmark || 'null');
check('page: an unmarked cache is seeded into the engine', store().presets.length === 2 && entry('Old').dirty === true);
check('page: then the cache is the engine\'s, with lids', cache.length === 2 && cache.every((x) => /^[a-z0-9]{12}$/.test(x.lid)), cache);
check('page: the marker after the reply', mark !== null && mark.instance === store().instance && mark.ver === store().ver
  && mark.sum === pg.p.presetsSum(pg.local.tsumtsumpresets), mark);
check('page: the old list copied once', pg.local.tsumtsumpresetslegacy === oldList);
check('page: the other page told once, this one redrawn', same(pg.broadcasts, ['presets']) && pg.changes.length === 1, pg.broadcasts);
pg.p.presetsRefresh();
check('page: a current cache reads `same` and stays quiet', pg.broadcasts.length === 1 && pg.changes.length === 1);
syncAll();
pg.p.presetsRefresh();
cache = JSON.parse(pg.local.tsumtsumpresets);
check('page: a sync is picked up on the next refresh', cache.every((x) => typeof x.id === 'string' && x.rev === 1)
  && pg.broadcasts.length === 2, cache);
let reply = null;
const loaded = pg.p.presetsLoad();
pg.p.presetsSubmit([{ op: 'put', name: 'Old', values: { skillLevel: 5 }, base: pg.p.presetBase(loaded[0]) }],
  (x) => { reply = x; });
check('page: submit answers with results, writes the cache', reply !== null && reply.results[0].ok === true
  && pg.p.presetsLoad().filter((x) => x.name === 'Old')[0].values.skillLevel === 5 && entry('Old').rev === 1, reply);
// A GAP Restore (or a 5.0 session) writes an older list under the page.
pg.local.tsumtsumpresets = JSON.stringify([{ name: 'Old', values: { skillLevel: 2 } }, { name: 'Gone', values: { skillLevel: 1 } }]);
pg.p.presetsRefresh();
check('page: a rewritten list is merged in by name (rev 0 copy, new name added)', entry('Old').rev === 0
  && entry('Old').values.skillLevel === 2 && entry('Gone') !== undefined && entry('Two') !== undefined);
check('page: the legacy copy is not overwritten', pg.local.tsumtsumpresetslegacy === oldList);
const before = pg.local.tsumtsumpresets;
const beforeMark = pg.local.tsumtsumpresetsmark;
const stale = JSON.parse(beforeMark);
check('page: an older reply for the same store is not written', pg.p.presetsTake({ ok: true, instance: stale.instance,
  ver: stale.ver - 1, presets: [] }, false) === false && pg.local.tsumtsumpresets === before);
// No engine: the call answers '' and nothing is saved.
const realApply = ctx.gapPresetsApply;
vm.runInContext('var keptApply = gapPresetsApply; gapPresetsApply = undefined;', ctx);
reply = 'unset';
pg.p.presetsSubmit([{ op: 'put', name: 'New', values: { v: 1 }, base: null }], (x) => { reply = x; });
vm.runInContext('gapPresetsApply = keptApply;', ctx);
check('page: no engine -> null (not saved), cache untouched', reply === null && pg.local.tsumtsumpresets === before
  && pg.local.tsumtsumpresetsmark === beforeMark && ctx.gapPresetsApply === realApply);
// presetsLoad keeps the sync fields and is not capped; presetMatchName skips keys the form lacks.
const big = [];
for (let i = 0; i < 34; i++) big.push({ lid: 'l' + i, id: 'ps_' + i, rev: i, name: 'N' + i, values: { a: i }, held: i > 31 ? { why: 'full' } : undefined });
pg.local.tsumtsumpresets = JSON.stringify(big);
const loadedBig = pg.p.presetsLoad();
check('page: presetsLoad keeps lid, id, rev and held, uncapped', loadedBig.length === 34
  && loadedBig.filter((x) => x.name === 'N33')[0].held.why === 'full' && loadedBig[0].lid === 'l0' && loadedBig[0].rev === 0);
check('page: presetMatchName skips keys the form lacks',
  pg.p.presetMatchName([{ name: 'P', values: { a: 1, autoSkillLevel: true } }], { a: 1 }) === 'P'
  && pg.p.presetMatchName([{ name: 'P', values: { a: 1 } }], { a: 2 }) === '');

fs.rmSync(storage, { recursive: true, force: true });
console.log('presets:check: ' + passed + ' passed, ' + failures + ' failed');
process.exit(failures === 0 ? 0 : 1);
