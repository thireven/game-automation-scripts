// ---------------------------------------------------------------------------
// The Tsum List export: every tsum the player owns, off the collection screen,
// into <storage>/tsum_record/tsum_list_<YYYYMMDD-HHMMSS>.csv.
//
// The collection shows eight cards a page, each with the month it was acquired
// under its portrait; tapping one fills the detail panel above with its level
// and skill. So the walk is:
//
//   sort by Date acquired, owned tsums only  (sortCollection, levelCap.ts)
//   rewind to the first page                 (rewindCollection)
//   per page: read which slots hold a card and each card's date, then tap each
//   card and read the panel -- level, skill, and the big portrait, which names
//   the tsum against its own library (`TsumListPortrait`, data.ts)
//   next page until a slot is empty or there is no next chevron
//   put the player's order back
//
// Reading changes nothing, so plain page turns are safe (DRIVING_SCREENS.md
// § 6). The CSV is rewritten after every page, so a run stopped halfway keeps
// what it read. A field that cannot be read is written empty rather than
// guessed; a portrait that names no tsum is saved beside the CSV so the
// library can be extended from it.
//
// A whole export (reason `end of list`) also writes
// tsum_record/tsum_list_<getDeviceId()>.json, overwritten each time: the list a
// GAP Companion workflow's Select Tsum reads (src/workflow.ts). Keyed by the
// device id rather than the name in the CSV's `device` column, because names
// need not be unique and the storage folder may be seen by more than one install.
// ---------------------------------------------------------------------------

/** 797 tsums is 100 pages; a runaway guard. */
const TsumListMaxPages = 150;
/** Taps on one card, or one page chevron, before giving up on it. */
const TsumListAttempts = 3;
/** Reads of one panel number before it counts as unreadable. */
const TsumListNumberReads = 3;
/** Rest between portrait reads while a selection animates. */
const TsumListPortraitPollMs = 60;
/**
 * How long a selection gets to finish animating. Measured at 120fps: the old
 * portrait holds for ~270ms, the swap runs to ~600ms and it is still from
 * ~690ms; a 60fps device takes about twice that.
 */
const TsumListPortraitWaitMs = 3000;
/** Below this, the portrait is no longer the one from before the tap. */
const TsumListPortraitChanged = 0.9;
/** Two reads in a row this alike are a settled portrait; sparkles cost ~0.01. */
const TsumListPortraitStill = 0.98;
const TsumListColumns = ['order', 'tsum', 'name', 'level', 'level_cap', 'skill', 'skill_max', 'skill_progress', 'acquired', 'build', 'device'];

/** The collection library, loaded on first use. */
var gTsumListLibrary: MyTsumEntry[] | null = null;

function tsumListLibrary(): MyTsumEntry[] {
  if (gTsumListLibrary === null) {
    gTsumListLibrary = myTsumLoadLibrary(TsumListPortrait.library, false);
  }
  return gTsumListLibrary;
}

/** What each of the eight slots holds, off one capture. */
Tsum.prototype.readCollectionCards = function() {
  const g = CollectionGrid;
  const points: Coord[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    for (let j = 0; j < g.bodySamples.length; j++) {
      points.push({x: g.cells[i].x + g.bodySamples[j].dx, y: g.cells[i].y + g.bodySamples[j].dy});
    }
  }
  const cards: CollectionCardState[] = [];
  const img = this.screenshot();
  try {
    const read = this.getColors(img, points);
    for (let i = 0; i < g.cells.length; i++) {
      let blue = 0;
      let gold = 0;
      for (let j = 0; j < g.bodySamples.length; j++) {
        const c = read[i * g.bodySamples.length + j];
        if (isSameColor(g.bodyColor, c, g.bodyDiff)) {
          blue++;
        } else if (isSameColor(g.selectedColor, c, g.selectedDiff)) {
          gold++;
        }
      }
      cards.push(gold >= g.bodyVotes ? 'selected' : blue >= g.bodyVotes ? 'card' : 'empty');
    }
  } finally {
    releaseImage(img);
  }
  return cards;
}

/**
 * A card's acquisition month as "YYYY-MM", or '' when unread. Read under each
 * of `TsumListRegions.dateReads` until two agree -- see that table for why.
 */
Tsum.prototype.readCardDate = function(slot) {
  const d = TsumListRegions.date;
  const cell = CollectionGrid.cells[slot];
  const seen: {[date: string]: number} = {};
  const reads = TsumListRegions.dateReads;
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i];
    const got = this.readStatsNumbers({
      name: 'tsum date', x: cell.x + d.dx, y: cell.y + d.dy, w: d.w, h: d.h,
      lo: [r.lo, r.lo, r.lo], hi: [255, 255, 255], slash: true, scale: r.scale
    });
    if (got === null || got.length !== 2 || got[0] < 2014 || got[0] > 2099
        || got[1] < 1 || got[1] > 12) {
      continue;
    }
    const date = got[0] + '-' + (got[1] < 10 ? '0' : '') + got[1];
    seen[date] = (seen[date] || 0) + 1;
    if (seen[date] === 2) {
      return date;
    }
  }
  return '';
}

/** A panel "now/max" pair, read until the same value comes back twice. */
function tsumListReadPair(ts: Tsum, region: StatsRegion): number[] | null {
  let last: number[] | null = null;
  for (let i = 0; i < TsumListNumberReads; i++) {
    const got = ts.readStatsNumbers(region);
    if (got !== null && got.length === 2 && got[0] <= got[1]) {
      if (last !== null && last[0] === got[0] && last[1] === got[1]) {
        return got;
      }
      last = got;
    }
  }
  return null;
}

/** The detail panel's level and skill, each `[now, max]` or null. */
Tsum.prototype.readTsumDetail = function() {
  const r = TsumListRegions;
  // The level row moves right to make room for the raise-cap padlock.
  const dx = this.collectionOffersRaise() ? r.levelCappedDx : 0;
  const level = Object.assign({}, r.level, {x: r.level.x + dx});
  return {level: tsumListReadPair(this, level), skill: tsumListReadPair(this, r.skill)};
}

/**
 * Name the tsum on the detail panel: by its portrait first, then -- when the
 * portrait cannot tell two look-alikes apart (Donald and his variants, the
 * Minnies) -- by the name printed above it. The best guess comes back either
 * way, `confident` saying whether to trust it.
 */
Tsum.prototype.identifyCollectionTsum = function() {
  const build = this.gameBuild();
  const lib = tsumListLibrary();
  const sig = lib.length === 0 ? null : this.myTsumSignature(TsumListPortrait.icon);
  const match = sig === null ? null : myTsumMatch(sig, build, lib);
  const byPortrait: MyTsumSelection | null = match === null ? null : {
    short: match.short,
    full: match.full,
    build: match.build,
    score: match.score,
    margin: match.margin,
    confident: match.score >= TsumListPortrait.minScore && match.margin >= TsumListPortrait.minMargin
  };
  if (byPortrait !== null && byPortrait.confident) {
    return byPortrait;
  }
  const byName = tsumListMatchName(this, build);
  logDebug(Log.TsumList.Identified, {
    portrait: byPortrait === null ? null : byPortrait.short,
    portraitScore: byPortrait === null ? null : +byPortrait.score.toFixed(3),
    portraitMargin: byPortrait === null ? null : +byPortrait.margin.toFixed(3),
    name: byName === null ? null : byName.short,
    nameScore: byName === null ? null : +byName.score.toFixed(3),
    nameMargin: byName === null ? null : +byName.margin.toFixed(3)
  });
  if (byName !== null && (byName.confident || byPortrait === null)) {
    return byName;
  }
  // No name to settle it (plain Mickey has no strip): a near-exact portrait
  // is trusted despite the twin close behind it.
  if (byPortrait !== null && byPortrait.score >= TsumListPortrait.aloneScore) {
    return Object.assign({}, byPortrait, {confident: true});
  }
  return byPortrait;
}

/** One row of the name library: a tsum's printed name in one build. */
interface TsumListNameEntry {
  short: string;
  build: GameBuild;
  vec: number[];
}

/** The name library, loaded on first use; empty when there is none. */
var gTsumListNames: TsumListNameEntry[] | null = null;

/**
 * Read `TsumListName.library`: a `magic format w= h=` line, then one row per
 * tsum and build -- id, build, packed signature. Refused whole when its grid is
 * not this build's.
 */
function tsumListNameLibrary(): TsumListNameEntry[] {
  if (gTsumListNames !== null) {
    return gTsumListNames;
  }
  const t = TsumListName;
  const lib: TsumListNameEntry[] = [];
  gTsumListNames = lib;
  if (typeof getScriptPath !== 'function') {
    return lib;
  }
  const path = getScriptPath() + '/' + t.library;
  const lines = readFile(path).split('\n');
  let header = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '' || line.charAt(0) === '#') {
      continue;
    }
    if (!header) {
      header = true;
      const want = t.magic + ' ' + t.format + ' w=' + t.w + ' h=' + t.h;
      if (line.substring(0, want.length) !== want) {
        logWarn(Log.Tsums.StaleTemplate, {file: path, header: line});
        return lib;
      }
      continue;
    }
    const parts = line.split('\t');
    const sig = parts.length >= 3 ? myTsumUnpack(parts[2], t.w * t.h) : null;
    if (sig !== null) {
      lib.push({short: parts[0], build: parts[1] as GameBuild, vec: tsumListNamePrepare(sig)});
    }
  }
  if (lib.length === 0) {
    logWarn(Log.Tsums.NoLibrary, {reason: 'no usable rows', file: path});
  }
  return lib;
}

/** Match the panel's printed name against this build's rows of the name library. */
function tsumListMatchName(ts: Tsum, build: GameBuild): MyTsumSelection | null {
  const lib = tsumListNameLibrary();
  if (lib.length === 0) {
    return null;
  }
  const read = tsumListNameSignature(ts);
  if (read === null) {
    return null;
  }
  const vec = tsumListNamePrepare(read.sig);
  let best = -2;
  let second = -2;
  let winner = '';
  for (let i = 0; i < lib.length; i++) {
    if (lib[i].build !== build) {
      continue;
    }
    let dot = 0;
    for (let j = 0; j < vec.length; j++) {
      dot += vec[j] * lib[i].vec[j];
    }
    if (dot > best) {
      second = best;
      best = dot;
      winner = lib[i].short;
    } else if (dot > second) {
      second = dot;
    }
  }
  if (winner === '') {
    return null;
  }
  const margin = second < -1 ? best : best - second;
  return {
    short: winner,
    full: tsumListDisplayName(winner, build),
    build: build,
    score: best,
    margin: margin,
    confident: best >= TsumListName.minScore && margin >= TsumListName.minMargin
  };
}

/** The name `build` prints for `short`, off the pre-round library; the id when it has none. */
function tsumListDisplayName(short: string, build: GameBuild): string {
  const lib = myTsumLibrary();
  for (let i = 0; i < lib.length; i++) {
    if (lib[i].short === short) {
      return lib[i].names[build];
    }
  }
  return short;
}

/**
 * The panel's printed name as a signature: the text mask of the name row,
 * squashed to `TsumListName.w` x `h`, plus the row's width over height. Null
 * when no text was found. See `TsumListName` (data.ts).
 */
function tsumListNameSignature(ts: Tsum): {sig: number[]; aspect: number} | null {
  const t = TsumListName;
  const origin = ts.toRealXY(t.band.x, t.band.y);
  const w = Math.floor(t.band.w * ts.captureGameRatio);
  const h = Math.floor(t.band.h * ts.captureGameRatio);
  const img = getScreenshotModify(origin.x, origin.y, w, h, 0, 0, 100);
  if (!statsImageOk(img)) {
    return null;
  }
  let mask: NativeImage | null = null;
  let cur: NativeImage | null = null;
  try {
    mask = inRange(img, t.lo, t.lo, t.lo, 0, 255, 255, 255, 255);
    if (!statsImageOk(mask)) {
      mask = null;
      return null;
    }
    const boxes = findContours(mask, 2, 0);
    let tallest: ContourBox | null = null;
    for (let i = 0; i < boxes.length; i++) {
      if (tallest === null || boxes[i].height > tallest.height) {
        tallest = boxes[i];
      }
    }
    if (tallest === null) {
      return null;
    }
    // The row: every glyph overlapping the tallest one vertically.
    let x0 = tallest.x, y0 = tallest.y;
    let x1 = tallest.x + tallest.width, y1 = tallest.y + tallest.height;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const overlap = Math.min(b.y + b.height, tallest.y + tallest.height) - Math.max(b.y, tallest.y);
      if (overlap < Math.min(b.height, tallest.height) * t.rowOverlap) {
        continue;
      }
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width);
      y1 = Math.max(y1, b.y + b.height);
    }
    cur = cropImage(mask, x0, y0, x1 - x0, y1 - y0);
    // Halving, as statsGlyphBitmap does: one big INTER_LINEAR jump samples
    // rather than averages.
    for (;;) {
      const size = getImageSize(cur);
      if (size.width <= t.w * 2 && size.height <= t.h * 2) {
        break;
      }
      const nw = Math.max(t.w, Math.ceil(size.width / 2));
      const nh = Math.max(t.h, Math.ceil(size.height / 2));
      if (nw === size.width && nh === size.height) {
        break;
      }
      const half = resizeImage(cur, nw, nh);
      releaseImage(cur);
      cur = half;
    }
    const small = resizeImage(cur, t.w, t.h);
    releaseImage(cur);
    cur = small;
    const points: Point[] = [];
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        points.push({x: x, y: y});
      }
    }
    const read = getImageColors(cur, points);
    const sig: number[] = [];
    for (let i = 0; i < read.length; i++) {
      sig.push(read[i].r);
    }
    return {sig: sig, aspect: (x1 - x0) / (y1 - y0)};
  } finally {
    if (cur !== null) {
      releaseImage(cur);
    }
    if (mask !== null) {
      releaseImage(mask);
    }
    releaseImage(img);
  }
}

/** A name signature centred and scaled to unit length, so matching is a dot product. */
function tsumListNamePrepare(sig: number[]): number[] {
  let mean = 0;
  for (let i = 0; i < sig.length; i++) {
    mean += sig[i];
  }
  mean /= sig.length;
  let sum = 0;
  const v: number[] = [];
  for (let i = 0; i < sig.length; i++) {
    v.push(sig[i] - mean);
    sum += (sig[i] - mean) * (sig[i] - mean);
  }
  const norm = Math.sqrt(sum);
  for (let i = 0; i < v.length && norm > 0; i++) {
    v[i] /= norm;
  }
  return v;
}

/** Save the detail panel's portrait crop, for a tsum the library could not name. */
Tsum.prototype.saveCollectionPortrait = function(path) {
  const rect = TsumListPortrait.icon;
  const from = this.toRealXY(rect.from.x, rect.from.y);
  const to = this.toRealXY(rect.to.x, rect.to.y);
  const img = getScreenshotModify(from.x, from.y, to.x - from.x, to.y - from.y, 0, 0, 100);
  if (!statsImageOk(img)) {
    return;
  }
  try {
    saveImage(img, path);
    logDebug(Log.TsumList.PortraitSaved, {path: path});
  } finally {
    releaseImage(img);
  }
}

/**
 * Select the card in `slot` and read the panel. The card turning gold is the
 * proof the tap took; a tap swallowed by an animation is tried again.
 */
Tsum.prototype.readCollectionCard = function(slot, order, date, shotDir) {
  const selected = tsumListSelectCard(this, slot);
  const row: TsumListRow = {
    order: order, tsum: '', name: '', level: null, levelCap: null,
    skill: null, skillMax: null, skillProgress: null, acquired: date
  };
  if (!selected) {
    logWarn(Log.TsumList.CardMissed, 'A card would not select; its row has only the date',
      {order: order, slot: slot});
    return row;
  }
  const detail = this.readTsumDetail();
  if (detail.level !== null) {
    row.level = detail.level[0];
    row.levelCap = detail.level[1];
  }
  if (detail.skill !== null) {
    row.skill = detail.skill[0];
    row.skillMax = detail.skill[1];
    // At MAX there is nothing left to fill.
    if (row.skill < row.skillMax) {
      row.skillProgress = this.readSkillProgress();
    }
  }
  const id = this.identifyCollectionTsum();
  if (id !== null && id.confident) {
    row.tsum = id.short;
    row.name = id.full;
  } else {
    const path = shotDir + '/unnamed_' + order + '.png';
    this.saveCollectionPortrait(path);
    logInfo(Log.TsumList.Unnamed, {
      order: order,
      best: id === null ? null : id.short,
      score: id === null ? null : +id.score.toFixed(3),
      margin: id === null ? null : +id.margin.toFixed(3),
      path: path
    });
  }
  logDebug(Log.TsumList.CardRead, row as unknown as LogFields);
  return row;
}

/**
 * Wait out the portrait's selection animation. The old portrait holds still for
 * a few hundred ms after the tap, so stillness alone would read the previous
 * tsum: first wait for it to change from `before`, then for two reads in a row
 * to agree. A card whose portrait never changes (already selected) goes on at
 * the deadline. Frame-rate independent: it waits for the screen, not a clock.
 */
Tsum.prototype.awaitCollectionPortrait = function(before) {
  const startedAt = Date.now();
  let changed = before === null;
  let prev: number[] | null = null;
  const beforeVec = before === null ? null : myTsumPrepare(before);
  while (this.isRunning && Date.now() - startedAt < TsumListPortraitWaitMs) {
    this.sleep(TsumListPortraitPollMs);
    const sig = this.myTsumSignature(TsumListPortrait.icon);
    if (sig === null) {
      continue;
    }
    const vec = myTsumPrepare(sig);
    if (!changed) {
      changed = beforeVec !== null && myTsumSimilarity(beforeVec, vec) < TsumListPortraitChanged;
      prev = vec;
      continue;
    }
    if (prev !== null && myTsumSimilarity(prev, vec) >= TsumListPortraitStill) {
      logDebug(Log.TsumList.PortraitSettled, {ms: Date.now() - startedAt});
      return true;
    }
    prev = vec;
  }
  logDebug(Log.TsumList.PortraitSettled, {ms: Date.now() - startedAt, changed: changed, timedOut: true});
  return false;
}

/**
 * Percent through the current skill level: where the bar's yellow fill ends,
 * on the line `TsumListRegions.skillBar` was fitted to. 0 when there is no fill.
 */
Tsum.prototype.readSkillProgress = function() {
  const b = TsumListRegions.skillBar;
  const f = TsumListRegions.skillFill;
  const points: Coord[] = [];
  for (let y = b.fromY; y <= b.toY; y += b.stepY) {
    for (let x = b.fromX; x <= b.toX; x += b.stepX) {
      points.push({x: x, y: y});
    }
  }
  let end = -1;
  const img = this.screenshot();
  try {
    const read = this.getColors(img, points);
    for (let i = 0; i < read.length; i++) {
      const c = read[i];
      if (c.r >= f.rMin && c.g >= f.gMin && c.b <= f.bMax && points[i].x > end) {
        end = points[i].x;
      }
    }
  } finally {
    releaseImage(img);
  }
  if (end < 0) {
    return 0;
  }
  const pct = Math.round((end - b.zeroX) / (b.fullX - b.zeroX) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * The CSV, whole: the header and every row so far. `build` is the game build
 * the list was read from; `device` names the device it was read on (GAP Stats
 * filters its Catalog by it).
 */
function tsumListCsv(rows: TsumListRow[], build: GameBuild, device: string): string {
  const cell = function(v: number | null): string {
    return v === null ? '' : String(v);
  };
  const lines = [TsumListColumns.join(',')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push([String(r.order), statsCsvField(r.tsum), statsCsvField(r.name), cell(r.level),
      cell(r.levelCap), cell(r.skill), cell(r.skillMax), cell(r.skillProgress), r.acquired, build, statsCsvField(device)].join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * The export. Returns false only when it stood aside for a round in progress,
 * which the Now queue retries; anything else is done, however it ended.
 */
Tsum.prototype.taskExportTsumList = function() {
  if (roundInProgress()) {
    return false;
  }
  const stamp = statsFileStamp(new Date());
  const base = this.storagePath + '/' + Config.recordDir + '/tsum_list_' + stamp;
  const csvPath = base + '.csv';
  const build = this.gameBuild();
  // The host's device name, the one its events carry; older hosts have none.
  const device = typeof getDeviceName === 'function' ? getDeviceName() : '';
  logInfo(Log.TsumList.Start, {file: csvPath});
  this.banner('Exporting the Tsum list', 4000);

  gPages.navigate(PageName.TsumsPage);
  if (!this.awaitPage(PageName.TsumsPage, UnlockReturnWaitMs, Log.TsumList.PageMissed)) {
    logInfo(Log.TsumList.End, {tsums: 0, reason: 'no collection'});
    return true;
  }
  const previous = this.sortCollection(CollectionSort.DateAcquired, true);
  if (previous === null) {
    logInfo(Log.TsumList.End, {tsums: 0, reason: 'sort failed'});
    return true;
  }
  this.rewindCollection();

  const rows: TsumListRow[] = [];
  let unnamed = 0;
  let reason = 'page limit';
  let pages = 0;
  for (let page = 0; page < TsumListMaxPages && this.isRunning; page++) {
    pages = page + 1;
    this.awaitCollectionLoaded();
    const cards = this.readCollectionCards();
    const dates: string[] = [];
    for (let slot = 0; slot < cards.length; slot++) {
      dates.push(cards[slot] === 'empty' ? '' : this.readCardDate(slot));
    }
    let ended = false;
    for (let slot = 0; slot < cards.length && this.isRunning; slot++) {
      if (cards[slot] === 'empty') {
        ended = true;
        break;
      }
      const row = this.readCollectionCard(slot, rows.length + 1, dates[slot], base);
      if (row.tsum === '') {
        unnamed++;
      }
      rows.push(row);
    }
    try {
      writeFile(csvPath, tsumListCsv(rows, build, device));
    } catch (e) {
      logWarn(Log.TsumList.WriteFailed, 'Could not write the Tsum list', {file: csvPath, errorText: String(e)});
    }
    logInfo(Log.TsumList.PageRead, {page: pages, tsums: rows.length});
    if (ended || this.collectionAtLastPage()) {
      reason = 'end of list';
      break;
    }
    if (!tsumListTurnPage(this)) {
      logWarn(Log.TsumList.PageTurnMissed, 'The collection would not turn the page', {page: pages});
      reason = 'page turn failed';
      break;
    }
  }

  if (!this.isRunning) {
    reason = 'stopped';
  }
  // Only a whole list: a card's position in it must match the collection, so
  // a partial one would point to the wrong page.
  if (reason === 'end of list') {
    tsumListSaveFile(rows, build);
  }
  this.restoreCollectionSort(previous, CollectionSort.DateAcquired);
  logInfo(Log.TsumList.End,
    {tsums: rows.length, unnamed: unnamed, pages: pages, reason: reason, file: csvPath});
  this.banner('Tsum list: ' + rows.length + ' saved', 6000);
  return true;
}

/**
 * Tap card `slot` and wait out the portrait's animation. True once the card
 * reads gold (selected); a tap swallowed by an animation is tried again.
 */
function tsumListSelectCard(run: Tsum, slot: number): boolean {
  let selected = false;
  for (let i = 0; i < TsumListAttempts && !selected && run.isRunning; i++) {
    const before = run.myTsumSignature(TsumListPortrait.icon);
    run.tap(CollectionGrid.cells[slot]);
    run.awaitCollectionPortrait(before);
    selected = run.readCollectionCards()[slot] === 'selected';
  }
  return selected;
}

/**
 * Turn to the next page, or the previous one with `back`. A turn is proved by
 * the first card's portrait changing; a tap that landed mid-animation turns
 * nothing, so it is tried again.
 */
function tsumListTurnPage(run: Tsum, back?: boolean): boolean {
  const before = run.myTsumSignature(tsumListCellRect(0));
  let turned = false;
  for (let i = 0; i < TsumListAttempts && !turned && run.isRunning; i++) {
    run.tap(back ? CollectionGrid.prevPage : CollectionGrid.nextPage);
    run.settleScreen(UnlockPageTurnSettleMs);
    const after = run.myTsumSignature(tsumListCellRect(0));
    turned = before === null || after === null || myTsumSimilarity(myTsumPrepare(before), myTsumPrepare(after)) < 0.98;
  }
  return turned;
}

/** The tsum art on card `slot`, for telling one page from the next. */
function tsumListCellRect(slot: number): MyTsumRect {
  const c = CollectionGrid.cells[slot];
  return {from: {x: c.x - 60, y: c.y - 70}, to: {x: c.x + 60, y: c.y + 50}};
}

/** `tsum_list_<device id>.json`: one row per card, in Date acquired order. */
interface TsumListFile {
  at: string;
  build: GameBuild;
  tsums: { order: number; tsum: string; name: string }[];
}

/** Where this device's list file is; '' on a host without the natives. */
function tsumListFilePath(): string {
  if (typeof getStoragePath !== 'function' || typeof getDeviceId !== 'function') {
    return '';
  }
  return getStoragePath() + '/' + Config.recordDir + '/tsum_list_' + getDeviceId() + '.json';
}

/** Writes this device's list file from a whole export. Never throws. */
function tsumListSaveFile(rows: TsumListRow[], build: GameBuild): void {
  const path = tsumListFilePath();
  if (path === '') {
    return;
  }
  const file: TsumListFile = { at: new Date().toISOString(), build: build, tsums: [] };
  for (let i = 0; i < rows.length; i++) {
    file.tsums.push({ order: rows[i].order, tsum: rows[i].tsum, name: rows[i].name });
  }
  try {
    writeFile(path, JSON.stringify(file));
    logInfo(Log.TsumList.FileWritten, 'Saved the Tsum list for workflows',
      { file: path, tsums: rows.length });
  } catch (e) {
    logWarn(Log.TsumList.WriteFailed, 'Could not write the Tsum list', { file: path, errorText: String(e) });
  }
}

/** This device's list file, or null when it is missing or unreadable. */
function tsumListLoadFile(): TsumListFile | null {
  const path = tsumListFilePath();
  try {
    const text = path === '' ? '' : readFile(path);
    if (text === '') {
      return null;
    }
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.tsums)) {
      return null;
    }
    const tsums: TsumListFile['tsums'] = [];
    for (let i = 0; i < parsed.tsums.length; i++) {
      const row = parsed.tsums[i];
      if (row !== null && typeof row === 'object' && typeof row.order === 'number'
          && typeof row.tsum === 'string') {
        tsums.push({ order: row.order, tsum: row.tsum, name: typeof row.name === 'string' ? row.name : '' });
      }
    }
    return { at: String(parsed.at || ''), build: parsed.build, tsums: tsums };
  } catch (e) {
    return null;
  }
}
