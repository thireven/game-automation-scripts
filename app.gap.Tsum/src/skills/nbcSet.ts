// Nightmare Before Christmas (Set).
//
// Each activation fires a character skill (Jack, Sally, Zero, the Mayor, the
// pumpkins), each opening on its own cut-in.
//
// Oogie Boogie's roll (below) adds tsums on 7+ and shrinks every tsum to fit,
// more with each such roll -- from 25px apart to ~19 in the play square by the
// end of a round. At normal size the circle pass then finds about half of them, off
// centre, and the link reach spans hops the game refuses, so no chain lands.
// `scalesBoard` has each scan read the size and scale the board read to it
// (`updateBoardScale`, `Config.boardScale`).
//
// Only Oogie's dice change the size, so the scale holds at 1 until his first
// roll, then follows the reads only the way the roll points
// (`boardScaleTrend`): smaller after 7+, bigger after a roll under 7.
//
// `colorBlur` 15: at the default 22 Sally's blue face and red hood average to
// a pale colour that clusters with Jack and Zero, so white chains ran through
// her and the game refused them. 15 keeps her apart (offline: 12% of
// clustered tsums in the wrong group down to 1%).
//
// Oogie Boogie sometimes follows one of those, seconds after the tap (3.5-4.5s
// in the 18-21-30 recording), never on the tap itself. He rolls two dice: a
// total of 7 or more adds tsums, under 7 removes some. Any touch while they
// roll throws them again, once -- and the play loop chaining on used to spend
// that reroll on every roll, good or bad. So each board scan looks for his green
// cut-in (`watchScan`, `nbcOogieSeen`); from there nothing touches the board
// until the roll is known: the dice are read where they come to rest
// (`nbcLook`), and only a first roll under 7 gets the reroll tap. Watching
// the scans rather than holding after the tap leaves the play loop free for
// the activations he does not follow. The play loop's `while (useSkill())`
// takes no scans, and its skill and fan taps would throw the dice too, so each
// of its taps looks first (`beforeActivate`).

// --- Tuning data -----------------------------------------------------------

// Measured off the 2026-10-01 NBC recordings. Positions and sizes are in a
// 540px-wide capture of the play square.
var NbcDice = {
  // Oogie's green face as a share of the scan's capture: ~0.10 whenever he is
  // up, where nothing else in either recording passed 0.056 (Zero's rainbow,
  // touching green tsums). Fading in he reads lower for a scan or two.
  greenMin: 0.075,
  pollMs: 40,
  scan: 540,
  // A die's lit top face: one bright-red blob of at least this contour area.
  faceMinArea: 1500,
  // Where each top face (bounding box top-left) comes to rest, left die first.
  // Every throw lands there; a die anywhere else is still rolling.
  rest: [{x: 124, y: 246}, {x: 294, y: 166}],
  restTolerance: 14,
  // Identical reads in a row before a landing counts. A tumble passes through
  // sharp, readable poses, but never twice in the same place.
  stableReads: 2,
  // ...and on the first roll, held this long: a die rocking at its rest spot
  // can show the wrong face for ~130ms before it settles, and a reroll spent
  // on that throws away a good roll. The first landing holds ~850ms; the
  // reroll's lands just before the result covers it, so it takes the reads.
  settleMs: 250,
  // Pip blob: area against the face's bounding box, and how much of its own box
  // it fills. The skull engraved on every face is a sparse blob; a pip on a
  // shaded side face is taller than wide. Areas are `findContours`' outline
  // areas. The device's capture draws pips about a pixel smaller than a screen
  // recording (where these were measured), which put a 5's or 6's back pip
  // under 0.009 / 0.55; these hold with every pip shrunk by a pixel.
  pipMinRel: 0.006,
  pipMaxRel: 0.06,
  pipMinFill: 0.45,
  // Lowest a top-face pip's centre sits in the die's box (top-face pips reach
  // 0.7). The front face's top row shows at 0.9 and passes the ring test,
  // since that face is lit red too.
  pipMaxY: 0.8,
  // A top-face pip has lit face red this far to its left and right, and above or
  // below it (the corner pips sit on the face's edge on one side).
  ringPad: 4,
  // From the cut-in to a landing (the dice tumble ~1s), and from the reroll tap
  // to the dice leaving their rest.
  landWaitMs: 4000,
  rethrowWaitMs: 800,
  // Held after the roll until the dice are gone, so no touch lands while they
  // still count.
  clearWaitMs: 3000,
  // Neither Oogie nor a die on screen this long: the roll is over (Oogie fades
  // into the dice within 0.2s). Catches the green skull over a finished roll,
  // which also reads as Oogie, without holding touches on an empty board.
  goneMs: 500,
  rerollBelow: 7,
};

interface NbcRange { lo: Color; hi: Color }

var NbcFaceRed: NbcRange = {lo: {r: 140, g: 0, b: 0}, hi: {r: 255, g: 60, b: 90}};
var NbcPip: NbcRange = {lo: {r: 18, g: 0, b: 0}, hi: {r: 125, g: 16, b: 16}};
var NbcGreen: NbcRange = {lo: {r: 0, g: 180, b: 0}, hi: {r: 170, g: 255, b: 150}};

// --- Reading ---------------------------------------------------------------

/** The play square, captured `width` px square; null if the capture failed. */
function nbcCapture(ts: Tsum, width: number): NativeImage | null {
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, ts.playHeight,
    width, width, 100);
  return (img as unknown as number) ? img : null;
}

/** inRange with RGB bounds (the native takes BGRA). */
function nbcMask(img: NativeImage, range: NbcRange): NativeImage | null {
  const m = inRange(img, range.lo.b, range.lo.g, range.lo.r, 0,
    range.hi.b, range.hi.g, range.hi.r, 255);
  return (m as unknown as number) ? m : null;
}

/** Area of the largest blob in `range`. */
function nbcLargestBlob(img: NativeImage, range: NbcRange): number {
  const mask = nbcMask(img, range);
  if (!mask) { return 0; }
  try {
    const boxes = findContours(mask, 50, 0);
    let best = 0;
    for (let i = 0; i < boxes.length; i++) { best = Math.max(best, boxes[i].area); }
    return best;
  } finally {
    releaseImage(mask);
  }
}

/** Oogie's green share of `img` when his cut-in is up, else 0. */
function nbcOogieSeen(img: NativeImage): number {
  const size = getImageSize(img);
  const green = nbcLargestBlob(img, NbcGreen) / (size.width * size.height);
  return green >= NbcDice.greenMin ? green : 0;
}

function nbcIsFaceRed(c: Color): boolean {
  return c.r >= NbcFaceRed.lo.r && c.g <= NbcFaceRed.hi.g && c.b <= NbcFaceRed.hi.b;
}

/** Pips on one die's top face: dark holes in its lit red, side-face pips left out. */
function nbcCountPips(img: NativeImage, face: ContourBox): number {
  const cfg = NbcDice;
  // A few px above the face, for the back corner's pip on its top edge.
  const y0 = Math.max(0, face.y - 6);
  const crop = cropImage(img, face.x, y0, face.width, face.y + face.height - y0);
  let mask: NativeImage | null = null;
  try {
    mask = nbcMask(crop, NbcPip);
    if (!mask) { return 0; }
    const blobs = findContours(mask, 1, 0);
    const box = face.width * face.height;
    const pips: ContourBox[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const rel = b.area / box;
      if (rel < cfg.pipMinRel || rel > cfg.pipMaxRel) { continue; }
      if (b.area / (b.width * b.height) < cfg.pipMinFill) { continue; }
      if (b.height > b.width * 1.05) { continue; }
      if (y0 + b.y + b.height / 2 - face.y > face.height * cfg.pipMaxY) { continue; }
      pips.push(b);
    }
    if (pips.length === 0) { return 0; }
    // Three samples on each side of each pip: left, right, above, below.
    const pts: Point[] = [];
    for (let i = 0; i < pips.length; i++) {
      const b = pips[i];
      const cx = face.x + b.x + Math.floor(b.width / 2);
      const cy = y0 + b.y + Math.floor(b.height / 2);
      const dx = Math.floor(b.width / 2) + cfg.ringPad;
      const dy = Math.floor(b.height / 2) + cfg.ringPad;
      for (let d = -2; d <= 2; d += 2) { pts.push({x: cx - dx, y: cy + d}); }
      for (let d = -2; d <= 2; d += 2) { pts.push({x: cx + dx, y: cy + d}); }
      for (let d = -2; d <= 2; d += 2) { pts.push({x: cx + d, y: cy - dy}); }
      for (let d = -2; d <= 2; d += 2) { pts.push({x: cx + d, y: cy + dy}); }
    }
    const c = getImageColors(img, pts);
    const side = (i: number, s: number) => {
      const k = i * 12 + s * 3;
      return nbcIsFaceRed(c[k]) || nbcIsFaceRed(c[k + 1]) || nbcIsFaceRed(c[k + 2]);
    };
    let n = 0;
    for (let i = 0; i < pips.length; i++) {
      if (side(i, 0) && side(i, 1) && (side(i, 2) || side(i, 3))) { n++; }
    }
    return n;
  } finally {
    if (mask) { releaseImage(mask); }
    releaseImage(crop);
  }
}

interface NbcLook {
  /** Both dice's top-face pips, left die first; null unless both sit at rest. */
  dice: number[] | null;
  /** Oogie or a die, at rest or not, is on screen. */
  busy: boolean;
}

/** One look at the roll. */
function nbcLook(ts: Tsum): NbcLook {
  const cfg = NbcDice;
  const img = nbcCapture(ts, cfg.scan);
  if (!img) { return {dice: null, busy: true}; }
  try {
    const mask = nbcMask(img, NbcFaceRed);
    if (!mask) { return {dice: null, busy: true}; }
    let faces: ContourBox[];
    try {
      faces = findContours(mask, cfg.faceMinArea, 0);
    } finally {
      releaseImage(mask);
    }
    const busy = faces.length > 0 || nbcOogieSeen(img) > 0;
    const pips: number[] = [];
    for (let d = 0; d < cfg.rest.length; d++) {
      const rest = cfg.rest[d];
      let face: ContourBox | null = null;
      for (let i = 0; i < faces.length; i++) {
        if (Math.abs(faces[i].x - rest.x) <= cfg.restTolerance
            && Math.abs(faces[i].y - rest.y) <= cfg.restTolerance) {
          face = faces[i];
        }
      }
      if (!face) { return {dice: null, busy: busy}; }
      const n = nbcCountPips(img, face);
      if (n < 1 || n > 6) { return {dice: null, busy: busy}; }
      pips.push(n);
    }
    return {dice: pips, busy: busy};
  } finally {
    releaseImage(img);
  }
}

// --- The roll --------------------------------------------------------------

/**
 * Temporary: the first roll's frame as the device captured it, to check pip
 * reads against (`<storage>/tmp/nbc-dice-<time>-<left><right>.png`).
 */
function nbcSaveRoll(ts: Tsum, dice: number[]) {
  const img = nbcCapture(ts, NbcDice.scan);
  if (!img) { return; }
  try {
    saveImage(img, ts.devicePath + '/tmp/nbc-dice-' + Date.now() + '-' + dice.join('') + '.png');
  } catch (e) {
    // Diagnostics only.
  } finally {
    releaseImage(img);
  }
}

/** Polls `done` for up to `ms`; whether it came true. */
function nbcWaitFor(ts: Tsum, ms: number, done: () => boolean): boolean {
  const until = Date.now() + ms;
  while (ts.isRunning && Date.now() < until) {
    if (done()) { return true; }
    ts.sleep(NbcDice.pollMs);
  }
  return false;
}

/**
 * Oogie's roll, from his cut-in to the dice leaving: read the landing, reroll a
 * first roll under 7 with one tap mid-board, and hold every touch until the dice
 * are gone. The scan that saw him then captures again.
 */
function nbcPlayDice(ts: Tsum) {
  const cfg = NbcDice;
  let rerolled = false;
  let last: number[] | null = null;
  let same = 0;
  let since = 0;
  let deadline = Date.now() + cfg.landWaitMs;
  let seenAt = Date.now();
  while (ts.isRunning && Date.now() < deadline) {
    const look = nbcLook(ts);
    if (look.busy) {
      seenAt = Date.now();
    } else if (Date.now() - seenAt > cfg.goneMs) {
      break;
    }
    const read = look.dice;
    same = !read ? 0 : last && read[0] === last[0] && read[1] === last[1] ? same + 1 : 1;
    if (same === 1) { since = Date.now(); }
    last = read;
    if (read && same >= cfg.stableReads
        && (rerolled || Date.now() - since >= cfg.settleMs)) {
      const total = read[0] + read[1];
      const reroll = !rerolled && total < cfg.rerollBelow;
      logInfo(Log.Skill.NbcDice, { roll: rerolled ? 2 : 1, dice: read, total: total, reroll: reroll });
      if (!rerolled) { nbcSaveRoll(ts, read); }
      if (!reroll) {
        // 7+ adds tsums and shrinks them all; under 7 takes some away and they
        // grow back towards full size. The reads say how far.
        ts.boardScaleTrend = total >= cfg.rerollBelow ? -1 : 1;
        ts.boardScaleReads = [];
        // Gone twice running, so one dropped read is not the end.
        let gone = 0;
        nbcWaitFor(ts, cfg.clearWaitMs, () => {
          gone = nbcLook(ts).dice ? 0 : gone + 1;
          return gone >= 2;
        });
        return;
      }
      ts.tap({x: 540, y: PlayAreaTopY + 540});  // middle of the board
      rerolled = true;
      nbcWaitFor(ts, cfg.rethrowWaitMs, () => nbcLook(ts).dice === null);
      last = null;
      same = 0;
      deadline = Date.now() + cfg.landWaitMs;
      seenAt = Date.now();
      continue;
    }
    ts.sleep(cfg.pollMs);
  }
  // `gone`: nothing left on screen, so too late rather than unreadable.
  logWarn(Log.Skill.NbcDiceUnread, { roll: rerolled ? 2 : 1, last: last,
    gone: Date.now() < deadline });
}

/** Plays Oogie's roll if `img` shows him; whether it did. */
function nbcWatch(ts: Tsum, img: NativeImage): boolean {
  const green = nbcOogieSeen(img);
  if (!green) { return false; }
  logInfo(Log.Skill.NbcOogie, { green: +green.toFixed(3) });
  nbcPlayDice(ts);
  return true;
}

registerSkill({
  types: [SkillType.NightmareSet],
  bareTapActivates: true,
  scalesBoard: true,
  colorBlur: 15,
  watchScan: nbcWatch,
  // The skill button can read full all through Oogie's roll.
  beforeActivate: function(ts) {
    const img = ts.playScreenshotSquare();
    try {
      nbcWatch(ts, img);
    } finally {
      releaseImage(img);
    }
  }
});
