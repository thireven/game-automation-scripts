// KH2 Cloud (Cloud KH2ver.).
//
// His gauge charges twice. The first charge can be fired, but the skill is far
// stronger on the second, so this reads its own gauge (`gauge`) and answers
// Active only on the second. Otherwise he activates like a burst.
//
// The button, read as a ring of patches between its rim and Cloud's head:
//   filling      navy, with a cyan pie filling clockwise from 12 o'clock
//   1st charge   a short white/pastel flash, then gold (pulsing yellow to
//                brown) with a pearlescent pie filling clockwise over it.
//                The pie's last slice, 340-360 deg, can stay gold for seconds:
//                a notch at the top rim (`CloudGaugeTop`). It is not full yet.
//   2nd charge   pearlescent all round (pastel pink, green, lavender, cyan),
//                pulsing white now and then; stays until tapped
//   activation   the cut-in darkens the button ~1.8s, a white flash, then navy
//
// Full means the ring pearl and the top slice neither gold nor warm peach (a
// Cloud head flying into the gauge covers the notch with its face).
//
// A full ring is not enough on its own: the 1st charge's flash and one-frame
// white flashes while the gauge fills read the same, colours included. Time
// tells them apart. A full ring counts once gold was first seen `goldMs` ago
// and it still reads full `confirmMs` later, or, if no read caught the gold,
// once it has held over `fallbackReads` reads in a row and `fallbackMs`. Every
// flash is gone well inside either. An empty or dark ring, a tap, or a new
// round starts over. One wash is not gone: the last seconds' cyan edge wash
// (`EdgeWash`) paints gold pale too, so with ~5-6s left gold can read full
// and fire. That is when the clock rule below fires it anyway.
//
// Near the round's end the 1st charge is fired after all, rather than wasted:
// while gold is up the round clock is read (`cloudReadClock`), and two reads
// `confirmMs` apart at `CloudClock.goldLastSeconds` or less fire it. Two, so
// one misread cannot spend a charge mid-round. At 0 the round is over (TIME UP
// dims the HUD) and nothing fires.
//
// Measured on an 11-minute recording (20 second charges), replayed at read
// gaps of 0.1-1.2s: a 2nd charge only ever fired once the notch had closed,
// and a 1st charge only with 1-6s left. The clock read: every frame of that
// recording (no misreads; the +5s fever bonus is the only jump) and all 21
// corpus GamePlaying captures (540, 1080 and 360 wide). A digit must sit in
// its slot, so a tens digit hidden under a tsum reads unknown, not low.
//
// The pearl is the game's colour wheel spinning ~1 turn/s under a white flash
// pulsing every 0.5s (`game/GameUI_multiple_ff.xml`, lv3). Rendered from that
// art (matched to lossless screenshots within ~5/255): a full 2nd charge reads
// full on 77% of frames, a read and its second look both on 56%, so it fires
// within 3 reads 99% of the time. No pie short of ~358 deg reads full.

// ---------------------------------------------------------------------------
// Tuning data
// ---------------------------------------------------------------------------

/**
 * 22 points between the button's rim and Cloud's head, clockwise from 15 deg
 * past 12 o'clock to 330 (logical px). The same band as `VillainsGaugeRing`,
 * on an even ellipse. Checked on the corpus's device captures, 540 and 1080
 * wide: every point lands on the gauge face, and still does shifted 8px.
 */
const CloudGaugeRing: Coord[] = [
  {x: 184, y: 1558},  //  15 deg
  {x: 204, y: 1566},  //  30
  {x: 221, y: 1578},  //  45
  {x: 235, y: 1595},  //  60
  {x: 243, y: 1614},  //  75
  {x: 246, y: 1635},  //  90
  {x: 243, y: 1656},  // 105
  {x: 235, y: 1675},  // 120
  {x: 221, y: 1692},  // 135
  {x: 204, y: 1704},  // 150
  {x: 184, y: 1712},  // 165
  {x: 162, y: 1715},  // 180
  {x: 140, y: 1712},  // 195
  {x: 120, y: 1704},  // 210
  {x: 103, y: 1692},  // 225
  {x: 89, y: 1675},   // 240
  {x: 81, y: 1656},   // 255
  {x: 78, y: 1635},   // 270
  {x: 81, y: 1614},   // 285
  {x: 89, y: 1595},   // 300
  {x: 103, y: 1578},  // 315
  {x: 120, y: 1566}   // 330
];

/**
 * The top of the same ellipse, 340-360 deg: the 2nd charge's last slice. Read
 * gold there for up to 2s+ while the rest of the ring is pearl, before every
 * 2nd charge in the recording; never hair (navy while the gauge fills).
 */
const CloudGaugeTop: Coord[] = [
  {x: 133, y: 1559},  // 340 deg
  {x: 140, y: 1557},  // 345
  {x: 147, y: 1556},  // 350
  {x: 154, y: 1555},  // 355
  {x: 162, y: 1555}   // 360
];

const CloudGauge = {
  /** Navy + cyan points: the gauge is still filling. */
  emptyMin: 6,
  /** Dark points: the activation's cut-in. */
  darkMin: 15,
  /** Gold points: the 1st charge. */
  goldMin: 5,
  /** Pearl points (of 22) for a full ring... */
  fullMin: 20,
  /** ...with at most this many gold: the pearl's own yellow band. */
  fullGoldMax: 1,
  /** ...and navy/cyan: the pearl's teal can come close to the gauge's cyan. */
  fullEmptyMax: 1,
  /** Pearl points over gold that read Almost: the pie nearly closed. */
  almostMin: 14,
  /**
   * Gold points of `CloudGaugeTop` that make an otherwise full ring the 1st
   * charge still (the notch spans all five); any gold there blocks a full read.
   */
  topGoldMin: 3,
  /**
   * How long gold must have been seen before a full ring counts. The 1st
   * charge's flash ends within 0.5s of its first gold frame; the quickest
   * 2nd charge came 1.4s after it.
   */
  goldMs: 800,
  /**
   * A full ring is looked at again this much later, once per charge: a Cloud
   * head flying into the gauge covered the notch for ~0.1s in the recording.
   */
  confirmMs: 150,
  /** With no gold seen: full reads in a row, and how long they must span. */
  fallbackReads: 3,
  fallbackMs: 1500
};

/** The round clock, top left: white digits on the clock face. */
const CloudClock = {
  /** The box both digits sit in (logical px), sampled every `step`. */
  x0: 104, x1: 224, y0: 226, y1: 306, step: 2,
  /** A digit's fill: bright and unsaturated. White, or pale cyan under the last seconds' wash. */
  fillMin: 170, fillSpread: 90,
  /** A digit's size (logical px). Anything bigger over the clock makes the read unknown. */
  hMin: 40, hMax: 64, wMin: 8, wMax: 46,
  /** Width / height may differ from the template's by this much ("1": 0.2-0.6). */
  aspectTol: 0.18,
  /** A match: mean cell difference at most `scoreMax`, beating the next digit by `marginMin`. */
  scoreMax: 0.22, marginMin: 0.04,
  /** Fire the 1st charge with this many seconds left or fewer. 0 is time up: too late. */
  goldLastSeconds: 5,
  /** A clock read is reused this long, so `useSkill`'s two gauge reads cost one. */
  reuseMs: 150,
  /**
   * Where each digit's centre sits (logical x). Measured: one digit 156-162,
   * two digits 135-140 and 178-184.
   */
  oneX: [148, 172], tensX: [125, 150], unitsX: [168, 195],
  /** A low read is confirmed by a second this much later. */
  confirmMs: 50
};

/**
 * The clock's digits 0-9: the game's `game_num_36_white_comma` glyphs (the
 * clock's font), each glyph's white fill cut to its box and averaged onto an
 * 8x12 grid, row by row, 0-9 per cell. `aspect` is the box's width / height.
 */
const CloudClockDigits: {cells: string, aspect: number}[] = [
  {cells: '003883000397696029700593696003967930029799300098993000976940019759600396298006930694388100478510', aspect: 0.78},
  {cells: '000299970369999949449999000099990000999900009999000099990000999900009999000099990000999900003694', aspect: 0.45},
  {cells: '028999601994389549600399492001990200049900003895000499800069961004994000298300006960000079999999', aspect: 0.80},
  {cells: '004894200896698139400696040006960000079200299810000448920000049745000399892004963983389302698620', aspect: 0.75},
  {cells: '000069200002995000089930003949300085393004803930094039304800393098668986699999990000393000002920', aspect: 0.75},
  {cells: '299999943983333239600000596233003999996039834894392004960000039934000398790006954960299205999720', aspect: 0.80},
  {cells: '003694200696689129700194696000006956662089833893693004966930039959600398396004960792189200578620', aspect: 0.75},
  {cells: '799999984999999900000398000007930000299000008950000399200007970000299300005990000099400000880000', aspect: 0.73},
  {cells: '026998200894498139800693397006930990099203977930398338938940039899300399894003994981179503699740', aspect: 0.77},
  {cells: '029998202982288169400694893004969930039679400498398348960399849600000596280008934941498004798510', aspect: 0.77}
];
const CloudClockGridW = 8;
const CloudClockGridH = 12;

type CloudGaugeTone = 'navy' | 'cyan' | 'gold' | 'pearl' | 'dark' | 'other';

function cloudGaugeTone(c: Color): CloudGaugeTone {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (c.g <= 140 && c.b >= 110 && c.b - c.g >= 35 && c.r <= 120) { return 'navy'; }  // ~(70,100,153)
  // The gauge's cyan, ~(32,200,237). The pearl's cyan band has r >= 100.
  if (c.r <= 85 && c.g >= 160 && c.b >= 190) { return 'cyan'; }
  // Yellow ~(238,226,46) to brown ~(144,90,39). The pearl rarely has r - b > 80.
  if (c.r >= 120 && c.r - c.b >= 90 && c.b <= 110) { return 'gold'; }
  if (min >= 100 && max >= 170) { return 'pearl'; }  // pastel or white
  // The pearl's saturated band, mint/teal/lime ~(90,209,215), (127,224,97):
  // spans ~100 deg in lossless captures; the recording's compression hid it.
  if (max >= 195 && min >= 70 && c.g >= 190) { return 'pearl'; }
  if (max < 90) { return 'dark'; }
  return 'other';
}

// ---------------------------------------------------------------------------

/** What the reads have seen since the gauge last emptied. Times are epoch ms. */
var gCloudGauge = {
  goldAt: 0,       // first gold read
  fullAt: 0,       // first of the current run of full reads (fallback)
  fullReads: 0,
  logged: false,   // the firing was logged
  confirmed: false, // the full ring held on a second look `confirmMs` later
  clockAt: 0,      // last clock read
  outOfTime: false, // the clock was read low twice: fire the 1st charge
  firedAt: 0,      // `ts.skillFiredAt` and `ts.roundStartedAt` at the last read
  roundAt: 0
};

function cloudGaugeReset() {
  gCloudGauge.goldAt = 0;
  gCloudGauge.fullAt = 0;
  gCloudGauge.fullReads = 0;
  gCloudGauge.logged = false;
  gCloudGauge.confirmed = false;
  gCloudGauge.clockAt = 0;
  gCloudGauge.outOfTime = false;
}

/** How many samples in one column of the clock read are digit fill. */
function cloudColumnFill(col: boolean[]): number {
  let n = 0;
  for (const on of col) { if (on) { n++; } }
  return n;
}

/**
 * One digit: columns `a`..`b` of the fill mask. The digit, -1 if it cannot
 * be read, or -2 for a speck too small to matter.
 */
function cloudReadDigit(fill: boolean[][], a: number, b: number): number {
  const c = CloudClock;
  let top = Infinity, bottom = -1, count = 0;
  for (let i = a; i <= b; i++) {
    for (let j = 0; j < fill[i].length; j++) {
      if (!fill[i][j]) { continue; }
      count++;
      top = Math.min(top, j);
      bottom = Math.max(bottom, j);
    }
  }
  const bw = b - a + 1, bh = bottom - top + 1;
  if (bh * c.step < c.hMin || bh * c.step > c.hMax
      || bw * c.step < c.wMin || bw * c.step > c.wMax) {
    return count >= 6 ? -1 : -2;
  }
  // The box's fill averaged onto the template grid.
  const cells: number[] = [];
  for (let gy = 0; gy < CloudClockGridH; gy++) {
    const y0 = Math.floor(gy * bh / CloudClockGridH);
    const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * bh / CloudClockGridH));
    for (let gx = 0; gx < CloudClockGridW; gx++) {
      const x0 = Math.floor(gx * bw / CloudClockGridW);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * bw / CloudClockGridW));
      let n = 0, on = 0;
      for (let x = x0; x < x1; x++) {
        for (let y = y0; y < y1; y++) {
          n++;
          if (fill[a + x][top + y]) { on++; }
        }
      }
      cells.push(on / n);
    }
  }
  const aspect = bw / bh;
  let best = Infinity, next = Infinity, digit = -1;
  for (let d = 0; d < CloudClockDigits.length; d++) {
    const t = CloudClockDigits[d];
    const fits = Math.abs(aspect - t.aspect) <= c.aspectTol
      || (d === 1 && aspect >= 0.2 && aspect <= 0.6);
    if (!fits) { continue; }
    let diff = 0;
    for (let k = 0; k < cells.length; k++) {
      diff += Math.abs(cells[k] - (t.cells.charCodeAt(k) - 48) / 9);
    }
    diff /= cells.length;
    if (diff < best) { next = best; best = diff; digit = d; }
    else if (diff < next) { next = diff; }
  }
  if (digit < 0 || best > c.scoreMax || next - best < c.marginMin) { return -1; }
  return digit;
}

/**
 * The round clock's seconds left, or -1 when it cannot be read (a popup or
 * flash over it, three digits, a poor match). One crop at native resolution.
 */
function cloudReadClock(ts: Tsum): number {
  const c = CloudClock;
  const cols = Math.floor((c.x1 - c.x0) / c.step);
  const rows = Math.floor((c.y1 - c.y0) / c.step);
  const tl = ts.toRealXY(c.x0, c.y0);
  const br = ts.toRealXY(c.x1, c.y1);
  const ox = Math.max(0, tl.x), oy = Math.max(0, tl.y);
  const w = Math.max(1, br.x - ox), h = Math.max(1, br.y - oy);
  const pts: Point[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const p = ts.toRealXY(c.x0 + i * c.step, c.y0 + j * c.step);
      pts.push({x: Math.min(w - 1, Math.max(0, p.x - ox)),
        y: Math.min(h - 1, Math.max(0, p.y - oy))});
    }
  }
  const img = getScreenshotModify(ox, oy, w, h, 0, 0, 100);
  let colors: Color[];
  try {
    colors = getImageColors(img, pts);
  } finally {
    releaseImage(img);
  }
  const fill: boolean[][] = [];
  for (let i = 0; i < cols; i++) {
    const col: boolean[] = [];
    for (let j = 0; j < rows; j++) {
      const k = colors[i * rows + j];
      const max = Math.max(k.r, k.g, k.b), min = Math.min(k.r, k.g, k.b);
      col.push(min >= c.fillMin && max - min <= c.fillSpread);
    }
    fill.push(col);
  }
  // Each run of columns with 2+ fill samples is one digit.
  const digits: number[] = [], centres: number[] = [];
  let i = 0;
  while (i < cols) {
    if (cloudColumnFill(fill[i]) < 2) { i++; continue; }
    const a = i;
    while (i < cols && cloudColumnFill(fill[i]) >= 2) { i++; }
    const d = cloudReadDigit(fill, a, i - 1);
    if (d === -2) { continue; }
    if (d < 0 || digits.length === 2) { return -1; }
    digits.push(d);
    centres.push(c.x0 + (a + i - 1) / 2 * c.step);
  }
  // The number is centred, so each digit has its slot: a units digit alone
  // is a tens digit hidden under something, not a single-digit clock.
  const slots = digits.length === 1 ? [c.oneX] : [c.tensX, c.unitsX];
  if (digits.length === 0
      || centres.some((x, k) => x < slots[k][0] || x > slots[k][1])) { return -1; }
  return digits.length === 1 ? digits[0] : digits[0] * 10 + digits[1];
}

function cloudLowSeconds(secs: number): boolean {
  return secs >= 1 && secs <= CloudClock.goldLastSeconds;
}

/**
 * Whether the round is nearly over. A low read is confirmed by a second one
 * `confirmMs` later, not on the next turn: gold can arrive with a second
 * left. Reads at most every `reuseMs`; once confirmed, it stays so until the
 * gauge read starts over.
 */
function cloudOutOfTime(ts: Tsum, now: number): boolean {
  const g = gCloudGauge;
  const c = CloudClock;
  if (g.outOfTime) { return true; }
  if (now - g.clockAt < c.reuseMs) { return false; }
  g.clockAt = now;
  const first = cloudReadClock(ts);
  if (!cloudLowSeconds(first)) { return false; }
  ts.sleep(c.confirmMs);
  const second = cloudReadClock(ts);
  g.outOfTime = cloudLowSeconds(second) && second <= first;
  return g.outOfTime;
}

interface CloudGaugeLook {
  empty: number;    // navy + cyan, of the ring
  gold: number;
  pearl: number;
  dark: number;
  topGold: number;  // gold of `CloudGaugeTop`
  topWarm: number;  // ...gold or warm peach: not provably closed
}

/**
 * Warm peach to pale gold: the notch's bright pulse, or the face of a Cloud
 * head flying into the gauge over it (~(251,204,156)). Real pearl reads this
 * at the top on 16% of looks, which only delays a read.
 */
function cloudWarm(c: Color): boolean {
  return c.r >= 180 && c.r - c.b >= 70 && c.r >= c.g && c.g >= c.b;
}

/** Tone counts of one read: the ring's colours first, then `CloudGaugeTop`'s. */
function cloudGaugeLook(colors: Color[]): CloudGaugeLook {
  const look = {empty: 0, gold: 0, pearl: 0, dark: 0, topGold: 0, topWarm: 0};
  for (let i = 0; i < colors.length; i++) {
    const t = cloudGaugeTone(colors[i]);
    if (i >= CloudGaugeRing.length) {
      if (t === 'gold') { look.topGold++; }
      if (t === 'gold' || cloudWarm(colors[i])) { look.topWarm++; }
    } else if (t === 'navy' || t === 'cyan') { look.empty++; }
    else if (t === 'gold') { look.gold++; }
    else if (t === 'pearl') { look.pearl++; }
    else if (t === 'dark') { look.dark++; }
  }
  return look;
}

/** A full pearl ring, its top slice closed. */
function cloudLookFull(look: CloudGaugeLook): boolean {
  return look.pearl >= CloudGauge.fullMin && look.gold <= CloudGauge.fullGoldMax
    && look.empty <= CloudGauge.fullEmptyMax && look.topWarm === 0;
}

function cloudGaugeClassify(colors: Color[], ts: Tsum): SkillReadiness {
  const g = gCloudGauge;
  // A tap or a new round since the last read: what was seen is stale.
  if (g.firedAt !== ts.skillFiredAt || g.roundAt !== ts.roundStartedAt) {
    cloudGaugeReset();
    g.firedAt = ts.skillFiredAt;
    g.roundAt = ts.roundStartedAt;
  }
  const look = cloudGaugeLook(colors);
  const {empty, gold, pearl, dark, topGold} = look;
  const now = Date.now();
  if (empty >= CloudGauge.emptyMin || dark >= CloudGauge.darkMin) {
    cloudGaugeReset();
    return SkillReadiness.Far;
  }
  // Gold, or the pearl pie's last slice (the gold notch at the top) still open.
  if (gold >= CloudGauge.goldMin || (topGold >= CloudGauge.topGoldMin && empty === 0)) {
    if (g.goldAt === 0) {
      g.goldAt = now;
      logInfo(Log.Skill.CloudFirstCharge, { pearl: pearl });
    }
    g.fullAt = 0;
    g.fullReads = 0;
    if (cloudOutOfTime(ts, now)) {
      if (!g.logged) {
        g.logged = true;
        logInfo(Log.Skill.CloudOutOfTime, { pearl: pearl });
      }
      return SkillReadiness.Active;
    }
    return pearl >= CloudGauge.almostMin ? SkillReadiness.Almost : SkillReadiness.Far;
  }
  if (!cloudLookFull(look)) {
    // Not full: the held-full fallback counts full reads in a row only.
    g.fullAt = 0;
    g.fullReads = 0;
    return SkillReadiness.Far;
  }
  // A full ring.
  let via = '';
  if (g.goldAt > 0 && now - g.goldAt >= CloudGauge.goldMs) {
    // Once per charge: a tsum flying into the gauge can cover the notch.
    if (!g.confirmed) {
      ts.sleep(CloudGauge.confirmMs);
      g.confirmed = cloudLookFull(cloudGaugeLook(skillGaugeMeansCrop(ts, CloudGaugeRead)));
      if (!g.confirmed) { return SkillReadiness.Almost; }
    }
    via = 'gold';
  } else {
    if (g.fullAt === 0) {
      g.fullAt = now;
      g.fullReads = 0;
    }
    g.fullReads++;
    if (g.fullReads >= CloudGauge.fallbackReads && now - g.fullAt >= CloudGauge.fallbackMs) {
      via = 'held';
    }
  }
  if (!via) { return SkillReadiness.Almost; }
  if (!g.logged) {
    g.logged = true;
    logInfo(Log.Skill.CloudSecondCharge, { via: via,
      goldMs: g.goldAt > 0 ? now - g.goldAt : -1 });
  }
  return SkillReadiness.Active;
}

const CloudGaugeRead: SkillGaugeRead = {
  points: CloudGaugeRing.concat(CloudGaugeTop),
  classify: cloudGaugeClassify
};

registerSkill({
  types: [SkillType.KH2Cloud],
  bareTapActivates: true,
  gauge: CloudGaugeRead
});
