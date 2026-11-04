// GAP Companion preset store -- generic, for any GAP script.
//
// **Vendor this file verbatim**, as src/gapWorkflow.ts: copy it into another
// script's `src/`, list it before that script's own code in tsconfig, call
// `gapPresetsSetup` once at load, and add its globals to the minifier's keep
// list. It references nothing outside itself and no game; `readFile` and
// `writeFile` are looked up on `globalThis`. The contract is GAP Companion's
// docs/WORKFLOWS.md (two-way presets) and cloud/adapters/README.md.
//
// The device's own preset list lives here, in the engine world, as one file
// per script (setup's `path`, under the device folder so a script update
// keeps it). Pages keep a cache and change the list only through ops
// (`gapPresetsApply`); GAP Companion's adapter reads the store
// (`gapPresetsStore`) and replaces it with the account's merged list
// (`gapPresetsAdopt`). The server merges; this side only tracks what changed.
//
// Two files, written in turn (`x.json`, `x.bak.json`): `writeFile` truncates
// before it writes and there is no rename, so a kill mid-write leaves the other
// file whole. A load takes the valid one with the higher `ver`. When a file has
// text but neither parses, every global answers `store-unreadable` and nothing
// is written over them. An empty file holds nothing to keep (a kill during the
// very first write), so it counts as missing.
//
// Top-level `function` declarations only, so the adapter's
// `typeof globalThis[name] === 'function'` check sees them. Complex values
// cross the bridge as JSON strings. The JS world runs under one lock, so no two
// calls here interleave.

/** Longest preset name, the contract's name rule. */
const GAP_PRESETS_NAME_MAX = 40;
/** Most entries a page may create (held ones count); seeds and adopts may pass it. */
const GAP_PRESETS_MAX = 32;
/** Local ids and store instances: `[a-z0-9]`. */
const GAP_PRESETS_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

type GapPresetsScalar = string | number | boolean;
type GapPresetsValues = { [key: string]: GapPresetsScalar };

/** Why the server kept an entry on this device only: `full`, `empty` or `too-large`. */
interface GapPresetsHeld {
  why: string;
}

interface GapPresetsEntry {
  /** Local id, stable for the entry's life on this device. */
  lid: string;
  name: string;
  values: GapPresetsValues;
  /** The account's id and rev, once the server has it. */
  id?: string;
  rev?: number;
  /** The rev before this device's own last write was adopted; null when that write created it. */
  prevRev?: number | null;
  /** Changed here since the last adopt. */
  dirty?: true;
  held?: GapPresetsHeld;
}

/** A deleted entry the server still has to hear about. */
interface GapPresetsTomb {
  id: string;
  rev: number;
  name: string;
}

interface GapPresetsFile {
  instance: string;
  ver: number;
  /** The account+script the last adopt came from; a relinked device then counts as new. */
  scope: string | null;
  /** The account presets hash last adopted. */
  hash: string | null;
  presets: GapPresetsEntry[];
  deleted: GapPresetsTomb[];
}

/** What the page sends to say which copy it changed: the entry and the rev it saw. */
interface GapPresetsBase {
  lid: string;
  rev: number | null;
}

interface GapPresetsConf {
  /** The script id; an adopt for another script is refused. */
  script: string;
  /** The store file (`.json`); resolved at each load, '' when there is nowhere to keep it. */
  path: () => string;
  /** An older `[{name, values}]` list a new store starts from, once. */
  legacyPath?: () => string;
  /** Sends one script event; `gap.presets` after a page change. */
  emit: (name: string, data: { [key: string]: unknown }) => void;
  /** Told when the store could not be written. */
  warn?: (message: string, data: { [key: string]: unknown }) => void;
}

/** One op's answer, in order: the entry it touched, or why it was refused. */
interface GapPresetsOpResult {
  ok: boolean;
  lid?: string;
  error?: string;
}

let gapPresetsConf: GapPresetsConf | null = null;
/** The store as last read or written, and which file holds it (-1: neither yet). */
let gapPresetsLoaded: { store: GapPresetsFile; from: number } | null = null;

/** Sets the script's hooks; also forgets the loaded store, so the next call reads the files. */
function gapPresetsSetup(conf: GapPresetsConf): void {
  gapPresetsConf = conf;
  gapPresetsLoaded = null;
}

function gapPresetsConfOf(): GapPresetsConf {
  if (gapPresetsConf === null) {
    throw new Error('gapPresetsSetup was not called');
  }
  return gapPresetsConf;
}

// --- Names and values ---------------------------------------------------------

/**
 * The contract's name rule: whitespace collapsed, trimmed, at most 40. A cut
 * that lands after a space drops it too, so cleaning twice changes nothing.
 */
function gapPresetsCleanName(raw: unknown): string {
  const name = String(raw === undefined || raw === null ? '' : raw).replace(/\s+/g, ' ').trim();
  return name.length > GAP_PRESETS_NAME_MAX ? name.substring(0, GAP_PRESETS_NAME_MAX).trimEnd() : name;
}

/** Names compare by this: the cleaned name, lowercased. */
function gapPresetsKey(name: string): string {
  return gapPresetsCleanName(name).toLowerCase();
}

/** `name`, or `name 2`, `name 3`... cut to fit, the first whose key is not taken (as the server's). */
function gapPresetsFreeName(name: string, taken: { [key: string]: boolean }): string {
  const isTaken = function(n: string) { return Object.prototype.hasOwnProperty.call(taken, gapPresetsKey(n)); };
  const base = gapPresetsCleanName(name) || 'Preset';
  if (!isTaken(base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    const suffix = ' ' + i;
    const candidate = base.substring(0, GAP_PRESETS_NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
}

function gapPresetsIsObject(v: unknown): v is { [key: string]: unknown } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The scalar values of `raw`; null when it is not an object. */
function gapPresetsValuesOf(raw: unknown): GapPresetsValues | null {
  if (!gapPresetsIsObject(raw)) {
    return null;
  }
  const out: GapPresetsValues = {};
  for (const key in raw) {
    const v = raw[key];
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) {
      out[key] = v;
    }
  }
  return out;
}

/** Same keys both ways, each value strictly equal. */
function gapPresetsSameValues(a: GapPresetsValues, b: GapPresetsValues): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (let i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, keys[i]) || a[keys[i]] !== b[keys[i]]) {
      return false;
    }
  }
  return true;
}

function gapPresetsRandom(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += GAP_PRESETS_CHARS.charAt(Math.floor(Math.random() * GAP_PRESETS_CHARS.length));
  }
  return out;
}

/** A local id no entry in `presets` has. */
function gapPresetsNewLid(presets: GapPresetsEntry[]): string {
  for (;;) {
    const lid = gapPresetsRandom(12);
    if (gapPresetsByLid(presets, lid) === undefined) {
      return lid;
    }
  }
}

function gapPresetsByLid(presets: GapPresetsEntry[], lid: unknown): GapPresetsEntry | undefined {
  for (let i = 0; i < presets.length; i++) {
    if (presets[i].lid === lid) {
      return presets[i];
    }
  }
  return undefined;
}

function gapPresetsByKey(presets: GapPresetsEntry[], key: string): GapPresetsEntry | undefined {
  for (let i = 0; i < presets.length; i++) {
    if (gapPresetsKey(presets[i].name) === key) {
      return presets[i];
    }
  }
  return undefined;
}

function gapPresetsSort(presets: GapPresetsEntry[]): void {
  presets.sort(function(a, b) {
    const left = gapPresetsKey(a.name);
    const right = gapPresetsKey(b.name);
    return left < right ? -1 : (left > right ? 1 : 0);
  });
}

// --- The two files --------------------------------------------------------------

/** A host native by name, or null when this engine lacks it. */
function gapPresetsNative(name: 'readFile' | 'writeFile'): ((...args: string[]) => unknown) | null {
  const fn = (globalThis as unknown as { [key: string]: unknown })[name];
  return typeof fn === 'function' ? fn as (...args: string[]) => unknown : null;
}

/** `[x.json, x.bak.json]`, or none when the script has nowhere to keep the store. */
function gapPresetsPaths(): string[] {
  const path = gapPresetsConfOf().path();
  if (typeof path !== 'string' || path === '') {
    return [];
  }
  return [path, /\.json$/.test(path) ? path.slice(0, -5) + '.bak.json' : path + '.bak'];
}

function gapPresetsReadText(path: string): string {
  const read = gapPresetsNative('readFile');
  if (read === null || path === '') {
    return '';
  }
  try {
    const text = read(path);
    return typeof text === 'string' ? text : '';
  } catch (e) {
    return '';
  }
}

/** One entry as stored; null when it cannot be one. */
function gapPresetsEntryOf(raw: unknown): GapPresetsEntry | null {
  if (!gapPresetsIsObject(raw)) {
    return null;
  }
  const name = gapPresetsCleanName(raw.name);
  const values = gapPresetsValuesOf(raw.values);
  if (name === '' || values === null) {
    return null;
  }
  const e: GapPresetsEntry = { lid: typeof raw.lid === 'string' ? raw.lid : '', name: name, values: values };
  if (typeof raw.id === 'string' && typeof raw.rev === 'number') {
    e.id = raw.id;
    e.rev = raw.rev;
  }
  if ('prevRev' in raw && (raw.prevRev === null || typeof raw.prevRev === 'number')) {
    e.prevRev = raw.prevRev;
  }
  if (raw.dirty === true) {
    e.dirty = true;
  }
  if (gapPresetsIsObject(raw.held) && typeof raw.held.why === 'string') {
    e.held = { why: raw.held.why };
  }
  return e;
}

/** A store file's text as a store; null when it is not one. Ids and names are made unique. */
function gapPresetsParse(text: string): GapPresetsFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!gapPresetsIsObject(raw) || typeof raw.instance !== 'string' || typeof raw.ver !== 'number'
      || !isFinite(raw.ver) || !Array.isArray(raw.presets)) {
    return null;
  }
  const presets: GapPresetsEntry[] = [];
  const taken: { [key: string]: boolean } = {};
  for (let i = 0; i < raw.presets.length; i++) {
    const e = gapPresetsEntryOf(raw.presets[i]);
    if (e === null) {
      continue;
    }
    if (e.lid === '' || gapPresetsByLid(presets, e.lid) !== undefined) {
      e.lid = gapPresetsNewLid(presets);
    }
    e.name = gapPresetsFreeName(e.name, taken);
    taken[gapPresetsKey(e.name)] = true;
    presets.push(e);
  }
  const deleted: GapPresetsTomb[] = [];
  const tombs = Array.isArray(raw.deleted) ? raw.deleted : [];
  for (let i = 0; i < tombs.length; i++) {
    const t = tombs[i];
    if (gapPresetsIsObject(t) && typeof t.id === 'string' && typeof t.rev === 'number') {
      deleted.push({ id: t.id, rev: t.rev, name: typeof t.name === 'string' ? t.name : '' });
    }
  }
  return {
    instance: raw.instance, ver: raw.ver,
    scope: typeof raw.scope === 'string' ? raw.scope : null,
    hash: typeof raw.hash === 'string' ? raw.hash : null,
    presets: presets, deleted: deleted,
  };
}

/** A new store: the legacy list's entries, without ids and dirty, so the server takes them. */
function gapPresetsFresh(): GapPresetsFile {
  const store: GapPresetsFile = {
    instance: gapPresetsRandom(16), ver: 1, scope: null, hash: null, presets: [], deleted: [],
  };
  const conf = gapPresetsConfOf();
  const text = conf.legacyPath === undefined ? '' : gapPresetsReadText(conf.legacyPath());
  let legacy: unknown = null;
  try {
    legacy = text === '' ? null : JSON.parse(text);
  } catch (e) {
    legacy = null;
  }
  if (Array.isArray(legacy)) {
    gapPresetsSeed(store, legacy);
  }
  gapPresetsSort(store.presets);
  return store;
}

/**
 * The store, read from the files the first time; null when it is unreadable
 * (or there is nowhere to keep one). No file at all makes a new one.
 */
function gapPresetsLoad(): GapPresetsFile | null {
  if (gapPresetsLoaded !== null) {
    return gapPresetsLoaded.store;
  }
  const paths = gapPresetsPaths();
  if (paths.length === 0) {
    return null;
  }
  let best: GapPresetsFile | null = null;
  let from = -1;
  let found = false;
  for (let i = 0; i < paths.length; i++) {
    const text = gapPresetsReadText(paths[i]);
    if (text.trim() === '') {
      continue;
    }
    found = true;
    const store = gapPresetsParse(text);
    if (store !== null && (best === null || store.ver > best.ver)) {
      best = store;
      from = i;
    }
  }
  if (best === null && found) {
    return null;
  }
  if (best === null) {
    gapPresetsLoaded = { store: gapPresetsFresh(), from: -1 };
    // Written now so the instance holds across a reload; a failure is retried at the next change.
    gapPresetsSave(gapPresetsLoaded.store);
    return gapPresetsLoaded.store;
  }
  gapPresetsLoaded = { store: best, from: from };
  return best;
}

/** Writes `store` over the file not holding the current one, then makes it current. */
function gapPresetsSave(store: GapPresetsFile): boolean {
  const paths = gapPresetsPaths();
  const write = gapPresetsNative('writeFile');
  if (paths.length === 0 || write === null) {
    return false;
  }
  const to = gapPresetsLoaded !== null && gapPresetsLoaded.from === 0 ? 1 : 0;
  try {
    write(paths[to], JSON.stringify(store));
  } catch (e) {
    const warn = gapPresetsConfOf().warn;
    if (warn !== undefined) {
      warn('Could not save the presets', { path: paths[to], errorText: '' + e });
    }
    return false;
  }
  gapPresetsLoaded = { store: store, from: to };
  return true;
}

function gapPresetsCopy(store: GapPresetsFile): GapPresetsFile {
  return JSON.parse(JSON.stringify(store)) as GapPresetsFile;
}

/** Anything the server has not taken yet: a change, an entry it has no id for, a delete. Held entries wait. */
function gapPresetsPendingOf(store: GapPresetsFile): boolean {
  if (store.deleted.length > 0) {
    return true;
  }
  for (let i = 0; i < store.presets.length; i++) {
    const e = store.presets[i];
    if (e.held === undefined && (e.dirty === true || e.id === undefined)) {
      return true;
    }
  }
  return false;
}

// --- Page ops --------------------------------------------------------------------

function gapPresetsBaseOf(raw: unknown): GapPresetsBase | null {
  if (!gapPresetsIsObject(raw) || typeof raw.lid !== 'string') {
    return null;
  }
  return { lid: raw.lid, rev: typeof raw.rev === 'number' ? raw.rev : null };
}

/** The page changed the entry as it stands: its rev, or the rev before our own write landed. */
function gapPresetsBaseHolds(e: GapPresetsEntry, base: GapPresetsBase | null): boolean {
  return base !== null && base.lid === e.lid
    && (base.rev === e.rev || (e.prevRev !== undefined && base.rev === e.prevRev));
}

/**
 * An edit of an entry the account has: a stale base sets `rev` back to it, and
 * a page that never saw this entry sets 0, so the server keeps both copies.
 */
function gapPresetsRebase(e: GapPresetsEntry, base: GapPresetsBase | null): void {
  if (e.id === undefined) {
    return;
  }
  if (base !== null && base.lid === e.lid) {
    if (!gapPresetsBaseHolds(e, base)) {
      e.rev = typeof base.rev === 'number' ? base.rev : 0;
    }
  } else {
    e.rev = 0;
  }
}

/** Marks an entry changed here: dirty, and the server decides again (no prevRev, no hold). */
function gapPresetsTouch(e: GapPresetsEntry): void {
  e.dirty = true;
  delete e.prevRev;
  delete e.held;
}

/** `put {name, values, base}`: save over the base entry or the same name, else a new one. */
function gapPresetsPut(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpResult & { changed?: boolean } {
  const name = gapPresetsCleanName(op.name);
  const values = gapPresetsValuesOf(op.values);
  const base = gapPresetsBaseOf(op.base);
  if (name === '' || values === null) {
    return { ok: false, error: 'bad-op' };
  }
  const key = gapPresetsKey(name);
  let e = base !== null ? gapPresetsByLid(store.presets, base.lid) : undefined;
  if (e === undefined) {
    e = gapPresetsByKey(store.presets, key);
  }
  if (e !== undefined) {
    const other = gapPresetsByKey(store.presets, key);
    if (other !== undefined && other !== e) {
      return { ok: false, error: 'name-taken' };
    }
    gapPresetsRebase(e, base);
    e.name = name;
    e.values = values;
    gapPresetsTouch(e);
    return { ok: true, lid: e.lid, changed: true };
  }
  if (store.presets.length >= GAP_PRESETS_MAX) {
    return { ok: false, error: 'full' };
  }
  const made: GapPresetsEntry = { lid: gapPresetsNewLid(store.presets), name: name, values: values };
  // A delete then a save under the same name is one edit of that id, so
  // `preset:<id>` references survive it.
  for (let i = 0; i < store.deleted.length; i++) {
    if (gapPresetsKey(store.deleted[i].name) === key) {
      made.id = store.deleted[i].id;
      made.rev = store.deleted[i].rev;
      store.deleted.splice(i, 1);
      break;
    }
  }
  made.dirty = true;
  store.presets.push(made);
  return { ok: true, lid: made.lid, changed: true };
}

/** `rename {lid, name, base}`: keeps the id, so workflows naming `preset:<id>` survive. */
function gapPresetsRename(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpResult & { changed?: boolean } {
  const e = gapPresetsByLid(store.presets, op.lid);
  if (e === undefined) {
    return { ok: false, error: 'gone' };
  }
  const name = gapPresetsCleanName(op.name);
  if (name === '') {
    return { ok: false, error: 'bad-op' };
  }
  const other = gapPresetsByKey(store.presets, gapPresetsKey(name));
  if (other !== undefined && other !== e) {
    return { ok: false, error: 'name-taken' };
  }
  if (e.name === name) {
    return { ok: true, lid: e.lid };
  }
  gapPresetsRebase(e, gapPresetsBaseOf(op.base));
  e.name = name;
  gapPresetsTouch(e);
  return { ok: true, lid: e.lid, changed: true };
}

/** `delete {lid, base}`: a stale page's delete keeps the rev it saw, so a newer account edit wins. */
function gapPresetsDelete(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpResult & { changed?: boolean } {
  const e = gapPresetsByLid(store.presets, op.lid);
  if (e === undefined) {
    return { ok: true };
  }
  store.presets.splice(store.presets.indexOf(e), 1);
  if (e.id !== undefined) {
    const base = gapPresetsBaseOf(op.base);
    const rev = gapPresetsBaseHolds(e, base) ? (e.rev === undefined ? 0 : e.rev)
      : (base !== null && typeof base.rev === 'number' ? base.rev : 0);
    store.deleted.push({ id: e.id, rev: rev, name: e.name });
  }
  return { ok: true, lid: e.lid, changed: true };
}

/**
 * A page's older list merged in by name (the migration): the same values are
 * skipped; other values replace the entry's (rev 0 when the account has it, so
 * the server keeps both); a new name is added. Never refused for count.
 */
function gapPresetsSeed(store: GapPresetsFile, list: unknown[]): boolean {
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!gapPresetsIsObject(p)) {
      continue;
    }
    const name = gapPresetsCleanName(p.name);
    const values = gapPresetsValuesOf(p.values);
    if (name === '' || values === null) {
      continue;
    }
    const e = gapPresetsByKey(store.presets, gapPresetsKey(name));
    if (e === undefined) {
      store.presets.push({ lid: gapPresetsNewLid(store.presets), name: name, values: values, dirty: true });
      changed = true;
    } else if (!gapPresetsSameValues(e.values, values)) {
      e.values = values;
      if (e.id !== undefined) {
        e.rev = 0;
      }
      gapPresetsTouch(e);
      changed = true;
    }
  }
  return changed;
}

/** What the pages are shown of an entry. */
function gapPresetsViewOf(e: GapPresetsEntry): { [key: string]: unknown } {
  const out: { [key: string]: unknown } = { lid: e.lid, name: e.name, values: e.values };
  if (e.id !== undefined) {
    out.id = e.id;
    out.rev = e.rev;
  }
  if (e.held !== undefined) {
    out.held = e.held;
  }
  return out;
}

function gapPresetsView(store: GapPresetsFile, extra?: { [key: string]: unknown }): string {
  const out: { [key: string]: unknown } = {
    ok: true, instance: store.instance, ver: store.ver, presets: store.presets.map(gapPresetsViewOf),
  };
  if (extra !== undefined) {
    for (const key in extra) {
      out[key] = extra[key];
    }
  }
  return JSON.stringify(out);
}

/**
 * Pages: the store as they show it, `{ok, instance, ver, presets: [{lid, name,
 * values, id?, rev?, held?}]}`. `json` may be `{instance, ver}`, the copy the
 * page holds: when that is still current the answer is `{ok, instance, ver, same: true}`.
 */
// noinspection JSUnusedGlobalSymbols
function gapPresetsRead(json?: string): string {
  const store = gapPresetsLoad();
  if (store === null) {
    return JSON.stringify({ ok: false, error: 'store-unreadable' });
  }
  let held: unknown = null;
  try {
    held = typeof json === 'string' && json !== '' ? JSON.parse(json) : null;
  } catch (e) {
    held = null;
  }
  if (gapPresetsIsObject(held) && held.instance === store.instance && held.ver === store.ver) {
    return JSON.stringify({ ok: true, instance: store.instance, ver: store.ver, same: true });
  }
  return gapPresetsView(store);
}

/**
 * Pages: `{ops: [op]}`, each `{op: 'put', name, values, base}`, `{op:
 * 'rename', lid, name, base}`, `{op: 'delete', lid, base}` or `{op: 'seed',
 * presets: [{name, values}]}` (`base` = `{lid, rev}` the page saw, or null).
 * Applied in order, each on its own; a batch that changed anything bumps `ver`,
 * is saved, and emits `gap.presets`. Answers the view plus `results` (one
 * `{ok, lid?, error?}` per op), or `{ok: false, error}`: `store-unreadable`,
 * `not-saved` (nothing changed), `bad-ops`.
 */
// noinspection JSUnusedGlobalSymbols
function gapPresetsApply(json: string): string {
  let batch: unknown;
  try {
    batch = JSON.parse(json);
  } catch (e) {
    batch = null;
  }
  if (!gapPresetsIsObject(batch) || !Array.isArray(batch.ops)) {
    return JSON.stringify({ ok: false, error: 'bad-ops' });
  }
  const current = gapPresetsLoad();
  if (current === null) {
    return JSON.stringify({ ok: false, error: 'store-unreadable' });
  }
  const store = gapPresetsCopy(current);
  const results: GapPresetsOpResult[] = [];
  let changed = false;
  for (let i = 0; i < batch.ops.length; i++) {
    const op = batch.ops[i];
    let r: GapPresetsOpResult & { changed?: boolean } = { ok: false, error: 'bad-op' };
    if (gapPresetsIsObject(op)) {
      if (op.op === 'put') {
        r = gapPresetsPut(store, op);
      } else if (op.op === 'rename') {
        r = gapPresetsRename(store, op);
      } else if (op.op === 'delete') {
        r = gapPresetsDelete(store, op);
      } else if (op.op === 'seed' && Array.isArray(op.presets)) {
        r = { ok: true, changed: gapPresetsSeed(store, op.presets) };
      }
    }
    changed = changed || r.changed === true;
    const result: GapPresetsOpResult = { ok: r.ok };
    if (r.lid !== undefined) {
      result.lid = r.lid;
    }
    if (r.error !== undefined) {
      result.error = r.error;
    }
    results.push(result);
  }
  if (!changed) {
    return gapPresetsView(current, { results: results });
  }
  store.ver++;
  gapPresetsSort(store.presets);
  if (!gapPresetsSave(store)) {
    return JSON.stringify({ ok: false, error: 'not-saved' });
  }
  const conf = gapPresetsConfOf();
  try {
    conf.emit('gap.presets', { script: conf.script });
  } catch (e) {
    // The server also finds the change from the next catalog.
  }
  return gapPresetsView(store, { results: results });
}

// --- GAP Companion's adapter -----------------------------------------------------

/**
 * The whole store as JSON: `{instance, ver, scope, hash, presets: [{lid, name,
 * values, id?, rev?, prevRev?, dirty?, held?}], deleted: [{id, rev, name}]}`,
 * or `{"error": "store-unreadable"}`.
 */
// noinspection JSUnusedGlobalSymbols
function gapPresetsStore(): string {
  const store = gapPresetsLoad();
  return store === null ? JSON.stringify({ error: 'store-unreadable' }) : JSON.stringify(store);
}

/** `[{name, values}]` of every entry, for the phone's one-way Import from device. */
// noinspection JSUnusedGlobalSymbols
function gapPresetsLocal(): string {
  const store = gapPresetsLoad();
  if (store === null) {
    return JSON.stringify({ error: 'store-unreadable' });
  }
  return JSON.stringify(store.presets.map(function(e) { return { name: e.name, values: e.values }; }));
}

/** True when the store holds something the server has not taken (false when unreadable). */
function gapPresetsPending(): boolean {
  const store = gapPresetsLoad();
  return store !== null && gapPresetsPendingOf(store);
}

/**
 * Makes the store the account's list. `json` = `{script, instance, ver, scope,
 * hash, presets: [Preset], map: {lid: {id, mine}}, held: [{lid, why, name}],
 * drop: [lid]}`, built from the store at `{instance, ver}`. Every account
 * preset becomes a clean entry (`map` keeps its lid; `mine` = this device's
 * write landed, which sets `prevRev`). A local lid the server did not map is
 * removed only when named in `drop`, and otherwise kept as held. Answers
 * `{ok: true}` or `{ok: false, error: wrong-script | stale | store-unreadable
 * | bad-adopt | not-saved}`. Emits nothing.
 */
// noinspection JSUnusedGlobalSymbols
function gapPresetsAdopt(json: string): string {
  let a: unknown;
  try {
    a = JSON.parse(json);
  } catch (e) {
    a = null;
  }
  if (!gapPresetsIsObject(a) || typeof a.script !== 'string' || typeof a.instance !== 'string'
      || typeof a.ver !== 'number' || !Array.isArray(a.presets)) {
    return JSON.stringify({ ok: false, error: 'bad-adopt' });
  }
  if (a.script !== gapPresetsConfOf().script) {
    return JSON.stringify({ ok: false, error: 'wrong-script' });
  }
  const current = gapPresetsLoad();
  if (current === null) {
    return JSON.stringify({ ok: false, error: 'store-unreadable' });
  }
  if (current.instance !== a.instance || current.ver !== a.ver) {
    return JSON.stringify({ ok: false, error: 'stale' });
  }
  const map = gapPresetsIsObject(a.map) ? a.map : {};
  const idToLid: { [id: string]: string } = {};
  for (const lid in map) {
    const m = map[lid];
    if (gapPresetsIsObject(m) && typeof m.id === 'string') {
      idToLid[m.id] = lid;
    }
  }
  const held: { [lid: string]: { why?: string; name?: string } } = {};
  const heldList = Array.isArray(a.held) ? a.held : [];
  for (let i = 0; i < heldList.length; i++) {
    const h = heldList[i];
    if (gapPresetsIsObject(h) && typeof h.lid === 'string') {
      held[h.lid] = {
        why: typeof h.why === 'string' ? h.why : undefined,
        name: typeof h.name === 'string' ? h.name : undefined,
      };
    }
  }
  const drop = Array.isArray(a.drop) ? a.drop : [];

  const next: GapPresetsEntry[] = [];
  const taken: { [key: string]: boolean } = {};
  for (let i = 0; i < a.presets.length; i++) {
    const p = a.presets[i];
    if (!gapPresetsIsObject(p) || typeof p.id !== 'string' || typeof p.rev !== 'number') {
      continue;
    }
    const values = gapPresetsValuesOf(p.values);
    const name = gapPresetsCleanName(p.name);
    if (values === null || name === '') {
      continue;
    }
    const mapped = Object.prototype.hasOwnProperty.call(idToLid, p.id) ? idToLid[p.id] : undefined;
    const lid = mapped !== undefined && gapPresetsByLid(next, mapped) === undefined ? mapped : undefined;
    const old = lid !== undefined ? gapPresetsByLid(current.presets, lid) : undefined;
    const e: GapPresetsEntry = {
      lid: lid !== undefined ? lid : '', name: gapPresetsFreeName(name, taken), values: values,
      id: p.id, rev: p.rev,
    };
    const m = lid !== undefined ? map[lid] : undefined;
    const mine = gapPresetsIsObject(m) && m.mine === true;
    if (old !== undefined && mine && old.rev !== p.rev) {
      // Our own write landed: the page's next edit may still name the rev before it.
      e.prevRev = old.id !== undefined && old.rev !== undefined ? old.rev : null;
    } else if (old !== undefined && old.rev === p.rev && old.prevRev !== undefined) {
      e.prevRev = old.prevRev;
    }
    taken[gapPresetsKey(e.name)] = true;
    next.push(e);
  }
  // New lids last, so none can take a lid an old entry still has.
  for (let i = 0; i < next.length; i++) {
    if (next[i].lid === '') {
      next[i].lid = gapPresetsNewLid(next.concat(current.presets));
    }
  }
  for (let i = 0; i < current.presets.length; i++) {
    const old = current.presets[i];
    if (gapPresetsByLid(next, old.lid) !== undefined || drop.indexOf(old.lid) >= 0) {
      continue;
    }
    // Never dropped unless named: whatever the server did not take stays here, held.
    const h = Object.prototype.hasOwnProperty.call(held, old.lid) ? held[old.lid] : {};
    const name = gapPresetsFreeName(h.name !== undefined ? h.name : old.name, taken);
    taken[gapPresetsKey(name)] = true;
    next.push({
      lid: old.lid, name: name, values: old.values, dirty: true,
      held: { why: h.why !== undefined ? h.why : 'full' },
    });
  }
  gapPresetsSort(next);
  const store: GapPresetsFile = {
    instance: current.instance, ver: current.ver + 1,
    scope: typeof a.scope === 'string' ? a.scope : null,
    hash: typeof a.hash === 'string' ? a.hash : null,
    presets: next, deleted: [],
  };
  if (!gapPresetsSave(store)) {
    return JSON.stringify({ ok: false, error: 'not-saved' });
  }
  return JSON.stringify({ ok: true });
}
