// ---------------------------------------------------------------------------
// The chain counter
//
// While a chain is being drawn the game shows its length beside the head --
// the last tsum linked, wherever the finger has gone since -- and leaves it
// there for a moment after the release. It is the one measurement of a drag
// that matters: how many of the tsums the route planned the game actually
// linked. Nothing else on the device says. A route can be replayed offline
// against a recording to get the same number, one recording and one theory
// at a time, which is how Gaston's drag was tuned for nine recordings without
// the number that matters ever being in the log. `chainCounterRead` puts it
// there, off one capture and a few milliseconds, so a run scores its own
// chains and a drag setting is judged by a table of `registered` against
// `chain` rather than by aligning a video by hand.
//
// ## What is on the screen
//
// The counter is the game's `game_num_48_blue` digits -- a pale fill inside a
// thick navy outline -- laid over `game_praise_num_white`, a white silhouette
// of the same digits a little larger, so the number reads on any board. On a
// 540-wide screen it is drawn at about 0.55 of the sprite's size, and at that
// size the outline is most of the glyph: a navy ring three pixels thick round
// a fill three pixels wide, inside a white rim three pixels wide. The same
// sprite drawn large is the number that pops up over a cleared chain, and the
// praise score popups ("27,429") and the combo counter share the outline; the
// height band and the HUD band below keep those out, and the choice of which
// number is the counter is made by position (`route`). Past 9 the same
// shapes come in other colours (`styles`): Gaston's chains, 20-40 long, read
// on 15% of drags on navy alone.
//
// ## How it is read
//
// The play square at 540 wide, every pixel of one style boxed by connected
// component, style by style. A box the height of a digit whose surround is
// mostly the plate (`plateRing`) is a candidate; its style's pixels, inner rings included,
// are sampled to a 20x28 grid and scored against `ChainDigits` -- the same
// outline rendered from the sprite itself by the development toolkit's
// `chain:digits`, which also self-tests the templates at scales and offsets
// between the ones it voted over. The score is the share of the candidate's
// cells lying on the template dilated by one cell, averaged with the reverse,
// so a cell of misregistration costs nothing and a missing or extra stroke
// costs its length. Digits side by side are one number. With several numbers
// on the frame the one nearest the route is the counter.
//
// The read is made with the finger still down, `settleMs` after the last
// MOVE: the count is final by then, the praise popup that follows a release
// is not up yet, and a held chain has all the time there is. Read from a
// recording with `chain:replay`, which runs this same pipeline in Python.
// ---------------------------------------------------------------------------

// `var`, like every other tuning table: reachable by the offline harness.
var ChainCounterConfig = {
  // The play square is read at this width, whatever the screen's; the sizes
  // below are in its pixels. A 1080 screen halves on the way out of
  // getScreenshotModify, a 360 one is drawn up.
  scanWidth: 540,
  // The outline's colour, BGR, which goes with the chain's length -- the same
  // digit shapes each time (`gaston_124.mp4`). Navy to 9: the sprite's
  // (114, 68, 38) with room for the antialiasing, measured on a device
  // capture at B 115-157, G 36-101, R 16-82. Crimson 10-14, on a pink plate;
  // slate 15-19; dark brown 20-29, its digits touching; a dark rainbow from
  // 30, which `dark` mostly takes. One mask each: the host has no mask OR.
  styles: [
    { lo: { b: 80, g: 20, r: 0 }, hi: { b: 180, g: 130, r: 110 } },
    { lo: { b: 30, g: 0, r: 100 }, hi: { b: 140, g: 90, r: 230 } },
    { lo: { b: 120, g: 90, r: 70 }, hi: { b: 205, g: 190, r: 175 } },
    { lo: { b: 0, g: 0, r: 0 }, hi: { b: 159, g: 159, r: 159 } },
  ],
  // A plate pixel has every channel at or over this: white, or the crimson
  // style's pink.
  plateFloor: 170,
  // The outline's box: 25x28 measured on a 540 capture, 26-28 tall on a
  // recording. Wide enough for a device that draws the counter a little
  // bigger or smaller; the sampling to the grid is size-blind. A box wider
  // than `boxWidth.max`, up to `mergedAspect` heights, is two digits that
  // touch, split where the pair reads best.
  boxHeight: { min: 20, max: 36 },
  boxWidth: { min: 4, max: 34 },
  mergedAspect: 2.4,
  minArea: 40,
  // How many pixels outside the box the plate is sampled, and how much of
  // that frame has to be white. The corners of the frame fall off a round
  // digit's plate onto the board, which is why not more.
  plateRing: 3,
  plateFrac: 0.35,
  // Nothing above this many tsum widths from the square's top is the
  // counter: the fever bonus and the combo counter are drawn there, in the
  // same outline.
  hudBand: 1.25,
  // A digit's score against its best template, and its lead over the next.
  // The toolkit's self-test reads every rendered glyph at 0.956 and over with
  // a lead of 0.035 and over; a recording, softer than a capture, reads real
  // counters at 0.95-1.0.
  minScore: 0.85,
  minMargin: 0.02,
  // A digit's width over its height may be this far from its template's
  // before the score is docked -- what tells a '1' from the rest.
  aspectSlack: 0.15,
  // A gap between digits over this many digit heights starts a new number.
  digitGap: 0.7,
  // After the last MOVE, before the read: the game takes a move a frame and
  // the counter is drawn on the frame after, so two frames.
  settleMs: 60,
};

// ChainDigits: begin
// Generated by the development toolkit's `chain:digits` from the game's own
// sprite; do not edit by hand. Each is the navy outline of one digit on a
// 20x28 grid, the per-cell majority over scales 0.48-0.62 and sixteen
// sub-pixel offsets.
var ChainDigits: {[digit: string]: string[]} = {
  '0': ['.......######.......',
        '.....##########.....',
        '....###......###....',
        '...###........###...',
        '..###..........###..',
        '..##....####....##..',
        '.##.....####.....##.',
        '.##....###.##....##.',
        '.##....##..##....##.',
        '.#.....##..##.....##',
        '##.....##..##.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '##.....##..##.....##',
        '.#.....##..##.....#.',
        '.##....##..##....##.',
        '.##....##..##....##.',
        '.##.....####.....##.',
        '..##.....###....##..',
        '...##..........###..',
        '...###........###...',
        '....####....####....',
        '.....##########.....',
        '.......######.......'],
  '1': ['..........######....',
        '........##########..',
        '......#####.....####',
        '....#####........###',
        '.#####...........###',
        '####.............###',
        '###..............###',
        '###.....##.......###',
        '.#########.......###',
        '...#######.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '.......###.......###',
        '........###.....####',
        '.........#########..',
        '...........#####....'],
  '2': ['.......#######......',
        '....#############...',
        '...###........####..',
        '..###...........##..',
        '..##.............##.',
        '.##......##......##.',
        '.##....######.....##',
        '.##....###.##.....##',
        '.##....##...#.....##',
        '.##...##...##.....##',
        '.###.###...##.....##',
        '..#####...###.....##',
        '...###..###......##.',
        '.......###.......##.',
        '......###.......##..',
        '....###........###..',
        '....##........###...',
        '...##.......####....',
        '..##.......####.....',
        '.###......###.......',
        '.##.....#####.......',
        '.##....############.',
        '##......############',
        '##................##',
        '##................##',
        '##................##',
        '.##################.',
        '..################..'],
  '3': ['.......#######......',
        '....############....',
        '...####.......###...',
        '..###...........##..',
        '..##.............##.',
        '.##.....####.....##.',
        '.##....######....##.',
        '.##....##.###.....#.',
        '.##...##...##.....#.',
        '..######...##....##.',
        '...#########.....##.',
        '.....######.....##..',
        '.....##........###..',
        '.....##........###..',
        '.....###.........##.',
        '......#######....##.',
        '..###...#####.....##',
        '.######....##.....##',
        '.##..##.....#.....##',
        '##....##...##.....##',
        '##....###..##.....##',
        '##.....#####......##',
        '.##.....###......##.',
        '.##..............##.',
        '..###..........###..',
        '...###.......####...',
        '....############....',
        '......#######.......'],
  '4': ['...........###......',
        '.........#######....',
        '.........##...##....',
        '........##.....##...',
        '.......##......##...',
        '.......##......##...',
        '......##.......##...',
        '......##.......##...',
        '.....##........##...',
        '.....#.........##...',
        '....##...##....##...',
        '...##....##....##...',
        '...##...###....##...',
        '..##....###....##...',
        '..##...####....##...',
        '.##...#####....##...',
        '.##...#####....###..',
        '##...#####.....####.',
        '##................##',
        '##................##',
        '##................##',
        '###..............###',
        '.##########....####.',
        '..#########....###..',
        '.........##....##...',
        '.........##...##....',
        '..........######....',
        '...........####.....'],
  '5': ['....##############..',
        '..#################.',
        '..##.............##.',
        '.##..............##.',
        '.##..............##.',
        '.##.............###.',
        '.##.....##########..',
        '.##....#########....',
        '.##....#########....',
        '.##...........###...',
        '.##............###..',
        '.#..............###.',
        '.#.......#.......##.',
        '.#.....#####.....##.',
        '.##....######.....##',
        '.##...##...##.....##',
        '.#######...##.....##',
        '.######.....#.....##',
        '###..##....##.....##',
        '##...##....##.....##',
        '##....##..###.....##',
        '##....######.....##.',
        '.##.....###.....###.',
        '.##.............##..',
        '..###.........###...',
        '..#####.....####....',
        '....###########.....',
        '......#######.......'],
  '6': ['.......#######......',
        '.....############...',
        '....###........###..',
        '...##...........##..',
        '..##.............##.',
        '..##....#####....##.',
        '.##.....######...##.',
        '.##....###.###...##.',
        '.##....############.',
        '.#.....###########..',
        '##............####..',
        '##..............##..',
        '##.......##......##.',
        '##......####.....##.',
        '##.....######.....##',
        '##.....##..##.....##',
        '##.....##...#.....##',
        '##.....##...#.....##',
        '.#.....##...#.....##',
        '.##....##..##.....##',
        '.##....##..##.....##',
        '.##.....#####....##.',
        '..##....####.....##.',
        '..###...........###.',
        '...###.........###..',
        '....####.....####...',
        '.....###########....',
        '.......#######......'],
  '7': ['..###############...',
        '.##################.',
        '##...............###',
        '##................##',
        '##................##',
        '##................##',
        '.###########......##',
        '..##########.....##.',
        '.........###.....##.',
        '.........##.....##..',
        '.........##.....##..',
        '........##.....##...',
        '........##.....##...',
        '.......##......##...',
        '.......##.....##....',
        '......###.....##....',
        '......##.....##.....',
        '......##.....##.....',
        '.....##.....##......',
        '.....##.....##......',
        '....##.....###......',
        '....##.....##.......',
        '...##......##.......',
        '...##.....##........',
        '....#.....##........',
        '....##...##.........',
        '.....######.........',
        '......###...........'],
  '8': ['.......######.......',
        '.....##########.....',
        '...####......####...',
        '...##..........###..',
        '..##............##..',
        '..#.....####.....##.',
        '.##.....####.....##.',
        '.##.....####.....##.',
        '.##.....##.#.....##.',
        '.##.....####.....##.',
        '..#.....####.....##.',
        '..##.....##.....##..',
        '..##............##..',
        '..###..........###..',
        '.##..............##.',
        '.##.....####.....##.',
        '##.....######.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....######.....##',
        '.##.....####.....##.',
        '.###.............##.',
        '..###...........##..',
        '...####......####...',
        '....############....',
        '.......#######......'],
  '9': ['.......######.......',
        '....############....',
        '...####......####...',
        '..###..........###..',
        '..##......#.....##..',
        '.##.....####.....##.',
        '.##....######....##.',
        '##.....##..##....##.',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....##..##.....##',
        '##.....######.....##',
        '.##.....####......##',
        '.##...............##',
        '..##..............##',
        '..####......#.....##',
        '..###########.....##',
        '..###########....##.',
        '.##...##..###....##.',
        '.##...######.....##.',
        '.##....####.....##..',
        '.##.............##..',
        '..##..........###...',
        '...####.....####....',
        '....###########.....',
        '......#######.......'],
};
// Width over height of each outline, the median over the same renders.
var ChainDigitAspect: {[digit: string]: number} = {
  '0': 0.77, '1': 0.50, '2': 0.80, '3': 0.77, '4': 0.77,
  '5': 0.77, '6': 0.77, '7': 0.76, '8': 0.77, '9': 0.76
};
// ChainDigits: end

const ChainGridW = 20;
const ChainGridH = 28;

/** One reading of the counter. */
interface ChainCount {
  /** The number nearest the route, null when none read. */
  value: number | null;
  /** Its centre in play-square scale (`scanBoardQuick`'s), -1 when none. */
  x: number;
  y: number;
  /** The weakest digit's score and lead; 0 when none. */
  score: number;
  margin: number;
  /** Numbers read on the frame, the chosen one included. */
  found: number;
  /** The rest, as value, x, y triples -- another counter lingering, a popup. */
  others: number[];
  /** What the read cost, in ms. */
  ms: number;
}

/** A digit read off the frame, in scan pixels. */
interface ChainDigitHit {
  x: number;
  y: number;
  w: number;
  h: number;
  digit: string;
  score: number;
  margin: number;
}

/** Digits side by side, read as one number. */
interface ChainNumberHit {
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  margin: number;
}

// The templates as bit grids, parsed once on first use.
var chainTemplates: { [digit: string]: Uint8Array } | null = null;
var chainTemplatesDilated: { [digit: string]: Uint8Array } | null = null;

function chainDilate(bm: Uint8Array): Uint8Array {
  const out = new Uint8Array(bm.length);
  for (let y = 0; y < ChainGridH; y++) {
    for (let x = 0; x < ChainGridW; x++) {
      const i = y * ChainGridW + x;
      if (bm[i] || (x > 0 && bm[i - 1]) || (x < ChainGridW - 1 && bm[i + 1])
          || (y > 0 && bm[i - ChainGridW]) || (y < ChainGridH - 1 && bm[i + ChainGridW])) {
        out[i] = 1;
      }
    }
  }
  return out;
}

function chainLoadTemplates(): boolean {
  if (chainTemplates !== null) { return true; }
  const t: { [digit: string]: Uint8Array } = {};
  const d: { [digit: string]: Uint8Array } = {};
  let any = false;
  for (const digit in ChainDigits) {
    const rows = ChainDigits[digit];
    if (rows.length !== ChainGridH) { continue; }
    const bm = new Uint8Array(ChainGridW * ChainGridH);
    for (let y = 0; y < ChainGridH; y++) {
      for (let x = 0; x < ChainGridW; x++) {
        bm[y * ChainGridW + x] = rows[y].charAt(x) === '#' ? 1 : 0;
      }
    }
    t[digit] = bm;
    d[digit] = chainDilate(bm);
    any = true;
  }
  if (!any) { return false; }
  chainTemplates = t;
  chainTemplatesDilated = d;
  return true;
}

/**
 * Area-sample a w*h 0/1 grid to the template grid: a cell is on when half or
 * more of the source area under it is. `bits` is row-major.
 */
function chainNormalise(bits: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(ChainGridW * ChainGridH);
  for (let gy = 0; gy < ChainGridH; gy++) {
    const y0 = gy * h / ChainGridH;
    const y1 = (gy + 1) * h / ChainGridH;
    for (let gx = 0; gx < ChainGridW; gx++) {
      const x0 = gx * w / ChainGridW;
      const x1 = (gx + 1) * w / ChainGridW;
      let acc = 0;
      let tot = 0;
      for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
        const fy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
          const fx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          acc += fx * fy * bits[yy * w + xx];
          tot += fx * fy;
        }
      }
      out[gy * ChainGridW + gx] = tot > 0 && acc / tot >= 0.5 ? 1 : 0;
    }
  }
  return out;
}

/** The symmetric overlap of a candidate and a template, each with a cell of slack. See the header. */
function chainScore(cand: Uint8Array, candDilated: Uint8Array, tmpl: Uint8Array, tmplDilated: Uint8Array): number {
  let onTemplate = 0;
  let candCells = 0;
  let onCand = 0;
  let tmplCells = 0;
  for (let i = 0; i < cand.length; i++) {
    if (cand[i]) { candCells++; if (tmplDilated[i]) { onTemplate++; } }
    if (tmpl[i]) { tmplCells++; if (candDilated[i]) { onCand++; } }
  }
  return 0.5 * (onTemplate / Math.max(1, candCells) + onCand / Math.max(1, tmplCells));
}

/** A counter outline style, as `ChainCounterConfig.styles` has them. */
interface ChainStyle { lo: { b: number, g: number, r: number }; hi: { b: number, g: number, r: number }; }

function chainInStyle(c: Color, st: ChainStyle): boolean {
  return c.b >= st.lo.b && c.b <= st.hi.b && c.g >= st.lo.g && c.g <= st.hi.g && c.r >= st.lo.r && c.r <= st.hi.r;
}

/**
 * The best template for the on cells of `bits` (`bw` by `bh`) between columns
 * `from` and `to`, cropped to their extent, in `bits`' coordinates. Null when
 * too little is on to be a digit.
 */
function chainBestDigit(bits: Uint8Array, bw: number, bh: number, from: number, to: number): ChainDigitHit | null {
  const cfg = ChainCounterConfig;
  let minX = to;
  let maxX = from - 1;
  let minY = bh;
  let maxY = -1;
  for (let y = 0; y < bh; y++) {
    for (let x = from; x < to; x++) {
      if (!bits[y * bw + x]) { continue; }
      if (x < minX) { minX = x; }
      if (x > maxX) { maxX = x; }
      if (y < minY) { minY = y; }
      if (y > maxY) { maxY = y; }
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (maxY < 0 || h < 0.7 * cfg.boxHeight.min || w < 3) { return null; }
  const sub = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { sub[y * w + x] = bits[(minY + y) * bw + minX + x]; }
  }
  const cand = chainNormalise(sub, w, h);
  const candDilated = chainDilate(cand);
  const aspect = w / h;
  let best = -1;
  let second = -1;
  let digit = '';
  for (const d in chainTemplates) {
    let s = chainScore(cand, candDilated, chainTemplates[d], chainTemplatesDilated![d]);
    const off = Math.abs(aspect - ChainDigitAspect[d]);
    if (off > cfg.aspectSlack) { s -= 0.5 * off; }
    if (s > best) { second = best; best = s; digit = d; } else if (s > second) { second = s; }
  }
  return { x: minX, y: minY, w: w, h: h, digit: digit, score: best, margin: best - second };
}

/**
 * Every digit on the play square capture `img` (scan pixels), off one style's
 * mask boxes: the plate test, the sampling and the match, per box -- a wide
 * box as two digits too (`mergedAspect`), whichever reads better.
 */
function chainDigitsOn(img: NativeImage, boxes: ContourBox[], tsumWidth: number, st: ChainStyle): ChainDigitHit[] {
  const cfg = ChainCounterConfig;
  const size = getImageSize(img);
  const hits: ChainDigitHit[] = [];
  const ring = cfg.plateRing;
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    if (box.height < cfg.boxHeight.min || box.height > cfg.boxHeight.max
        || box.width < cfg.boxWidth.min || box.width > cfg.mergedAspect * box.height) { continue; }
    if (box.y + box.height / 2 < cfg.hudBand * tsumWidth) { continue; }
    // The box and its frame in one read.
    const x0 = Math.max(0, box.x - ring);
    const y0 = Math.max(0, box.y - ring);
    const x1 = Math.min(size.width, box.x + box.width + ring);
    const y1 = Math.min(size.height, box.y + box.height + ring);
    const pts: Point[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) { pts.push({ x: x, y: y }); }
    }
    const colors = getImageColors(img, pts);
    const w = x1 - x0;
    let white = 0;
    let frame = 0;
    const bits = new Uint8Array(box.width * box.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = colors[(y - y0) * w + (x - x0)];
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
        if (inside) {
          if (chainInStyle(c, st)) { bits[(y - box.y) * box.width + (x - box.x)] = 1; }
        } else {
          frame++;
          if (Math.min(c.r, c.g, c.b) >= cfg.plateFloor) { white++; }
        }
      }
    }
    if (frame === 0 || white / frame < cfg.plateFrac) { continue; }
    let read: ChainDigitHit[] = [];
    let readScore = -1;
    if (box.width <= cfg.boxWidth.max) {
      const one = chainBestDigit(bits, box.width, box.height, 0, box.width);
      if (one !== null) { read = [one]; readScore = one.score; }
    }
    if (box.width >= 0.9 * box.height) {
      for (let k = Math.floor(0.3 * box.width); k <= Math.floor(0.7 * box.width); k++) {
        const l = chainBestDigit(bits, box.width, box.height, 0, k);
        const r = chainBestDigit(bits, box.width, box.height, k, box.width);
        if (l === null || r === null) { continue; }
        const s = (l.score + r.score) / 2;
        if (s > readScore) { read = [l, r]; readScore = s; }
      }
    }
    let ok = read.length > 0;
    for (let i = 0; i < read.length; i++) {
      if (read[i].score < cfg.minScore || read[i].margin < cfg.minMargin) { ok = false; }
    }
    if (!ok) { continue; }
    for (let i = 0; i < read.length; i++) {
      read[i].x += box.x;
      read[i].y += box.y;
      hits.push(read[i]);
    }
  }
  return hits;
}

/** One hit per digit place: where the styles' reads overlap, the best score. */
function chainDedupe(hits: ChainDigitHit[]): ChainDigitHit[] {
  hits.sort(function(a, b) { return b.score - a.score; });
  const kept: ChainDigitHit[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    let dup = false;
    for (let k = 0; k < kept.length && !dup; k++) {
      dup = Math.abs(h.x + h.w / 2 - kept[k].x - kept[k].w / 2) < 0.4 * h.h
        && Math.abs(h.y + h.h / 2 - kept[k].y - kept[k].h / 2) < 0.4 * h.h;
    }
    if (!dup) { kept.push(h); }
  }
  return kept;
}

/** Digits joined left to right into numbers: one row, a gap under `digitGap` heights. */
function chainNumbersOf(hits: ChainDigitHit[]): ChainNumberHit[] {
  const cfg = ChainCounterConfig;
  hits.sort(function(a, b) { return a.x - b.x; });
  const nums: ChainNumberHit[] = [];
  const digits: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    let joined = false;
    for (let n = 0; n < nums.length; n++) {
      const g = nums[n];
      const gap = h.x - (g.x + g.w);
      if (Math.abs((h.y + h.h / 2) - (g.y + g.h / 2)) < 0.5 * h.h && gap >= -2 && gap < cfg.digitGap * h.h) {
        digits[n] += h.digit;
        const top = Math.min(g.y, h.y);
        g.h = Math.max(g.y + g.h, h.y + h.h) - top;
        g.y = top;
        g.w = h.x + h.w - g.x;
        g.score = Math.min(g.score, h.score);
        g.margin = Math.min(g.margin, h.margin);
        joined = true;
        break;
      }
    }
    if (!joined) {
      nums.push({ value: 0, x: h.x, y: h.y, w: h.w, h: h.h, score: h.score, margin: h.margin });
      digits.push(h.digit);
    }
  }
  for (let n = 0; n < nums.length; n++) { nums[n].value = parseInt(digits[n], 10); }
  return nums;
}

/**
 * Read the chain counter off the board now. `route` is the chain's tsums as
 * centres in play-square scale; with several numbers on the frame the one
 * nearest any of them is the counter, and with no route the best-scoring one.
 * Every number found is in the result, so a wrong choice can be seen.
 */
function chainCounterRead(ts: Tsum, route: Point[] | null): ChainCount {
  const cfg = ChainCounterConfig;
  const from = Date.now();
  const none: ChainCount = { value: null, x: -1, y: -1, score: 0, margin: 0, found: 0, others: [], ms: 0 };
  if (!chainLoadTemplates()) { none.ms = Date.now() - from; return none; }
  // Scan pixels per play-square unit, and the capture at the scan width --
  // the native crop when the square already is that wide.
  const scale = cfg.scanWidth / ts.playResizeWidth;
  const out = ts.playWidth === cfg.scanWidth ? 0 : cfg.scanWidth;
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, ts.playHeight, out, out, 100);
  if (!(img as unknown as number)) { none.ms = Date.now() - from; return none; }
  let mask: NativeImage | null = null;
  let nums: ChainNumberHit[];
  try {
    const hits: ChainDigitHit[] = [];
    for (let i = 0; i < cfg.styles.length; i++) {
      const st = cfg.styles[i];
      // BGRA bounds, as inRange takes them.
      mask = inRange(img, st.lo.b, st.lo.g, st.lo.r, 0, st.hi.b, st.hi.g, st.hi.r, 255);
      if (!(mask as unknown as number)) { mask = null; continue; }
      const boxes = findContours(mask, cfg.minArea, 0);
      releaseImage(mask);
      mask = null;
      const found = chainDigitsOn(img, boxes, Config.tsumWidth * scale, st);
      for (let k = 0; k < found.length; k++) { hits.push(found[k]); }
    }
    nums = chainNumbersOf(chainDedupe(hits));
  } finally {
    if (mask != null) { releaseImage(mask); }
    releaseImage(img);
  }
  if (nums.length === 0) { none.ms = Date.now() - from; return none; }
  // The counter is the number nearest the route, else the surest one.
  let pick = 0;
  let pickD = Infinity;
  for (let i = 0; i < nums.length; i++) {
    const cx = nums[i].x + nums[i].w / 2;
    const cy = nums[i].y + nums[i].h / 2;
    let d = -nums[i].score;
    if (route !== null && route.length > 0) {
      d = Infinity;
      for (let r = 0; r < route.length; r++) {
        const dx = route[r].x * scale - cx;
        const dy = route[r].y * scale - cy;
        if (dx * dx + dy * dy < d) { d = dx * dx + dy * dy; }
      }
    }
    if (d < pickD) { pickD = d; pick = i; }
  }
  const others: number[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (i === pick) { continue; }
    others.push(nums[i].value, Math.round((nums[i].x + nums[i].w / 2) / scale), Math.round((nums[i].y + nums[i].h / 2) / scale));
  }
  const chosen = nums[pick];
  return {
    value: chosen.value,
    x: Math.round((chosen.x + chosen.w / 2) / scale),
    y: Math.round((chosen.y + chosen.h / 2) / scale),
    score: Math.round(chosen.score * 1000) / 1000,
    margin: Math.round(chosen.margin * 1000) / 1000,
    found: nums.length,
    others: others,
    ms: Date.now() - from,
  };
}

/** `route` as centres in play-square scale, from a chain's top-left points. */
function chainRouteCentres(path: Point[]): Point[] {
  const half = Config.tsumWidth / 2;
  const out: Point[] = [];
  for (let i = 0; i < path.length; i++) { out.push({ x: path[i].x + half, y: path[i].y + half }); }
  return out;
}

/** The read behind a count, for a log record: where the number sat, how sure the match was, what else was on the frame. */
function chainCountDetail(count: ChainCount): LogFields {
  return {
    x: count.x, y: count.y, score: count.score, margin: count.margin,
    found: count.found, others: count.others, ms: count.ms,
  };
}
