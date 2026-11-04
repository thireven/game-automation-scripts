// KH2 Cloud (Cloud KH2ver.).
//
// His gauge charges twice. The first charge can be fired, but the skill is far
// stronger on the second, so this reads its own gauge (`gauge`) and answers
// Active only on the second. Otherwise he activates like a burst.
//
// The button, read as a ring of patches between its rim and Cloud's head:
//   filling      navy, with a cyan pie filling clockwise from 12 o'clock
//   1st charge   a short white/pastel flash, then gold (pulsing yellow to
//                brown) with a pearlescent pie filling clockwise over it
//   2nd charge   pearlescent all round (pastel pink, green, lavender, cyan),
//                pulsing white now and then; stays until tapped
//   activation   the cut-in darkens the button ~1.8s, a white flash, then navy
//
// A full pearl ring is not enough on its own: the 1st charge's flash and
// one-frame white flashes while the gauge fills read the same, colours
// included. Time tells them apart. A full ring counts once gold was first
// seen `goldMs` ago, or, if no read caught the gold, once full pearl has held
// over `fallbackReads` reads and `fallbackMs`. Every flash is gone well inside
// either. An empty or dark ring, a tap, or a new round starts over.
//
// Measured on an 11-minute recording (20 second charges): replayed at read
// gaps of 0.1-1.2s, no first charge or flash the script could meet read Active.

// ---------------------------------------------------------------------------
// Tuning data
// ---------------------------------------------------------------------------

/**
 * 22 points between the button's rim and Cloud's head, clockwise from 15 deg
 * past 12 o'clock (logical px). 0 and 345 deg are left out: his hair covers
 * them. The same band as `VillainsGaugeRing`, on an even ellipse.
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
  /** Pearl points over gold that read Almost: the pie nearly closed. */
  almostMin: 14,
  /**
   * How long gold must have been seen before a full ring counts. The 1st
   * charge's flash ends within 0.5s of its first gold frame; the quickest
   * 2nd charge came 1.2s after it.
   */
  goldMs: 800,
  /** With no gold seen: full reads in a row, and how long they must span. */
  fallbackReads: 3,
  fallbackMs: 1500
};

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
  if (max < 90) { return 'dark'; }
  return 'other';
}

// ---------------------------------------------------------------------------

/** What the reads have seen since the gauge last emptied. Times are epoch ms. */
var gCloudGauge = {
  goldAt: 0,       // first gold read
  fullAt: 0,       // first of the current run of full reads (fallback)
  fullReads: 0,
  logged: false,   // the 2nd charge was logged
  firedAt: 0,      // `ts.skillFiredAt` and `ts.roundStartedAt` at the last read
  roundAt: 0
};

function cloudGaugeReset() {
  gCloudGauge.goldAt = 0;
  gCloudGauge.fullAt = 0;
  gCloudGauge.fullReads = 0;
  gCloudGauge.logged = false;
}

function cloudGaugeClassify(colors: Color[], ts: Tsum): SkillReadiness {
  const g = gCloudGauge;
  // A tap or a new round since the last read: what was seen is stale.
  if (g.firedAt !== ts.skillFiredAt || g.roundAt !== ts.roundStartedAt) {
    cloudGaugeReset();
    g.firedAt = ts.skillFiredAt;
    g.roundAt = ts.roundStartedAt;
  }
  let empty = 0, gold = 0, pearl = 0, dark = 0;
  for (const c of colors) {
    const t = cloudGaugeTone(c);
    if (t === 'navy' || t === 'cyan') { empty++; }
    else if (t === 'gold') { gold++; }
    else if (t === 'pearl') { pearl++; }
    else if (t === 'dark') { dark++; }
  }
  const now = Date.now();
  if (empty >= CloudGauge.emptyMin || dark >= CloudGauge.darkMin) {
    cloudGaugeReset();
    return SkillReadiness.Far;
  }
  if (gold >= CloudGauge.goldMin) {
    if (g.goldAt === 0) {
      g.goldAt = now;
      logInfo(Log.Skill.CloudFirstCharge, { pearl: pearl });
    }
    g.fullAt = 0;
    g.fullReads = 0;
    return pearl >= CloudGauge.almostMin ? SkillReadiness.Almost : SkillReadiness.Far;
  }
  if (pearl < CloudGauge.fullMin || gold > CloudGauge.fullGoldMax || empty > 0) {
    return SkillReadiness.Far;
  }
  // A full ring.
  let via = '';
  if (g.goldAt > 0 && now - g.goldAt >= CloudGauge.goldMs) {
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

registerSkill({
  types: [SkillType.KH2Cloud],
  bareTapActivates: true,
  gauge: {points: CloudGaugeRing, classify: cloudGaugeClassify}
});
