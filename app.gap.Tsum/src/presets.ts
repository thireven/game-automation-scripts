// Presets: named configurations, and the cache both pages read them from.
//
// A preset is a name and **how a round is played** -- exactly the rows
// `SHARE_SLOTS` (src/settings.ts) names, which is the Skills, Round and
// Gameplay tabs. The rows that shape the run rather than the round (Auto Play
// Game, the between-rounds delay, Track round statistics, Max Round Duration,
// Stop after games) are `neverShared` and stay out. Not the language, the device, the chores, the mailbox or the
// hearts either: those describe the account, and switching between setups
// should not touch any of it.
//
// Saving one takes a copy of those rows as the form has them; loading one writes
// that copy back, so switching presets is switching rather than merging.
//
// ## Why the values are stored and not the code
//
// A preset holds precisely what a settings code carries, and the code is what an
// export is written in -- so the two are the same content in two spellings, and
// the code would be the tidier thing to keep. It is not what is kept, for one
// reason: **the Quick Bar cannot decode one.** Decoding needs the schema -- each
// row's type, its range, and each dropdown's `share` ids -- and that lives in
// the settings page's `tabs`, which the strip's compilation does not have. The
// values are the form both pages can read; the code is built from them, on the
// page that can.
//
// ## Why it is its own file
//
// Both pages need it. The settings page saves, deletes and applies; the Quick
// Bar's strip lists the names and applies one mid-run. Neither can reach the
// other's script -- they are separate compilations in separate WebViews -- so
// this is compiled into both, the way `src/skillOptions.ts` is.
//
// Nothing here touches the DOM. What a page does *with* a preset once it has it
// -- writing rows, pushing the run, nudging the other page -- is that page's own
// business.
//
// ## Where the list lives
//
// In the engine (src/gapPresets.ts): one file per device, synced both ways with
// GAP Companion. Pages hold a cache in localStorage (`StorageKey.Presets`),
// which is what they draw from, and change the list only by sending ops
// (`presetsSubmit`). The cache is refreshed from the engine (`presetsRefresh`)
// as each page opens, on each page's poll, and after every op.
//
// The marker (`StorageKey.PresetsMark`, `{instance, ver, sum}`) says which store
// the cache came from and sums what was written. A list it does not match -- a
// cache from before sync, a GAP Restore, a 5.0 session (same localStorage, same
// script id) -- is sent once as a `seed`, which the engine merges by name; the
// marker is written only after the engine answers. Both go through
// `runScriptCallback`, never `runScript`: the host counts a runScript as a run.

/**
 * The longest a preset name may be.
 *
 * The name is drawn in the app bar and in a Quick Bar chip, both of which
 * ellipsise; this is what stops one being long enough to be nothing but an
 * ellipsis, and what bounds the store.
 */
var PRESET_NAME_MAX = 40;

/** How many presets a new save may make (held ones count). Well past what a player will name. */
var PRESET_MAX = 32;

/** Trims a typed name to what may be stored; '' when nothing is left. */
function presetCleanName(raw: string): string {
    // Collapsed as well as trimmed: two names differing only in their spacing
    // read as the same name and would be two rows in the list.
    var name = String(raw === undefined || raw === null ? '' : raw)
        .replace(/\s+/g, ' ').replace(/^ | $/g, '');
    return name.length > PRESET_NAME_MAX ? name.substring(0, PRESET_NAME_MAX) : name;
}

/** True for the value types a settings row can hold. */
function presetIsValue(value: unknown): boolean {
    var kind = typeof value;
    return kind === 'boolean' || kind === 'number' || kind === 'string';
}

/**
 * Every cached preset, in name order.
 *
 * Anything unreadable answers with an empty list rather than throwing: this is
 * read on every render of both pages, and a store someone has hand-edited into
 * nonsense is a reason to show no presets, not to take the page down with it.
 * Not capped: entries the account had no room for (`held`) can pass `PRESET_MAX`.
 */
function presetsLoad(): Preset[] {
    if (typeof localStorage === 'undefined' || localStorage === null) {
        return [];
    }
    var raw: unknown;
    try {
        raw = JSON.parse(localStorage.getItem(StorageKey.Presets) || '[]');
    } catch (e) {
        return [];
    }
    if (Object.prototype.toString.call(raw) !== '[object Array]') {
        return [];
    }
    var list: Preset[] = [];
    var entries = raw as Preset[];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry === null || typeof entry !== 'object') {
            continue;
        }
        var name = presetCleanName(entry.name);
        if (name === '' || entry.values === null || typeof entry.values !== 'object') {
            continue;
        }
        var values: SettingValues = {};
        for (var key in entry.values) {
            if (presetIsValue(entry.values[key])) {
                values[key] = entry.values[key];
            }
        }
        var preset: Preset = {name: name, values: values};
        if (typeof entry.lid === 'string') {
            preset.lid = entry.lid;
        }
        if (typeof entry.id === 'string' && typeof entry.rev === 'number') {
            preset.id = entry.id;
            preset.rev = entry.rev;
        }
        if (entry.held !== null && typeof entry.held === 'object' && typeof entry.held.why === 'string') {
            preset.held = {why: entry.held.why};
        }
        list.push(preset);
    }
    return presetsSorted(list);
}

/** What `gapPresetsRead` / `gapPresetsApply` answer (src/gapPresets.ts). */
interface PresetsReply {
    ok: boolean;
    error?: string;
    instance?: string;
    ver?: number;
    /** The page's copy is current; no list sent. */
    same?: boolean;
    presets?: Preset[];
    /** One per op sent, in order. */
    results?: PresetOpResult[];
}

/** One op's answer: `error` is `full`, `name-taken`, `gone` or `bad-op`. */
interface PresetOpResult {
    ok: boolean;
    lid?: string;
    error?: string;
}

/** The entry a change was made to, as the page saw it: lets the engine catch an edit of an older copy. */
interface PresetBase {
    lid: string;
    rev: number | null;
}

/** One change for the engine: `put`, `rename`, `delete` or `seed`. */
interface PresetOp {
    op: string;
    name?: string;
    values?: SettingValues;
    lid?: string;
    base?: PresetBase | null;
    presets?: {name: string; values: SettingValues}[];
}

interface PresetsMark {
    instance: string;
    ver: number;
    sum: string;
}

/** Called after this page wrote a changed cache (the other page hears `PageMessage.Presets`). */
var presetsOnChange: (() => void) | null = null;

/** The base to send for a change to `preset`; null for one the engine never named. */
function presetBase(preset: Preset | undefined): PresetBase | null {
    if (preset === undefined || typeof preset.lid !== 'string') {
        return null;
    }
    return {lid: preset.lid, rev: typeof preset.rev === 'number' ? preset.rev : null};
}

/** A short sum of the cache's text, so a list rewritten by something else is noticed. */
function presetsSum(text: string): string {
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return text.length + ':' + (hash >>> 0).toString(36);
}

function presetsMark(): PresetsMark | null {
    try {
        var mark = JSON.parse(localStorage.getItem(StorageKey.PresetsMark) || 'null');
        if (mark !== null && typeof mark === 'object' && typeof mark.instance === 'string'
            && typeof mark.ver === 'number' && typeof mark.sum === 'string') {
            return mark as PresetsMark;
        }
    } catch (e) {
        // Treated as missing.
    }
    return null;
}

/** True when the cache is not what this page last wrote from the engine. */
function presetsNeedsSeed(): boolean {
    var mark = presetsMark();
    return mark === null || mark.sum !== presetsSum(localStorage.getItem(StorageKey.Presets) || '');
}

/** The seed op for the cached list, which is also copied once to `PresetsLegacy`. */
function presetsSeedOp(): PresetOp {
    var text = localStorage.getItem(StorageKey.Presets);
    if (text !== null && text !== '[]' && localStorage.getItem(StorageKey.PresetsLegacy) === null) {
        try {
            localStorage.setItem(StorageKey.PresetsLegacy, text);
        } catch (e) {
            // The seed still goes; the copy is a spare.
        }
    }
    var list = presetsLoad();
    var seed: {name: string; values: SettingValues}[] = [];
    for (var i = 0; i < list.length; i++) {
        seed.push({name: list[i].name, values: list[i].values});
    }
    return {op: 'seed', presets: seed};
}

/**
 * Writes an engine reply into the cache and its marker. Not when the reply is
 * older than the cache (same store, lower `ver`), nor when the cache changed
 * under a plain read. True when the list moved, which tells the other page.
 */
function presetsTake(reply: PresetsReply | null, seeded: boolean): boolean {
    if (reply === null || reply.ok !== true || reply.same === true || typeof reply.instance !== 'string'
        || typeof reply.ver !== 'number' || Object.prototype.toString.call(reply.presets) !== '[object Array]') {
        return false;
    }
    var mark = presetsMark();
    if (mark !== null && mark.instance === reply.instance && reply.ver < mark.ver) {
        return false;
    }
    if (!seeded && presetsNeedsSeed()) {
        return false;
    }
    var before = localStorage.getItem(StorageKey.Presets) || '';
    var text = JSON.stringify(presetsSorted(reply.presets!));
    try {
        localStorage.setItem(StorageKey.Presets, text);
        localStorage.setItem(StorageKey.PresetsMark, JSON.stringify(
            {instance: reply.instance, ver: reply.ver, sum: presetsSum(text)}));
    } catch (e) {
        return false;
    }
    if (text === before) {
        return false;
    }
    if (presetsOnChange !== null) {
        presetsOnChange();
    }
    if (typeof JavaScriptInterface !== 'undefined' && JavaScriptInterface.broadcast !== undefined) {
        JavaScriptInterface.broadcast(PageMessage.Presets);
    }
    return true;
}

/** Callers waiting on `onPresetsReply`, oldest first: the host answers in order. */
var presetsWaiting: ((reply: PresetsReply | null) => void)[] = [];

/** Calls the engine's `fn(JSON.stringify(arg))`; false when there is no bridge to call. */
function presetsCall(fn: string, arg: object, done: (reply: PresetsReply | null) => void): boolean {
    if (typeof JavaScriptInterface === 'undefined') {
        return false;
    }
    presetsWaiting.push(done);
    try {
        JavaScriptInterface.runScriptCallback('typeof ' + fn + ' === "function" ? ' + fn + '('
            + JSON.stringify(JSON.stringify(arg)) + ') : ""', 'onPresetsReply');
    } catch (e) {
        presetsWaiting.pop();
        return false;
    }
    return true;
}

/** The host's answer to `presetsCall`. '' (no engine, or it threw) is null. */
// noinspection JSUnusedGlobalSymbols
function onPresetsReply(json: string): void {
    var done = presetsWaiting.shift();
    var reply: PresetsReply | null = null;
    try {
        reply = json ? JSON.parse(json) : null;
    } catch (e) {
        reply = null;
    }
    if (reply === null || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
        reply = null;
    }
    if (done !== undefined) {
        done(reply);
    }
}

/** The callers waiting on the refresh in flight, and when it was sent. */
var presetsRefreshing: (() => void)[] | null = null;
var presetsRefreshAt = 0;

/** A refresh with no answer after this is taken as lost, so the next one goes. */
var PRESET_REFRESH_WAIT_MS = 5000;

/**
 * Reads the engine's list into the cache; `done` runs after the reply, or at
 * once without a bridge. A cache the marker does not match is sent as a seed.
 * One at a time: a call while one is in flight waits on that one.
 */
function presetsRefresh(done?: () => void): void {
    if (typeof localStorage === 'undefined' || localStorage === null || typeof JavaScriptInterface === 'undefined') {
        if (done !== undefined) {
            done();
        }
        return;
    }
    if (presetsRefreshing !== null && new Date().getTime() - presetsRefreshAt < PRESET_REFRESH_WAIT_MS) {
        if (done !== undefined) {
            presetsRefreshing.push(done);
        }
        return;
    }
    var waiting: (() => void)[] = done !== undefined ? [done] : [];
    presetsRefreshing = waiting;
    presetsRefreshAt = new Date().getTime();
    var finish = function () {
        if (presetsRefreshing === waiting) {
            presetsRefreshing = null;
        }
        for (var i = 0; i < waiting.length; i++) {
            waiting[i]();
        }
    };
    var sent: boolean;
    if (presetsNeedsSeed()) {
        sent = presetsCall('gapPresetsApply', {ops: [presetsSeedOp()]}, function (reply) {
            presetsTake(reply, true);
            finish();
        });
    } else {
        var mark = presetsMark()!;
        sent = presetsCall('gapPresetsRead', {instance: mark.instance, ver: mark.ver}, function (reply) {
            presetsTake(reply, false);
            finish();
        });
    }
    if (!sent) {
        finish();
    }
}

/**
 * Sends `ops` to the engine. `done` gets the reply, or null when nothing was
 * saved (no engine, an unreadable store, a failed write): the page must say so.
 * A cache still waiting for its seed sends that first, so it is never lost.
 */
function presetsSubmit(ops: PresetOp[], done: (reply: PresetsReply | null) => void): void {
    var seeding = typeof localStorage !== 'undefined' && localStorage !== null && presetsNeedsSeed();
    var all = seeding ? [presetsSeedOp()].concat(ops) : ops;
    var sent = presetsCall('gapPresetsApply', {ops: all}, function (reply) {
        if (reply === null || reply.ok !== true) {
            done(null);
            return;
        }
        presetsTake(reply, true);
        if (seeding && reply.results !== undefined) {
            reply.results = reply.results.slice(1);
        }
        done(reply);
    });
    if (!sent) {
        done(null);
    }
}

/** The answer to op `at` of a submit, or null when the batch was not saved. */
function presetResult(reply: PresetsReply | null, at: number): PresetOpResult | null {
    if (reply === null || reply.results === undefined || reply.results[at] === undefined) {
        return null;
    }
    return reply.results[at];
}

/**
 * By name, case-insensitively, so a list read on either page is in the same
 * order and a new preset lands where the user will look for it.
 */
function presetsSorted(list: Preset[]): Preset[] {
    return list.slice().sort(function (a, b) {
        var left = a.name.toLowerCase();
        var right = b.name.toLowerCase();
        return left < right ? -1 : (left > right ? 1 : 0);
    });
}

/** Where `name` sits in the list, or -1. Case-insensitive: names are labels. */
function presetIndexOf(list: Preset[], name: string): number {
    var wanted = presetCleanName(name).toLowerCase();
    for (var i = 0; i < list.length; i++) {
        if (list[i].name.toLowerCase() === wanted) {
            return i;
        }
    }
    return -1;
}

/** The preset called `name`, or undefined. */
function presetByName(list: Preset[], name: string): Preset | undefined {
    var at = presetIndexOf(list, name);
    return at < 0 ? undefined : list[at];
}

/**
 * Which preset `values` currently *is*, or '' for none.
 *
 * Matching rather than remembering what was last applied: a setting changed by
 * hand afterwards has to stop the label claiming that preset, and there is no
 * one place either page could hook to notice that. Every value the preset names
 * has to agree; a key the preset does not name is not looked at, so a preset
 * saved before a setting existed still matches once that setting is at whatever
 * the form has. A key the *form* does not have (a row this build or channel does
 * not offer, synced from another device) is skipped the same way.
 */
function presetMatchName(list: Preset[], values: SettingValues): string {
    for (var i = 0; i < list.length; i++) {
        var preset = list[i];
        var same = true;
        for (var key in preset.values) {
            if (!Object.prototype.hasOwnProperty.call(values, key)) {
                continue;
            }
            if (preset.values[key] !== values[key]) {
                same = false;
                break;
            }
        }
        if (same) {
            return preset.name;
        }
    }
    return '';
}

// Exporting is `presetsExportText` in `src/settings.ts` rather than here: it
// writes one settings code per preset, and building a code needs the schema --
// the defaults to compare against and each dropdown's `share` ids -- which only
// that page has.
