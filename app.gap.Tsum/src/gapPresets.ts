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
// file whole. A load takes the valid one with the higher `ver` (then `seq`,
// bumped on every write). When a file has text but neither parses, every global
// answers `store-unreadable` and nothing is written over them. An empty file
// holds nothing to keep (a kill during the very first write), so it counts as
// missing.
//
// **In use.** A preset is a full set of the script's preset fields (setup's
// `full`). The store also keeps which entry is in use (`active`) and the
// fields' values from before one was (`own`), so No preset can bring them
// back: `use` / `none` / `edited` ops for pages, `gapPresetUse` for the
// adapter. Both are device-local: never synced, never a `ver` bump or a
// `gap.presets` event, and an adopt carries them over.
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
  /** The entry in use (lid), or null. Device-local, like `own`. */
  active: string | null;
  /** The preset fields' values from before a preset was put in use; null when there are none to restore. */
  own: GapPresetsValues | null;
  /** Bumped on every write: picks the newer of two files at one `ver`, and orders the pages' replies. */
  seq: number;
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
  /** The settings now, as the adapter's `gapPresetUse` keeps them for No preset (through `full`). */
  current?: () => { [key: string]: unknown };
  /** A preset's full set: every preset field, its value else the field's default. Without it, values as they are. */
  full?: (values: GapPresetsValues) => GapPresetsValues;
}

/** One op's answer, in order: the entry it touched, or why it was refused. */
interface GapPresetsOpResult {
  ok: boolean;
  lid?: string;
  error?: string;
  /** `use`: the entry's full set; `none`: the own values, or null. */
  values?: GapPresetsValues | null;
}

/** What an op did: `changed` the list (a `ver` bump), or only what is in use (`used`). */
type GapPresetsOpDone = GapPresetsOpResult & { changed?: boolean; used?: boolean };

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
    active: typeof raw.active === 'string' && gapPresetsByLid(presets, raw.active) !== undefined ? raw.active : null,
    own: raw.own === null || raw.own === undefined ? null : gapPresetsValuesOf(raw.own),
    seq: typeof raw.seq === 'number' && isFinite(raw.seq) ? raw.seq : 0,
  };
}

/** A new store: the legacy list's entries, without ids and dirty, so the server takes them. */
function gapPresetsFresh(): GapPresetsFile {
  const store: GapPresetsFile = {
    instance: gapPresetsRandom(16), ver: 1, scope: null, hash: null, presets: [], deleted: [],
    active: null, own: null, seq: 0,
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
    // At one `ver` (an in-use change), the later write.
    if (store !== null && (best === null || store.ver > best.ver
        || (store.ver === best.ver && store.seq > best.seq))) {
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
  store.seq = (gapPresetsLoaded !== null ? gapPresetsLoaded.store.seq : 0) + 1;
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

// --- In use ----------------------------------------------------------------------

/** `values` as a full set (setup's `full`), or as they are without that hook. */
function gapPresetsFull(values: GapPresetsValues): GapPresetsValues {
  const full = gapPresetsConfOf().full;
  if (full === undefined) {
    return gapPresetsValuesOf(values) || {};
  }
  return gapPresetsValuesOf(full(values)) || {};
}

/** What `own` becomes: the values given (a page's form), else setup's `current`; null without either. */
function gapPresetsCurrent(given: unknown): GapPresetsValues | null {
  const values = gapPresetsValuesOf(given);
  if (values !== null) {
    return gapPresetsFull(values);
  }
  const current = gapPresetsConfOf().current;
  if (current === undefined) {
    return null;
  }
  try {
    const now = gapPresetsValuesOf(current());
    return now === null ? null : gapPresetsFull(now);
  } catch (e) {
    return null;
  }
}

/** Puts `lid` in use; when none was, `own` is kept first. True when anything changed. */
function gapPresetsUseLid(store: GapPresetsFile, lid: string, given: unknown): boolean {
  if (store.active === lid) {
    return false;
  }
  if (store.active === null) {
    store.own = gapPresetsCurrent(given);
  }
  store.active = lid;
  return true;
}

/** Nothing in use and no own values. True when anything changed. */
function gapPresetsUseNone(store: GapPresetsFile): boolean {
  const changed = store.active !== null || store.own !== null;
  store.active = null;
  store.own = null;
  return changed;
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

/**
 * `put {name, values, base, use?, current?}`: save over the base entry or the
 * same name, else a new one. `use: true` puts the saved entry in use (`own` from
 * `current`, else `values`: the form it was saved from).
 */
function gapPresetsPutUse(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
  const r = gapPresetsPut(store, op);
  if (r.ok && r.lid !== undefined && op.use === true) {
    r.used = gapPresetsUseLid(store, r.lid, op.current !== undefined ? op.current : op.values);
  }
  return r;
}

/** The save itself, without the `use` flag. */
function gapPresetsPut(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
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
function gapPresetsRename(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
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
function gapPresetsDelete(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
  const e = gapPresetsByLid(store.presets, op.lid);
  if (e === undefined) {
    return { ok: true };
  }
  store.presets.splice(store.presets.indexOf(e), 1);
  // Own kept: No preset can still bring the settings back.
  if (store.active === e.lid) {
    store.active = null;
  }
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

/** `use {lid, current?}`: the entry in use (`own` from `current`, else setup's); answers its full set. */
function gapPresetsUseOp(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
  const e = gapPresetsByLid(store.presets, op.lid);
  if (e === undefined) {
    return { ok: false, error: 'gone' };
  }
  const used = gapPresetsUseLid(store, e.lid, op.current);
  return { ok: true, lid: e.lid, values: gapPresetsFull(e.values), used: used };
}

/** `none`: answers the own values (or null), then nothing is in use. */
function gapPresetsNoneOp(store: GapPresetsFile): GapPresetsOpDone {
  const values = store.own;
  return { ok: true, values: values, used: gapPresetsUseNone(store) };
}

/**
 * `edited {keys?}`: a preset field changed by hand, so nothing is in use and
 * own is dropped. With `keys` (a page that cannot tell the fields apart),
 * only when one of them is a preset field (setup's `full`).
 */
function gapPresetsEditedOp(store: GapPresetsFile, op: { [key: string]: unknown }): GapPresetsOpDone {
  if (Array.isArray(op.keys) && gapPresetsConfOf().full !== undefined) {
    const fields = gapPresetsFull({});
    const keys = op.keys;
    let any = false;
    for (let i = 0; i < keys.length; i++) {
      any = any || (typeof keys[i] === 'string' && Object.prototype.hasOwnProperty.call(fields, keys[i]));
    }
    if (!any) {
      return { ok: true };
    }
  }
  return { ok: true, used: gapPresetsUseNone(store) };
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

/** What is in use, for the pages: the lid (or null), whether No preset has values to bring back, and `seq` to order replies. */
function gapPresetsUseView(store: GapPresetsFile): { [key: string]: unknown } {
  return { active: store.active, hasOwn: store.own !== null, seq: store.seq };
}

function gapPresetsView(store: GapPresetsFile, extra?: { [key: string]: unknown }): string {
  const out: { [key: string]: unknown } = gapPresetsUseView(store);
  out.ok = true;
  out.instance = store.instance;
  out.ver = store.ver;
  out.presets = store.presets.map(gapPresetsViewOf);
  if (extra !== undefined) {
    for (const key in extra) {
      out[key] = extra[key];
    }
  }
  return JSON.stringify(out);
}

/**
 * Pages: the store as they show it, `{ok, instance, ver, active, hasOwn, seq,
 * presets: [{lid, name, values, id?, rev?, held?}]}`. `json` may be `{instance,
 * ver}`, the copy the page holds: when that is still current the answer is
 * `{ok, instance, ver, active, hasOwn, seq, same: true}`.
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
    const same = gapPresetsUseView(store);
    same.ok = true;
    same.instance = store.instance;
    same.ver = store.ver;
    same.same = true;
    return JSON.stringify(same);
  }
  return gapPresetsView(store);
}

/**
 * Pages: `{ops: [op]}`, each `{op: 'put', name, values, base, use?, current?}`,
 * `{op: 'rename', lid, name, base}`, `{op: 'delete', lid, base}`, `{op:
 * 'seed', presets: [{name, values}]}` (`base` = `{lid, rev}` the page saw, or
 * null), or one about what is in use: `{op: 'use', lid, current?}`, `{op:
 * 'none'}`, `{op: 'edited', keys?}`. Applied in order, each on its own; a
 * batch that changed the list bumps `ver`, is saved, and emits `gap.presets`;
 * one that changed only what is in use is saved quietly. Answers the view plus
 * `results` (one `{ok, lid?, error?, values?}` per op), or `{ok: false,
 * error}`: `store-unreadable`, `not-saved` (nothing changed), `bad-ops`.
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
  let used = false;
  for (let i = 0; i < batch.ops.length; i++) {
    const op = batch.ops[i];
    let r: GapPresetsOpDone = { ok: false, error: 'bad-op' };
    if (gapPresetsIsObject(op)) {
      if (op.op === 'put') {
        r = gapPresetsPutUse(store, op);
      } else if (op.op === 'rename') {
        r = gapPresetsRename(store, op);
      } else if (op.op === 'delete') {
        r = gapPresetsDelete(store, op);
      } else if (op.op === 'seed' && Array.isArray(op.presets)) {
        r = { ok: true, changed: gapPresetsSeed(store, op.presets) };
      } else if (op.op === 'use') {
        r = gapPresetsUseOp(store, op);
      } else if (op.op === 'none') {
        r = gapPresetsNoneOp(store);
      } else if (op.op === 'edited') {
        r = gapPresetsEditedOp(store, op);
      }
    }
    changed = changed || r.changed === true;
    used = used || r.used === true;
    const result: GapPresetsOpResult = { ok: r.ok };
    if (r.lid !== undefined) {
      result.lid = r.lid;
    }
    if (r.error !== undefined) {
      result.error = r.error;
    }
    if (r.values !== undefined) {
      result.values = r.values;
    }
    results.push(result);
  }
  if (!changed && !used) {
    return gapPresetsView(current, { results: results });
  }
  // What is in use is not a list change: no `ver` bump (a pending adopt stays good), no event.
  if (changed) {
    store.ver++;
    gapPresetsSort(store.presets);
  }
  if (!gapPresetsSave(store)) {
    return JSON.stringify({ ok: false, error: 'not-saved' });
  }
  if (changed) {
    const conf = gapPresetsConfOf();
    try {
      conf.emit('gap.presets', { script: conf.script });
    } catch (e) {
      // The server also finds the change from the next catalog.
    }
  }
  return gapPresetsView(store, { results: results });
}

// --- GAP Companion's adapter -----------------------------------------------------

/**
 * The whole store as JSON: `{instance, ver, scope, hash, presets: [{lid, name,
 * values, id?, rev?, prevRev?, dirty?, held?}], deleted: [{id, rev, name}],
 * active, own, seq}`, or `{"error": "store-unreadable"}`. `active`, `own` and
 * `seq` are this device's own and are never synced.
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
 * The phone's side of what is in use. `json` is one of:
 * - `{"id": "<account preset id>"}`: that entry is in use; when none was, the
 *   settings now (setup's `current`, through `full`) are kept as own first.
 *   The adapter then sets every preset field itself.
 * - `{"none": true}`: answers `values` = own or null, then nothing is in use.
 * - `{"edited": true}`: a preset field was set from the phone; nothing in use,
 *   own dropped.
 * Answers `{ok: true}` (plus `values` for none) or `{ok: false, error:
 * no-preset | store-unreadable | bad-use | not-saved}`. Never bumps `ver` or emits.
 */
// noinspection JSUnusedGlobalSymbols
function gapPresetUse(json: string): string {
  let a: unknown;
  try {
    a = JSON.parse(json);
  } catch (e) {
    a = null;
  }
  if (!gapPresetsIsObject(a) || (typeof a.id !== 'string' && a.none !== true && a.edited !== true)) {
    return JSON.stringify({ ok: false, error: 'bad-use' });
  }
  const current = gapPresetsLoad();
  if (current === null) {
    return JSON.stringify({ ok: false, error: 'store-unreadable' });
  }
  const store = gapPresetsCopy(current);
  const out: { [key: string]: unknown } = { ok: true };
  let used: boolean;
  if (typeof a.id === 'string') {
    let e: GapPresetsEntry | undefined;
    for (let i = 0; i < store.presets.length && e === undefined; i++) {
      if (store.presets[i].id === a.id) {
        e = store.presets[i];
      }
    }
    if (e === undefined) {
      return JSON.stringify({ ok: false, error: 'no-preset' });
    }
    used = gapPresetsUseLid(store, e.lid, undefined);
  } else if (a.none === true) {
    out.values = store.own;
    used = gapPresetsUseNone(store);
  } else {
    used = gapPresetsUseNone(store);
  }
  if (used && !gapPresetsSave(store)) {
    return JSON.stringify({ ok: false, error: 'not-saved' });
  }
  return JSON.stringify(out);
}

/**
 * Makes the store the account's list. `json` = `{script, instance, ver, scope,
 * hash, presets: [Preset], map: {lid: {id, mine}}, held: [{lid, why, name}],
 * drop: [lid]}`, built from the store at `{instance, ver}`. Every account
 * preset becomes a clean entry (`map` keeps its lid; `mine` = this device's
 * write landed, which sets `prevRev`). A local lid the server did not map is
 * removed only when named in `drop`, and otherwise kept as held. `active` and
 * `own` carry over (`active` only while its lid is still listed). Answers
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
    // From the store as it is now: in-use changes since the server's read did not make this stale.
    active: current.active !== null && gapPresetsByLid(next, current.active) !== undefined ? current.active : null,
    own: current.own,
    seq: current.seq,
  };
  if (!gapPresetsSave(store)) {
    return JSON.stringify({ ok: false, error: 'not-saved' });
  }
  return JSON.stringify({ ok: true });
}
