// ---------------------------------------------------------------------------
// Coronation Day Elsa
//
// The activation does not clear anything. It opens a freeze window -- 5s at
// skill level 1 up to 10s at level 6, `durationMs` -- and while it is open every
// chain linked freezes a band of tsums across the board: the line through the
// chain's first and last tsum, extended to both screen edges, one to two tsums
// thick and thicker when the line slants or the chain zigzags off it. Frozen
// tsums stay where they are (the board does not move inside the window), and
// one tap on any of them sets the whole pile off at once.
//
// ## The goal: as many short chains as the window allows, then one break
//
// A frozen tsum that a *second* band runs through counts double at the break,
// with a coin bonus on top (a player's write-up of the skill, and its
// screenshots: overlapped ice is shaded pink). So the window is a sweep: short
// flat chains, one after another, each on the lowest row still free, so that
// each new band lies just above the last and overlaps it; the pile is broken
// when the window is nearly out; and the bomb the break spawns is popped.
// Bubbles are popped on every look, ice or not: a pop never sets the pile
// off (the user, 2026-09-25), and a bubble left holes the next band. The
// pile itself is left alone -- with one exception: a board frozen out with
// window to spare is broken on the spot and the refill swept again (`refreezeStarvedLooks`), because the sweep freezes a whole board in
// three to four seconds and a 10s window has room for two piles.
//
// The loop is: capture and read which tsums are ice (`elsaLook`); draw the
// flattest chain anchored in the lowest free row (`elsaRowChain`); wait
// `iceFormMs` for its band to form; look again. One capture per chain is what
// makes the ice *read* rather than modelled -- every chain is planned off a
// board whose ice is where the game put it.
//
// The window runs from the end of the activation animation, not the tap:
// on video the background turns light blue at tap + 1.77s and back at tap +
// 12.18s (32 windows), and chains inside that froze. A clock that closed at
// 11.5s handed the last 0.7s to the play loop. So the clock in here starts at
// `t0 + leadInMs`, and the first chain is not drawn before that either -- a
// chain under the animation is ignored.
//
// The window can outlive the round: the break refills the gauge, so windows
// chain back to back and one opened in the round's last seconds runs past the
// timer. A look that finds nothing to chain checks for a round-over screen
// (`elsaRoundOver`, rate-limited), and so does the close; from then on nothing
// is tapped -- the break's grid and its post-burst pops over the score tally
// are what opened the Options menu on `option_menu.mp4`.
//
// ## A chain the game does not link freezes nothing
//
// A chain planned over one row of the board registers as a touch on one tsum:
// a row holds a colour's tsums two apart with another colour between, a hop
// of nearly two tsum widths, which the game does not link. So the plan spans
// `rowSpan` rows and keeps every hop under `maxHops` -- adjacent tsums
// first, and a wider tier only when no row has a chain of those: at least
// one end sits in the anchor row, and the tsums between may step into the
// rows above. Verified linking on `coronation_elsa_6.mp4`.
//
// What has been observed about how much a chain freezes, kept for whoever
// tunes this next: the band grows with the time since the last freeze -- ~3
// tsums a second in, 7-20 at 4-5s, and a first chain 10-12s in with nothing
// frozen before it took most or all of the board (59 in recording 3, 34 in
// 5). Whether that beats a sweep of many small bands with their overlaps is
// NOT measured; a version that drew two scheduled chains for it made one
// chain a window and was worse than the sweep in play.
//
// ## One tap sets the pile off, so nothing may touch ice until the end
//
// Any contact with a frozen tsum spends the entire pile. Two guards:
//
//   - every chain is planned off a capture taken *after* the previous band
//     formed, so the ice it avoids is read, not modelled;
//   - a candidate whose *drag* would pass within `dragClearance` of read ice or
//     a bubble is not drawn (`elsaPathIsClear`): a bubble touched mid-drag pops
//     and ends the chain there, and ice touched mid-drag is the pile gone.
//
// The premature pops this skill has had, kept for the record: it burst after
// every pass (a reflex; now there is one break); a drag landed on ice a model
// called free (the model is gone -- ice is read); the next drag went out
// before the ice had formed (`iceFormMs` now waits for it); a live tsum
// colour read as ice (the `elsaIceAlikes` whitelist); and the ice read too
// dark for the frozen box on a board with dark tsums under it
// (`frozen.valMin` re-measured, see the tuning data).
//
// ## After the break
//
// The break spawns a bomb bubble where the clear count is shown. The break's
// taps take the bubbles its capture read (they survive the break otherwise),
// and the next look pops the bomb aimed, over the shards it reads as ice --
// and leftover ice between windows is kept unless it is pile-sized, because a
// band left standing doubles under the next window's bands (`orderPaths`).
//
// ## Reading the board through the ice
//
// A frozen tsum still detects as a circle. Whether it is ice is read per
// tsum off its own centre colour (`BoardPoint.local`, a light blur that
// keeps the neighbours out) against the `ice` boxes -- the cube dominates
// the centre whatever tsum is under it -- never planned over, kept clear of
// by every drag. The read has a converse hazard: a live tsum can sit inside
// the box (an event board's pale ice-blue fluffy tsum did, and every scan
// read a dozen-tsum phantom pile). The answer is a whitelist read when ice
// is impossible: until the round's first window opens no ice can exist, so
// any colour cluster whose tsums read as ice on those scans is a live
// colour, remembered by its cluster centre for the round (`elsaIceAlikes`),
// and its tsums are never ice. The match is loose on value and tight on hue
// and saturation:
// the same live blue read (102, 88, 185) between windows and (99, 84, 208)
// under the fever tint on `coronation_elsa_3.mp4`, and a plain distance of
// 15 called the second one ice -- which cost every window of that run.
//
// ## Which tsums are one kind: the kind read
//
// Two pale kinds can share a colour cluster -- cream Coronation Elsas and a
// pale-pink tsum both read as skin at the centre -- and a chain mixing them
// never links (22% of one round's chains). The game can tell: with a finger
// on a tsum it darkens every other kind. Once a cluster has produced a dead
// chain this round (`elsaMixed`), its chains go out with the finger resting
// on the plan's lower end first; its members whose floor did not drop are
// the head's kind, and the chain is replanned over those (`elsaKindChain`).
// A first read where nothing darkens clears the cluster again: that chain
// died of a hop, not a kind. Ice reads stay out of it: ice does not darken
// either.
//
// The ice also eats colour slots: the board scan keeps its biggest
// `uniqueTsumCount - 1` clusters and each ice shade takes one, so
// `extraClusterSlots` on the declaration makes room for them -- a tsum in a
// dropped cluster is not in the board array for any look to read. See the
// declaration's comment.
// ---------------------------------------------------------------------------

// --- Tuning data ---------------------------------------------------------
//
// ## Reading a frozen tsum
//
// The game draws a translucent ice cube over a frozen tsum (its sprite: a
// pale blue-white hexagon, more opaque at the edges) and white shards around
// it; a tsum under two bands gets a second cube in blue-violet, which lands
// on screen as a pale pink-lavender. On screen the cube dominates the centre
// whatever is under it: frozen centres read hue 88-135, saturation 25-150
// and value 175-255 off a light blur, on every pile replayed from
// `coronation_elsa_8..10.mp4`, and the doubled ones read near-white (s < 25,
// v > 235, hue 90-175 -- what hue a near-white has). Live colours that come
// near: blue and cyan tsums (saturation 175-230, so `satMax` 150), peach and
// pink faces (hue 5-20 or 170+ at low saturation, so the pale box keeps a hue
// range), a black-and-white face whose centre is its white patch (contrast
// 41-58 against 3-30 for ice and shards, so `paleContrastMax`). Shards on
// bare floor read as pale too; they are taken as ice, which costs nothing --
// a drag avoids them and a tap on them does nothing -- where taking them as
// tsums drew chains of them.
//
// That per-tsum read is `ice`, off `BoardPoint.local`. The 22px smear the
// clustering samples is a different thing: it reads a tsum ringed by ice as
// pale itself (four black Mickeys in a glow read as a pile; two faces one
// pink, one peach merged into a chain that never linked), which is why ice
// is not read from the cluster centres any more. The cluster centre has one
// job left: it is the key the ice-alike whitelist remembers a live colour
// by (`elsaIceAlikes`) -- a grey-blue cat on `coronation_elsa_11.mp4` reads
// as ice tsum by tsum, and an event board's pale ice-blue tsum did before
// it; learned before the first window, their clusters are never ice.
var CoronationElsaConfig = {
  // How long the freeze window stays open, by skill level 1-6, in ms, counted
  // from the end of the activation animation (`leadInMs`). Level 6 measured:
  // the window's light-blue background closes at tap + 12.18s (median of 32
  // windows, 2026-09-25); 10300 ends just inside that. The lower levels
  // assume the same one second a level and have not been seen.
  durationMs: [5300, 6300, 7300, 8300, 9300, 10300],
  // The activation animation, and where the window's clock starts: no look
  // before this. The background turns light blue at tap + 1.77s (1.67-1.87);
  // a chain drawn under the animation is ignored.
  leadInMs: 1800,
  // Prefer the chain whose band crosses the most read ice (`elsaRowChain`),
  // and how far from its end line, in play-square px, a tsum counts as on
  // it -- the band is one to two tsums (25) thick. On the game's shatter
  // counts it broke ~89 ice a window against ~63 without (2026-09-25).
  overlapBandPx: 18,
  // A chain earns its overlap only if its drag keeps this far from read ice
  // and bubbles (a tsum width, vs `dragClearance` 13): scored chains hug the
  // ice they line up with, the scan misses frozen tsums, and 16 of 164 were
  // followed by an early break against 2 of 90 unscored (2026-09-25).
  overlapClearPx: 25,
  // The salvo (`elsaSalvo`): once per window, on its first look with no ice
  // to touch (up to `salvoMaxIced` reads), draw up to `salvoChains` of the
  // play loop's own chains (`calculatePaths`, at most `salvoMaxChain` long,
  // full link reach) back to back, no look between; the careful sweep then
  // chains what it left. On video four such chains froze a fresh board whole
  // in 0.3s for a count of 72. Firing on every ice-free look made ~5 salvos
  // a window, and 9 of 16 early breaks followed one. With it chains per
  // window rose from ~17 to ~23 and dead chains fell from 6-22% to 3%.
  //
  // `salvos` is how many run before the overlap sweep takes over. Only the
  // first needs the ice-free look; each later one chains around the ice the
  // last left, one look apart. 0 skips the salvo. Two, chosen on a Debug-tab
  // A/B (2026-09-25); a second salvo that finds under two chains hands over.
  salvos: 2,
  salvoChains: 4,
  salvoMaxChain: 5,
  salvoMaxIced: 4,
  // Window left for a salvo to be worth starting: its chains and the band.
  salvoMinLeftMs: 1500,
  // Waited out after each chain before the next look, so the look reads the
  // band the chain just froze: the slash follows the release by ~100ms and the
  // crystals have settled by 250-300ms (`coronation_elsa_2.mp4`, 60fps). The
  // capture lands ~60ms after this, so the read is at ~335ms. Pacing chains
  // wider lost: a 1.5s gap scored 3.7M against 16.0M (2026-09-25), because
  // a band's growth with time does not make up for the chains given up. So
  // this is the floor and the ceiling.
  iceFormMs: 275,
  // The slice of the window kept for the closing break: the last band forming,
  // the read it is aimed off, and the taps. No chain goes out with less than
  // this left.
  burstTailMs: 800,
  // How far a tsum may sit above the lowest tsum of a row and still be in that
  // row, in the 200px play square (a tsum is 25, rows pitch about 22). A chain
  // whose ends are both inside one row has a band that is horizontal to within
  // this over its span, which is what keeps the band thin and parallel.
  rowTolerance: 14,
  // Longest chain the row search may return. Short and straight is the point:
  // the band reaches both edges whatever the length, and a long chain wanders
  // off its own line and thickens it.
  rowMaxChain: 5,
  // How many rows a chain may be planned over: its ends in the lowest, the
  // tsums between them anywhere in these. One row alone holds a colour's
  // tsums two apart, which is a hop the game refuses (see the header).
  rowSpan: 3,
  // The longest hop a planned chain may take, in the 200px play square, as
  // tiers tried in order on one capture: the whole board at the first, then
  // at the next only if that found nothing. Adjacent tsums sit 24-26px apart
  // on a settled board and are the surest to register, so a chain of them
  // wins wherever it is. On a board frozen nearly out the free tsums are
  // scattered islands and every chain left needs 35-43px hops
  // (`coronation_elsa_8.mp4`, four pre-break frames replayed) -- inside the
  // 47.5px (`linkReach`) every ordinary chain gambles on, and clear of the
  // ~50px single-row hops the game refused.
  maxHops: [34, 44],
  // How close a drag may pass to a frozen tsum or a bubble, same units --
  // about one tsum radius. A linkable hop is `tsumWidth * linkReach` = 47.5px,
  // so two free tsums can sit one hop apart with ice between them.
  dragClearance: 13,
  // What a frozen tsum reads at its own centre (`BoardPoint.local`, HSV).
  // See the note above. The pale box is the doubled cube and the shards.
  ice: {
    hueMin: 88, hueMax: 165, satMin: 25, satMax: 150, valMin: 175,
    paleSatMax: 25, paleValMin: 235, paleHueMin: 90, paleHueMax: 175,
    paleContrastMax: 35,
    // A tsum in a whitelisted cluster is still ice when its centre reads this
    // bright -- or brighter than that colour's own tsums ever read before the
    // first window, plus `sureValMargin`, whichever is higher. The cube's
    // centre reads 235-255 on most of a pile and Dumbo (recording 11) read
    // 200-235, so 235 split them; but Stitch's centre reads 236-253 live
    // (`elsa_stitch_issue.mp4`), and a flat 235 made 13 of his 17 tsums ice
    // all round -- never chained, and a leftover break fired at him every
    // scan. Against the one hole in the whitelist: the clustering merging a
    // learned colour with real ice, mid-window, so that the whole cluster
    // matches the remembered live colour. A colour that reads as bright as
    // the cube gives that guard up rather than the colour.
    sureValMin: 235,
    sureValMargin: 5,
  },
  // How far a centre may sit from a remembered ice-alike on each axis and
  // still be that live colour. Hue and saturation re-read within ~5 of
  // themselves scan to scan, and the nearest measured real ice sits 8 in hue
  // and 18 in saturation from a known ice-alike, so 12 and 15 keep it out.
  // Value moves with the fever tint -- one live blue read 185 and 208 in the
  // same round -- so it gets the room it needs.
  //
  // Measured from the range of reads the colour was learned over, not its
  // first read: a light-blue live tsum read saturation 78-137 before its
  // first window and 60-98 in play (mui0gs7xco), so a first read of 100 missed
  // it on 44 of 160 scans between windows -- 19 breaks tapped at live tsums.
  // Brighter than the range gets only `valUp`: ice read as the live colour
  // is always brighter than it (v 220-232 against a range topping out at
  // 202-216), and 5 whitelisted none of 459 such clusters across six rounds.
  iceAlikeMatch: {hue: 12, sat: 15, val: 40, valUp: 5},
  // What it takes for a colour in the box to count as live rather than a
  // transient: a cluster this big, on this many scans of the round before its
  // first window. A live colour is 7-16 tsums on every one of the ~50 scans
  // before a first activation; the pale flashes and refills that poisoned the
  // whitelist were 1-4 tsums on one or two.
  iceAlikeMinTsums: 4,
  iceAlikeMinScans: 5,
  // The kind read (`elsaKindChain`): finger down on the head for `ms`, and a
  // same-cluster member whose floor drops by `dropMax` or more is another
  // kind. Only on clusters remembered as mixed (`elsaMixed`), matched like an
  // ice-alike (`iceAlikeMatch`). `dropMax` is reasoned, not measured: the
  // darkened kinds went near-black on video; `drops` on `skill.elsa.kind`.
  kind: {
    on: true,
    ms: 80, grid: 3, step: 2,
    dropMax: 25,
    grabMs: 10, moveMs: 10, releaseMs: 10,
  },
  // Taps spent on the pile. One is enough to set it off; the rest insure
  // against a position the read had slightly wrong.
  burstTaps: 3,
  burstTapDuring: 10,
  // Waited out after a look pops bubbles, before the board is re-captured:
  // tsums slide into the space a popped bubble leaves.
  bubbleSettleMs: 200,
  // Pop rounds a look may spend before it plans, each followed by the settle
  // and a fresh capture: a pop's blast drops tsums, and bubbles under them.
  bubblePopRounds: 3,
  // A bubble centred this close to an ice read, in tsum widths, may be frozen
  // itself (or a phantom read on the ice), and a tap on it is a tap on the
  // pile. A free bubble beside ice sits ~1.2 widths from its centre.
  bubbleIceGap: 0.6,
  // An ice-free look that reads fewer than this fraction of the tsums the
  // board is known to hold is a board mid-fall -- the window opening on the
  // previous batch's refill, a pop's slide, a burst's refill -- and is waited
  // out (`settleRetryMs`, up to `settleMaxWaits` times) rather than chained.
  // Ice-free looks only: an iced board under-reads (frozen clusters eat colour
  // slots) and must never stall the sweep.
  settledFraction: 0.75,
  settleRetryMs: 250,
  settleMaxWaits: 5,
  // Waited out after a burst before anything else works the board: the pile
  // going off is a large clear and the refill scales with it. Base plus
  // per-tsum, capped.
  postBurstSettleMs: 250,
  postBurstSettlePerTsumMs: 6,
  postBurstSettleMaxMs: 900,
  // Waited out when a look offers no chain at all before looking again.
  rescanIdleMs: 300,
  // The mid-window break: a board with no row left to chain is a pile ready
  // to spend, and the refill can be frozen again in the window left. It
  // fires when this many consecutive looks read no chain (one starved read
  // can be a band still forming), the pile is at least `refreezeMinIced`
  // (a real pile, not a stray band), and at least `refreezeMinWindowLeftMs`
  // remains -- a break with less left buys nothing over the closing one.
  // `coronation_elsa_7.mp4`: a board frozen out by 3.5s and broken at 4.7s
  // took 391,274, then refroze for 599,936 at the close -- against ~250,000
  // for a board frozen out at 4s and left standing until 12s.
  refreezeStarvedLooks: 2,
  refreezeMinIced: 8,
  // Was 2000: with less than that left a frozen-out board stood 2-3s until
  // the closing break (`coronation_elsa_10.mp4`, three windows), and standing
  // ice buys nothing. The break itself is ~550ms of taps and settle.
  refreezeMinWindowLeftMs: 600,
  // A look that reads under this share of the board's circles, no more than
  // `hiddenIceFreeMax` of them free, and a real pile, is frozen out too: the
  // missing circles are frozen tsums the scan cannot see through the ice,
  // and a chain drawn there lands on them. It breaks at once. On video every
  // unplanned break followed such a look (23-39 circles of ~48, 7-19 free);
  // 0.8 and 15 caught 8 of 11 and stopped 3 of 231 safe chains.
  hiddenIceFraction: 0.8,
  hiddenIceFreeMax: 15,
  // A chain the game took (its tsums gone) that froze fewer new tsums than
  // this is fruitless: the board is one the bands cannot reach any more --
  // ice above holding the refill off, the free tsums left in a corner the
  // bands already cover. Two in a row, like two starved looks, break the
  // pile. `coronation_elsa_10.mp4` at 1:00: five chains, the ice count flat
  // at 13-14, the pile standing 2s longer than it needed to.
  chainFreezeMin: 2,
  // Leftover ice read between windows this big or bigger is a burst that
  // missed, and is spent. Smaller is a band left standing on
  // purpose: it doubles under the next window's bands.
  leftoverBurstMin: 8,
  // A chain the game took clears its tsums; one it did not leaves them where
  // they were, and drawing it again changes nothing. So after each chain the
  // next look checks: no more ice than before, and at least `chainStaysMin`
  // of its tsums still read as free within `chainStayPx` -- a dead chain,
  // its tsums left out of the planning until the next break. Without this a
  // chain of two colours the read merged, or of phantom circles on bare
  // floor, was drawn look after look while a frozen board stood
  // (`coronation_elsa_9.mp4`: 8s on one three-tsum chain).
  chainStayPx: 8,
  chainStaysMin: 2,
  // How often, at most, a starved look checks the round is still on (see the
  // header: a window opened in the round's last seconds outlives it). One
  // capture a second, and only on the looks a finished round produces.
  roundCheckMs: 1000,
  // TIME UP dims the board, and `elsaRoundOver` does not see it (no page).
  // Two looks in a row whose scan averages under this value (cluster value
  // weighted by size, at least `dimMinTsums` read) end the window with no
  // more taps. In-window scans across 16 rounds: never two in a row under
  // 100 during play; every window open at TIME UP read 48-92 (2026-09-25).
  dimValueMax: 100,
  dimMinTsums: 10
};

/**
 * Whether a round-over screen has replaced the board: the tally, or one of the
 * panels before it. The play loop's own check (`watchRoundEnd`), same sweep,
 * so the pause menu and an animation over the HUD do not end the window --
 * only a screen the round genuinely ends on does.
 */
function elsaRoundOver(): boolean {
  return isRoundOverPage(gPages.detect(1, 0, inRoundPages()));
}

// Live colours seen inside the frozen box on scans where ice was impossible,
// as the range of cluster HSV it has read at (`b`/`g`/`r` = hue/saturation/
// value), with how many scans each has been seen on and the brightest centre
// any of its tsums read (`sureValMin`'s ceiling). Per round: the colour lineup changes between
// rounds. `elsaWindowRound` is the last round a freeze window ran in -- while
// it differs from the current round, no ice can exist, which is what makes a
// scan safe to learn from. Rounds are `logRoundKey`s, so a new run's round 1
// does not inherit the last run's state.
interface ElsaIceAlike {
  lo: Color;
  hi: Color;
  seen: number;
  brightest: number;
}
var elsaIceAlikes: ElsaIceAlike[] = [];
var elsaIceAlikeRound = '';
var elsaWindowRound = '';

/** The remembered ice-alike `c` is a re-read of, if any: inside its range plus `iceAlikeMatch`. */
function elsaIceAlikeMatch(c: Color): ElsaIceAlike | null {
  const m = CoronationElsaConfig.iceAlikeMatch;
  for (let i = 0; i < elsaIceAlikes.length; i++) {
    const a = elsaIceAlikes[i];
    if (c.b >= a.lo.b - m.hue && c.b <= a.hi.b + m.hue
        && c.g >= a.lo.g - m.sat && c.g <= a.hi.g + m.sat
        && c.r >= a.lo.r - m.val && c.r <= a.hi.r + m.valUp) {
      return a;
    }
  }
  return null;
}

/**
 * Whether a cluster centre is a colour known to be alive, not ice: a re-read
 * of a remembered one (per axis, because value drifts far more than hue or
 * saturation do) that has been on the board scan after scan. A colour seen
 * only once or twice is a transient -- a flash, a coin shower, a refill mid
 * fall -- and one of those was enough to exonerate real ice for a whole run
 * (`coronation_elsa_4.mp4`: a four-tsum pale cluster on one scan, then every
 * band read as free and the final chain dragged through it).
 */
function elsaIceAlike(c: Color): ElsaIceAlike | null {
  const a = elsaIceAlikeMatch(c);
  return a !== null && a.seen >= CoronationElsaConfig.iceAlikeMinScans ? a : null;
}

/** The centre value from which a tsum of this live colour is ice after all. */
function elsaSureVal(a: ElsaIceAlike): number {
  const box = CoronationElsaConfig.ice;
  return Math.max(box.sureValMin, a.brightest + box.sureValMargin);
}

/**
 * Learn this round's ice-alikes off a scan that cannot be looking at ice:
 * called from `orderPaths`, and a no-op once the round's first window has
 * opened. Any cluster with `iceAlikeMinTsums` or more of its tsums reading
 * as ice before then is a live-colour candidate; it counts once the scans
 * keep agreeing. The same per-tsum read as the window's, so what it learns
 * is exactly what would have been called ice: a grey-blue cat's centre reads
 * (95, 40, 210), inside the ice box, on `coronation_elsa_11.mp4`, and a box
 * on the cluster centre (value 155-187 there) had never learned it.
 */
function elsaNoteIceAlikes(ts: Tsum, board: BoardPoint[]): void {
  if (elsaIceAlikeRound !== logRoundKey()) {
    elsaIceAlikes = [];
    elsaIceAlikeRound = logRoundKey();
  }
  if (elsaWindowRound === logRoundKey()) { return; }
  const cfg = CoronationElsaConfig;
  const clusters = ts.boardClusters;
  const sizes = ts.boardClusterSizes;
  // Per cluster: how many of its tsums read as ice, and the brightest centre
  // among them.
  const icy: number[] = [];
  const bright: number[] = [];
  for (let i = 0; i < clusters.length; i++) { icy.push(0); bright.push(0); }
  const none: (ElsaIceAlike | null)[] = [];
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    const idx = +p.tsumIdx;
    if (idx < icy.length && elsaPointIsIce(p, none)) {
      icy[idx]++;
      if (p.local !== undefined && p.local.r > bright[idx]) { bright[idx] = p.local.r; }
    }
  }
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (icy[i] < cfg.iceAlikeMinTsums) { continue; }
    const known = elsaIceAlikeMatch(c);
    if (known !== null) {
      known.seen++;
      if (bright[i] > known.brightest) { known.brightest = bright[i]; }
      // Widen the range to this read: no ice exists yet, so it is live.
      known.lo = { b: Math.min(known.lo.b, c.b), g: Math.min(known.lo.g, c.g), r: Math.min(known.lo.r, c.r) };
      known.hi = { b: Math.max(known.hi.b, c.b), g: Math.max(known.hi.g, c.g), r: Math.max(known.hi.r, c.r) };
      if (known.seen === cfg.iceAlikeMinScans) {
        logDebug(Log.Skill.ElsaIceAlike, {
          // The range so far, [lo, hi]; it keeps widening until the first window.
          hue: [known.lo.b, known.hi.b], sat: [known.lo.g, known.hi.g], val: [known.lo.r, known.hi.r],
          tsums: sizes[i], brightest: known.brightest,
        });
      }
    } else {
      elsaIceAlikes.push({
        lo: { b: c.b, g: c.g, r: c.r }, hi: { b: c.b, g: c.g, r: c.r }, seen: 1, brightest: bright[i],
      });
    }
  }
}

/**
 * Whether one tsum reads as ice: its own centre colour in the ice box or
 * the pale one (see the tuning note), unless its colour cluster is a
 * remembered ice-alike -- a live colour, however icy it reads. `alike` is
 * that colour per cluster index, or null, from `elsaIceAlikeClusters`.
 */
function elsaPointIsIce(p: BoardPoint, alike: (ElsaIceAlike | null)[]): boolean {
  const c = p.local;
  if (c === undefined) { return false; }
  const box = CoronationElsaConfig.ice;
  const a = alike[+p.tsumIdx] || null;
  if (c.r >= box.valMin && c.b >= box.hueMin && c.b <= box.hueMax
      && c.g >= box.satMin && c.g <= box.satMax) {
    // A live colour, unless the centre is too bright for one (`elsaSureVal`).
    return a === null || c.r >= elsaSureVal(a);
  }
  if (a !== null) { return false; }
  const contrast = p.contrast === undefined ? 0 : p.contrast;
  return c.r >= box.paleValMin && c.g <= box.paleSatMax
    && c.b >= box.paleHueMin && c.b <= box.paleHueMax
    && contrast < box.paleContrastMax;
}

/** The remembered live colour each of the last scan's clusters is, by index, or null. */
function elsaIceAlikeClusters(ts: Tsum): (ElsaIceAlike | null)[] {
  const clusters = ts.boardClusters;
  const alike: (ElsaIceAlike | null)[] = [];
  for (let i = 0; i < clusters.length; i++) { alike.push(elsaIceAlike(clusters[i])); }
  return alike;
}

/** The board split into what reads as ice and what does not. */
function elsaSplitIce(ts: Tsum, board: BoardPoint[]): { free: BoardPoint[], iced: BoardPoint[] } {
  const alike = elsaIceAlikeClusters(ts);
  const free: BoardPoint[] = [];
  const iced: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    if (elsaPointIsIce(board[i], alike)) { iced.push(board[i]); } else { free.push(board[i]); }
  }
  return { free: free, iced: iced };
}

/** The paths with no tsum in `iced`. */
function elsaLiveChains(paths: TsumPath[], iced: BoardPoint[]): TsumPath[] {
  const out: TsumPath[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    let live = true;
    for (let j = 0; j < p.length && live; j++) {
      live = iced.indexOf(p[j]) < 0;
    }
    if (live) { out.push(p); }
  }
  return out;
}

/**
 * What a drag has to keep away from: a frozen tsum, or a bubble still on the
 * board. `pad` is the obstacle's own size beyond a tsum's -- a bubble's read
 * radius over a tsum radius. Board points carry no pad.
 */
interface ElsaObstacle {
  x: number;
  y: number;
  pad?: number;
}

/**
 * Whether every drag segment of `path` keeps `clearance` (plus each obstacle's
 * own `pad`) away from all of `obstacles`. A blocked path is simply not drawn
 * this look; the next capture, or a pop, may free its surroundings.
 */
function elsaPathIsClear(path: TsumPath, obstacles: ElsaObstacle[], clearance: number): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    for (let j = 0; j < obstacles.length; j++) {
      const p = obstacles[j];
      const keep = clearance + (p.pad || 0);
      // Nearest point of the segment to p, by clamped projection.
      let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
      if (ex * ex + ey * ey <= keep * keep) { return false; }
    }
  }
  return true;
}

/**
 * The free tsums as rows, lowest row first: each row is its lowest member and
 * everything within `rowTolerance` above it. Board points are top-left corners,
 * so larger y is lower on the screen.
 */
function elsaRows(free: BoardPoint[]): BoardPoint[][] {
  const tol = CoronationElsaConfig.rowTolerance;
  const sorted = free.slice().sort(function(a, b) { return b.y - a.y; });
  const rows: BoardPoint[][] = [];
  const taken: boolean[] = [];
  for (let i = 0; i < sorted.length; i++) { taken.push(false); }
  for (let i = 0; i < sorted.length; i++) {
    if (taken[i]) { continue; }
    const row = [sorted[i]];
    taken[i] = true;
    for (let j = i + 1; j < sorted.length; j++) {
      if (!taken[j] && sorted[i].y - sorted[j].y <= tol) {
        row.push(sorted[j]);
        taken[j] = true;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** How far a chain's end line leans off horizontal: |dy| per unit of |dx|. */
function elsaSlant(path: TsumPath): number {
  const a = path[0], b = path[path.length - 1];
  return Math.abs(b.y - a.y) / Math.max(Math.abs(b.x - a.x), 1);
}

/**
 * Every same-colour chain of 3 to `maxLen` tsums in `strip` whose hops are all
 * `maxHop` or shorter -- a plain bounded DFS, since a strip is ~20 tsums and
 * the game's own adjacency keeps the branching small. Not `calculatePaths`:
 * that returns one longest chain per colour component, with its hops at the
 * search's full reach, and the ends wherever the DFS left them.
 */
function elsaStripChains(strip: BoardPoint[], maxHop: number, maxLen: number, from?: number): TsumPath[] {
  const out: TsumPath[] = [];
  const neighbors = buildTsumNeighbors(strip, maxHop * maxHop);
  const inPath: boolean[] = [];
  for (let i = 0; i < strip.length; i++) { inPath.push(false); }
  const path: number[] = [];
  const grow = function(at: number): void {
    path.push(at);
    inPath[at] = true;
    if (path.length >= 3) {
      const chain: TsumPath = [];
      for (let i = 0; i < path.length; i++) { chain.push(strip[path[i]]); }
      chain.tsumIdx = +strip[at].tsumIdx;
      out.push(chain);
    }
    if (path.length < maxLen) {
      const next = neighbors[at];
      for (let i = 0; i < next.length; i++) {
        const n = next[i];
        if (!inPath[n] && strip[n].tsumIdx === strip[at].tsumIdx) { grow(n); }
      }
    }
    path.pop();
    inPath[at] = false;
  };
  if (from !== undefined) {
    grow(from);
  } else {
    for (let s = 0; s < strip.length; s++) { grow(s); }
  }
  return out;
}

/**
 * The flattest of `paths` whose drag keeps clear of `obstacles` and, when
 * `floor` is given, has an end below it; between equals the shorter, which
 * wanders less. Null when none qualifies.
 */
function elsaFlattest(paths: TsumPath[], obstacles: ElsaObstacle[], floor: number | null): TsumPath | null {
  const cfg = CoronationElsaConfig;
  let best: TsumPath | null = null;
  let bestSlant = Infinity;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const a = p[0], b = p[p.length - 1];
    if (floor !== null && a.y < floor && b.y < floor) { continue; }
    if (!elsaPathIsClear(p, obstacles, cfg.dragClearance)) { continue; }
    const slant = elsaSlant(p);
    if (best === null || slant < bestSlant || (slant === bestSlant && p.length < best.length)) {
      best = p;
      bestSlant = slant;
    }
  }
  return best;
}

/**
 * The next chain: the flattest chain anchored in the lowest row that has one,
 * planned over that row and the `rowSpan - 1` above it.
 *
 * The ends are what matter -- the end line is the band -- and the tsums
 * between them may step into the rows above, which is what gives the chain
 * adjacent tsums to hop between (see the header). `obstacles` is the read ice
 * plus any bubbles, and a chain whose drag would touch one is not a candidate.
 *
 * The hop limit is tiered (`maxHops`): every row at the tight limit first,
 * and the wider one only when no row has a chain at all. The planner is
 * microseconds, so the widening happens on one capture, not across looks.
 *
 * With ice read, every row is planned and the chain whose
 * band line crosses the most ice wins (`elsaOverlap`), the lowest row
 * breaking ties: a band laid over ice doubles it without spending the free
 * tsums the next chains need, so the pile lasts more chains before it has
 * to be broken. With no ice every score is 0 and it is the lowest row.
 *
 * Returns the chain, the index of the row it is anchored in, the hop limit
 * that found it, the y span of the rows it was planned over and the ice its
 * line crosses, or null when no row can be chained -- the board is played out.
 */
function elsaRowChain(free: BoardPoint[], obstacles: ElsaObstacle[], iced: BoardPoint[]):
    { path: TsumPath, row: number, hop: number, top: number, bottom: number, overlap: number } | null {
  const cfg = CoronationElsaConfig;
  const rows = elsaRows(free);
  const scored = iced.length > 0;
  for (let t = 0; t < cfg.maxHops.length; t++) {
    const maxHop = cfg.maxHops[t];
    let found: { path: TsumPath, row: number, hop: number, top: number, bottom: number, overlap: number } | null = null;
    for (let r = 0; r < rows.length; r++) {
      let strip: BoardPoint[] = [];
      for (let k = 0; k < cfg.rowSpan && r + k < rows.length; k++) {
        strip = strip.concat(rows[r + k]);
      }
      if (strip.length < 3) { continue; }
      // The row's own floor: one end at least must stand in this row, so the
      // band is anchored this low. Both ends in it would be flatter, but a
      // four-colour board rarely has an adjacent same-colour pair in one row,
      // and a band a little slanted is only a little thicker -- which, for
      // the band the final chain doubles, is no loss at all.
      const floor = rows[r][0].y - cfg.rowTolerance;
      const paths = elsaStripChains(strip, maxHop, cfg.rowMaxChain);
      let best: TsumPath | null = null;
      let over = 0;
      if (scored) {
        // Most ice crossed; between equals, `elsaFlattest`'s choice.
        let most = -1;
        let tied: TsumPath[] = [];
        for (let i = 0; i < paths.length; i++) {
          if (elsaFlattest([paths[i]], obstacles, floor) === null) { continue; }
          const n = elsaPathIsClear(paths[i], obstacles, cfg.overlapClearPx) ? elsaOverlap(paths[i], iced) : 0;
          if (n > most) { most = n; tied = [paths[i]]; } else if (n === most) { tied.push(paths[i]); }
        }
        best = elsaFlattest(tied, obstacles, floor);
        over = Math.max(0, most);
      } else {
        best = elsaFlattest(paths, obstacles, floor);
      }
      if (best === null || (found !== null && over <= found.overlap)) { continue; }
      let top = rows[r][0].y;
      for (let i = 0; i < strip.length; i++) { top = Math.min(top, strip[i].y); }
      found = {path: best, row: r, hop: maxHop, top: top, bottom: rows[r][0].y, overlap: over};
      if (!scored) { break; }
    }
    if (found !== null) { return found; }
  }
  return null;
}

/**
 * How many of `iced` lie on the band `path` would freeze: within
 * `overlapBandPx` of the line through its ends, which the band follows to
 * both edges of the board.
 */
function elsaOverlap(path: TsumPath, iced: BoardPoint[]): number {
  const a = path[0], b = path[path.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) { return 0; }
  const band = CoronationElsaConfig.overlapBandPx;
  let n = 0;
  for (let i = 0; i < iced.length; i++) {
    const d = Math.abs((iced[i].x - a.x) * dy - (iced[i].y - a.y) * dx) / len;
    if (d <= band) { n++; }
  }
  return n;
}

/**
 * How many of `path`'s tsums still stand: points with a free tsum within
 * `chainStayPx` on the look after the drag.
 */
function elsaChainStays(path: TsumPath, free: BoardPoint[]): number {
  const px = CoronationElsaConfig.chainStayPx;
  let stays = 0;
  for (let i = 0; i < path.length; i++) {
    for (let j = 0; j < free.length; j++) {
      const dx = free[j].x - path[i].x, dy = free[j].y - path[i].y;
      if (dx * dx + dy * dy <= px * px) { stays++; break; }
    }
  }
  return stays;
}

/** `free` without any tsum standing on a dead chain's point. */
function elsaWithoutDead(free: BoardPoint[], dead: BoardPoint[]): BoardPoint[] {
  if (dead.length === 0) { return free; }
  const px = CoronationElsaConfig.chainStayPx;
  const out: BoardPoint[] = [];
  for (let i = 0; i < free.length; i++) {
    let on = false;
    for (let j = 0; j < dead.length && !on; j++) {
      const dx = free[i].x - dead[j].x, dy = free[i].y - dead[j].y;
      on = dx * dx + dy * dy <= px * px;
    }
    if (!on) { out.push(free[i]); }
  }
  return out;
}

/** `bubbles` less any centred within `bubbleIceGap` of an ice read: those may be frozen. */
function elsaPoppable(bubbles: GameBubble[], iced: BoardPoint[]): GameBubble[] {
  const half = Config.tsumWidth / 2;
  const gap = Config.tsumWidth * CoronationElsaConfig.bubbleIceGap;
  return bubbles.filter(function(b) {
    for (let i = 0; i < iced.length; i++) {
      const dx = iced[i].x + half - b.x, dy = iced[i].y + half - b.y;
      if (dx * dx + dy * dy < gap * gap) { return false; }
    }
    return true;
  });
}

/**
 * The salvo's chains off one look: the play loop's own search, longest first,
 * each clear of read ice and bubbles and sharing no tsum with one already
 * taken. Empty when fewer than two qualify -- one chain is the sweep's job.
 */
function elsaSalvo(free: BoardPoint[], obstacles: ElsaObstacle[]): TsumPath[] {
  const cfg = CoronationElsaConfig;
  const paths = calculatePaths(free, -1, false, cfg.salvoMaxChain);
  const out: TsumPath[] = [];
  const used: BoardPoint[] = [];
  for (let i = 0; i < paths.length && out.length < cfg.salvoChains; i++) {
    const p = paths[i];
    if (p.length < 3 || !elsaPathIsClear(p, obstacles, cfg.dragClearance)) { continue; }
    if (p.some(function(t) { return used.indexOf(t) >= 0; })) { continue; }
    out.push(p);
    for (let k = 0; k < p.length; k++) { used.push(p[k]); }
  }
  return out.length >= 2 ? out : [];
}

/**
 * The last scan's mean cluster value (HSV value, weighted by cluster size),
 * or null when it read under `dimMinTsums` -- too few to say.
 */
function elsaBoardValue(ts: Tsum): number | null {
  const c = ts.boardClusters, n = ts.boardClusterSizes;
  let sum = 0, count = 0;
  for (let i = 0; i < c.length && i < n.length; i++) { sum += c[i].r * n[i]; count += n[i]; }
  return count >= CoronationElsaConfig.dimMinTsums ? sum / count : null;
}

/** A board point's centre on screen, as `linkTsums` converts it. */
function elsaToScreen(ts: Tsum, p: BoardPoint): Point {
  return {
    x: Math.floor(ts.playOffsetX + (p.x + Config.tsumWidth / 2) * ts.playWidth / ts.playResizeWidth),
    y: Math.floor(ts.playOffsetY + (p.y + Config.tsumWidth / 2) * ts.playHeight / ts.playResizeHeight),
  };
}

// Colour clusters that may hold two kinds this round, by cluster centre (HSV
// as `b`/`g`/`r`). A dead chain nominates its colour; the colour's next kind
// read confirms it (a member darkened) or clears it (none did -- the chain
// died of a hop, not a kind). In mui0gs7xco and the rounds after, 251 of 436
// kind reads darkened nothing, and chains drawn off them still died 14% of
// the time. Per round, like `elsaIceAlikes`.
interface ElsaMixedColour extends Color {
  confirmed: boolean;
}
var elsaMixed: ElsaMixedColour[] = [];
var elsaMixedRound = '';

/** The mixed colour `c` is a re-read of, if any. */
function elsaMixedMatch(c: Color | undefined): ElsaMixedColour | null {
  if (c === undefined) { return null; }
  if (elsaMixedRound !== logRoundKey()) { elsaMixed = []; elsaMixedRound = logRoundKey(); }
  const m = CoronationElsaConfig.iceAlikeMatch;
  for (let i = 0; i < elsaMixed.length; i++) {
    const a = elsaMixed[i];
    if (Math.abs(a.b - c.b) <= m.hue && Math.abs(a.g - c.g) <= m.sat && Math.abs(a.r - c.r) <= m.val) {
      return a;
    }
  }
  return null;
}

/** Whether cluster colour `c` is nominated or confirmed as mixed this round. */
function elsaIsMixed(c: Color | undefined): boolean {
  return elsaMixedMatch(c) !== null;
}

/** Nominate cluster colour `c` as mixed. */
function elsaNoteMixed(c: Color | undefined): void {
  if (c === undefined || elsaIsMixed(c)) { return; }
  elsaMixed.push({ b: c.b, g: c.g, r: c.r, confirmed: false });
}

/** A kind read's verdict on colour `c`: confirm it mixed, or clear an unconfirmed nomination. */
function elsaKindVerdict(c: Color | undefined, darkened: boolean): void {
  const a = elsaMixedMatch(c);
  if (a === null || a.confirmed) { return; }
  if (darkened) { a.confirmed = true; } else { elsaMixed.splice(elsaMixed.indexOf(a), 1); }
}

/** What a kind read came to. */
interface ElsaKind {
  /** The chain drawn from the head, or null when the finger was lifted. */
  path: TsumPath | null;
  /** Members sampled, and how many stayed bright: the head's kind. */
  pool: number;
  kept: number;
  /** Each member's floor drop, for tuning `kind.dropMax`. */
  drops: number[];
  ms: number;
}

/**
 * Chain from `head` over the members of `pool` that are its kind: finger
 * down, read their floors before and after `kind.ms`, and keep the ones that
 * did not darken; then the flattest chain from the head clear of `obstacles`.
 * No chain: the finger is lifted, which links nothing.
 */
function elsaKindChain(ts: Tsum, head: BoardPoint, pool: BoardPoint[], obstacles: ElsaObstacle[]): ElsaKind {
  const cfg = CoronationElsaConfig;
  const kc = cfg.kind;
  const from = Date.now();
  const out: ElsaKind = { path: null, pool: pool.length, kept: 0, drops: [], ms: 0 };
  if (!ts.mayTouchBoard()) { return out; }
  const base = skillFloorRead(ts, pool, kc.grid, kc.step);
  const at = elsaToScreen(ts, head);
  let finger = at;
  let down = true;
  tapDown(at.x, at.y, kc.grabMs);
  try {
    moveTo(at.x, at.y, kc.moveMs);
    ts.sleep(Math.max(0, kc.ms - kc.grabMs - kc.moveMs));
    const now = skillFloorRead(ts, pool, kc.grid, kc.step);
    // The head first, so the search grows from index 0.
    const members: BoardPoint[] = [head];
    for (let k = 0; k < pool.length; k++) {
      if (pool[k] === head) { continue; }
      const drop = base[k] - now[k];
      out.drops.push(drop);
      if (drop < kc.dropMax) { members.push(pool[k]); out.kept++; }
    }
    let path: TsumPath | null = null;
    for (let t = 0; t < cfg.maxHops.length && path === null; t++) {
      path = elsaFlattest(elsaStripChains(members, cfg.maxHops[t], cfg.rowMaxChain, 0), obstacles, null);
    }
    if (path !== null) {
      for (let j = 1; j < path.length; j++) {
        finger = elsaToScreen(ts, path[j]);
        moveTo(finger.x, finger.y, kc.moveMs);
      }
      out.path = path;
    }
    down = false;
    tapUp(finger.x, finger.y, kc.releaseMs);
  } catch (e) {
    if (down) { tapUp(finger.x, finger.y, kc.releaseMs); }
    throw e;
  }
  out.ms = Date.now() - from;
  return out;
}

/**
 * How long to keep the board after a burst of `pile` tsums. The refill scales
 * with the clear, so a flat wait cannot serve both a 16-tsum pop and a
 * whole-board one. Capped, because the wait comes out of the window.
 */
function elsaPostBurstSettleMs(pile: number): number {
  const cfg = CoronationElsaConfig;
  return Math.min(cfg.postBurstSettleMaxMs,
    cfg.postBurstSettleMs + pile * cfg.postBurstSettlePerTsumMs);
}

/**
 * Set off the pile, and say how many tsums it was aimed at.
 *
 * Aimed taps, top of the board down and spread evenly down the pile, so a
 * pile the read has slightly wrong is still covered. No blind sweep: its ~25
 * taps took 1.4s and pushed closing breaks past the window's end (user saw it
 * as a bubble sweep, 2026-09-25); a pile the taps miss is spent as leftover
 * by the next scan.
 *
 * Then the bubbles the same capture found, one tap each: a bubble inside the
 * pile survives the break otherwise (`coronation_elsa_10.mp4` at 0:10, two
 * still standing under the coins) and stays locked under the next freeze.
 *
 * A tap is not a drag, so one that lands on an ordinary tsum links nothing and
 * the game ignores it.
 */
Tsum.prototype.elsaBurstFrozen = function(frozen) {
  // Raw taps below bypass `ts.tap`, so its rules are applied here.
  if (!this.mayTouchBoard()) { return 0; }
  const cfg = CoronationElsaConfig;
  // Highest ice first, working down: a tap spends the group of ice it lands
  // in, clearing a group drops everything above it, and nothing below a tap
  // moves -- so top-down keeps each position true as it lands. A copy -- the
  // caller's list is its own.
  const pile = frozen.slice().sort(function(a, b) { return a.y - b.y; });
  const taps = Math.min(cfg.burstTaps, pile.length);
  const step = taps > 0 ? Math.max(1, Math.floor(pile.length / taps)) : 1;
  for (let i = 0; i < taps; i++) {
    const p = pile[i * step];
    // Board points are the tsum's top-left corner in the 200px play square, the
    // shape `linkTsums` converts from -- so the half-width goes back on here too.
    const x = Math.floor(this.playOffsetX
      + (p.x + Config.tsumWidth / 2) * this.playWidth / this.playResizeWidth);
    const y = Math.floor(this.playOffsetY
      + (p.y + Config.tsumWidth / 2) * this.playHeight / this.playResizeHeight);
    tap(x, y, cfg.burstTapDuring, TapHoldMs);
  }
  this.popGameBubbles(this.gameBubbles.length);
  logDebug(Log.Skill.ElsaBurst, { aimedAt: taps, read: frozen.length });
  return taps;
};

/**
 * One settled look at the board: capture, split the tsums into free and ice,
 * and hand back what a drag must keep away from.
 *
 * Two things send it back for another capture, each a bounded number of
 * times:
 *
 *   - **a board mid-fall.** The board moves at exactly three moments -- the
 *     window opening on the previous batch's refill, a pop's slide, a burst's
 *     refill -- and every one of them leaves the board ice-free, so an
 *     ice-free look that reads clearly fewer tsums than the board is known to
 *     hold (`expected`) is a fall in flight. Chaining it drags at air.
 *   - **bubbles.** A bubble holes every band drawn through it and pops under
 *     any drag across it, and the break's bomb is a bubble too. The capture
 *     already knows where they are, so they are popped aimed and the board
 *     looked at again after the fall -- with ice standing too, since a pop
 *     does not set the pile off. Only a bubble on an ice read is left
 *     (`elsaPoppable`); it and any the rounds ran out on become obstacles.
 */
Tsum.prototype.elsaLook = function(closesAt, expected) {
  const cfg = CoronationElsaConfig;
  const expect = expected || 0;
  let free: BoardPoint[] = [];
  let iced: BoardPoint[] = [];
  let waits = 0;
  let pops = 0;
  let popped = 0;
  for (;;) {
    const split = elsaSplitIce(this, this.scanBoardQuick());
    free = split.free;
    iced = split.iced;
    if (iced.length === 0 && waits < cfg.settleMaxWaits
        && free.length < cfg.settledFraction * expect
        && Date.now() + cfg.settleRetryMs < closesAt) {
      waits++;
      this.sleep(cfg.settleRetryMs);
      continue;
    }
    const poppable = elsaPoppable(this.gameBubbles, iced);
    if (poppable.length > 0 && pops < cfg.bubblePopRounds
        && Date.now() + cfg.bubbleSettleMs < closesAt) {
      pops++;
      popped += poppable.length;
      // `popGameBubbles` taps the whole list and then clears it; the next
      // capture reads whatever is left.
      this.gameBubbles = poppable;
      this.popGameBubbles(poppable.length);
      this.sleep(cfg.bubbleSettleMs);
      continue;
    }
    break;
  }
  const obstacles: ElsaObstacle[] = iced.slice();
  for (let i = 0; i < this.gameBubbles.length; i++) {
    const b = this.gameBubbles[i];
    obstacles.push({
      x: b.x - Config.tsumWidth / 2,
      y: b.y - Config.tsumWidth / 2,
      pad: Math.max(0, b.r - Config.tsumWidth / 2),
    });
  }
  return { free: free, iced: iced, obstacles: obstacles, waits: waits, pops: pops, popped: popped };
};

/**
 * Play the freeze window as the sweep the header describes: chain after chain
 * on the lowest free row, one look per chain, until the window is nearly out;
 * then one break and the bomb it leaves popped.
 *
 * Anchored to `activatedAt` rather than to when this was entered, so the window
 * is the game's and not the script's. `expectTsums` is the population of the
 * board the play loop scanned before activating, for the settle gate.
 */
Tsum.prototype.useCoronationElsaSkill = function(activatedAt, expectTsums) {
  const cfg = CoronationElsaConfig;
  const t0 = activatedAt || Date.now();
  const level = Math.min(Math.max(this.skillLevel, 1), cfg.durationMs.length);
  const windowMs = cfg.durationMs[level - 1];
  // The window's own clock starts when the animation ends, not at the tap.
  const opensAt = t0 + cfg.leadInMs;
  const closesAt = opensAt + windowMs;
  // The last moment a chain may still go out with room for its band to form
  // and the break to land inside the window.
  const chainBy = closesAt - cfg.burstTailMs;

  this.sleepUntil(opensAt);

  // How many tsums the board is believed to hold: seeded from the play loop's
  // scan and raised to the best count any look reads.
  let expected = expectTsums || 0;
  let looks = 0;
  let chains = 0;
  let starved = 0;
  let starvedRun = 0;
  let bursts = 0;
  let aimedTaps = 0;
  // The last read that saw ice: what the break aims at.
  let iced: BoardPoint[] = [];
  // The chain just drawn and the ice count it was drawn over, judged by the
  // next look; the points of every chain this pile did not take.
  let drawn: TsumPath | null = null;
  let drawnOverIced = 0;
  let dead: BoardPoint[] = [];
  let deadChains = 0;
  let fruitlessChains = 0;
  // Kind reads (`elsaKindChain`): chains drawn off one, and plans lifted.
  let kindChains = 0;
  let kindLifts = 0;
  // The colour cluster of the chain just drawn, nominated as mixed if it dies;
  // none for a chain off a kind read, which already judged it.
  let drawnKind: Color | undefined = undefined;
  let bubblesPopped = 0;
  let salvos = 0;
  // `cfg.salvos` a window, then the sweep chains whatever they leave.
  let salvoDone = cfg.salvos <= 0;
  let salvoChains = 0;
  // The round ending under the window; nothing is tapped once it has.
  let roundOver = false;
  let roundCheckedAt = 0;
  // Consecutive looks whose scan read dim (`dimValueMax`).
  let dimRun = 0;
  while (this.isRunning && Date.now() < chainBy) {
    const look = this.elsaLook(chainBy, expected);
    looks++;
    bubblesPopped += look.popped;
    const read = look.free.length + look.iced.length;
    if (read > expected) { expected = read; }
    if (look.iced.length > 0) { iced = look.iced; }
    let failed = false;
    if (drawn !== null) {
      // Judge the chain just drawn. Dead: same ice, its tsums still standing
      // -- its points are out of the plan. Fruitless: taken, but it froze
      // next to nothing. Either counts as a starved look, so a board with
      // nothing left for the bands is broken rather than worked; a chain
      // that froze a band resets the count.
      const froze = look.iced.length - drawnOverIced;
      failed = froze <= 0 && elsaChainStays(drawn, look.free) >= cfg.chainStaysMin;
      if (failed) {
        dead = dead.concat(drawn);
        deadChains++;
        // Its cluster holds two kinds: later chains of it get a kind read.
        elsaNoteMixed(drawnKind);
        starvedRun++;
      } else if (froze < cfg.chainFreezeMin) {
        fruitlessChains++;
        starvedRun++;
      } else {
        starvedRun = 0;
      }
      drawn = null;
    }
    const live = elsaWithoutDead(look.free, dead);
    const pick = elsaRowChain(live, look.obstacles, look.iced);
    const hidden = pick !== null && look.iced.length >= cfg.refreezeMinIced
      && read < cfg.hiddenIceFraction * expected && look.free.length <= cfg.hiddenIceFreeMax;
    logDebug(Log.Skill.ElsaPass, {
      atMs: Date.now() - t0,
      free: look.free.length,
      iced: look.iced.length,
      waits: look.waits,
      pops: look.pops,
      popped: look.popped,
      // Bubbles left standing: on ice, or past the pop rounds.
      bubbles: this.gameBubbles.length,
      // The previous chain left its tsums standing.
      failed: failed,
      row: pick === null ? -1 : pick.row,
      chainLen: pick === null ? 0 : pick.path.length,
      // The hop tier that found it: the wide one on a board frozen nearly out.
      hop: pick === null ? 0 : pick.hop,
      // Frozen out by what the scan cannot see (`hiddenIceFraction`): not drawn.
      hidden: hidden,
      // Read ice on the chosen chain's band line (`overlap`).
      overlap: pick === null ? 0 : pick.overlap,
    });
    // TIME UP dims the board: two dim looks in a row and the round is over.
    const value = elsaBoardValue(this);
    dimRun = value !== null && value < cfg.dimValueMax ? dimRun + 1 : 0;
    if (dimRun >= 2) {
      logInfo(Log.Skill.ElsaRoundOver, { atMs: Date.now() - t0, looks: looks, dim: Math.round(value as number) });
      roundOver = true;
      break;
    }
    // A finished round reads like a starved board -- few circles, chains that
    // clear nothing -- so those looks are the ones that ask whether it is one.
    // Rate-limited: a board genuinely frozen out reads the same way.
    if ((pick === null || starvedRun > 0)
        && Date.now() - roundCheckedAt >= cfg.roundCheckMs) {
      roundCheckedAt = Date.now();
      if (elsaRoundOver()) {
        logInfo(Log.Skill.ElsaRoundOver, { atMs: Date.now() - t0, looks: looks });
        roundOver = true;
        break;
      }
    }
    // A board with no ice to touch gets the salvos first: long chains back to
    // back, the way the play loop froze a fresh board whole. Later salvos
    // skip the ice gate -- the first one's ice is what they chain around.
    if (!salvoDone && (salvos > 0 || look.iced.length <= cfg.salvoMaxIced)
        && chainBy - Date.now() > cfg.salvoMinLeftMs) {
      const salvo = elsaSalvo(live, look.obstacles);
      if (salvo.length > 0) {
        for (let k = 0; k < salvo.length; k++) { this.linkTsums(salvo[k]); }
        salvos++;
        logDebug(Log.Skill.ElsaSalvo, {
          atMs: Date.now() - t0,
          // Which salvo of the window this was, from 1.
          salvo: salvos,
          iced: look.iced.length,
          chains: salvo.map(function(p) { return p.length; }),
        });
        salvoDone = salvos >= cfg.salvos;
        salvoChains += salvo.length;
        chains += salvo.length;
        // Judged by the ice it leaves, not tsum by tsum.
        drawn = null;
        starvedRun = 0;
        this.sleep(cfg.iceFormMs);
        continue;
      }
      // No room for another: the sweep takes over, not a salvo between its chains.
      if (salvos > 0) { salvoDone = true; }
    }
    if (pick === null || hidden) {
      // Nothing chainable this look -- ice everywhere a row could stand, or a
      // starved read -- or a board whose ice hides the tsums a chain would hit.
      starved++;
      starvedRun = hidden ? Math.max(starvedRun + 1, cfg.refreezeStarvedLooks) : starvedRun + 1;
      if (starvedRun >= cfg.refreezeStarvedLooks && look.iced.length >= cfg.refreezeMinIced
          && chainBy - Date.now() > cfg.refreezeMinWindowLeftMs) {
        // The board is frozen out with window to spare: spend the pile now
        // and sweep the refill. Aimed taps only -- the grid's 25 taps cost
        // ~1.3s of window (`coronation_elsa_8.mp4`: 1.4s a break, three a
        // window). The break taps the bubbles it read too, and the next
        // look pops the bomb the break leaves before chaining.
        aimedTaps += this.elsaBurstFrozen(look.iced);
        bursts++;
        this.sleep(elsaPostBurstSettleMs(look.iced.length));
        iced = [];
        starvedRun = 0;
        // The refill is a new board; a dead chain's tsums are gone with it.
        dead = [];
        continue;
      }
      // Give the board a moment and look again; the clock ends the window,
      // not this.
      this.sleepUntil(Math.min(Date.now() + cfg.rescanIdleMs, chainBy));
      continue;
    }
    // A cluster that has had a dead chain may hold two kinds: the finger rests
    // on the plan's lower end first and the game says which members match.
    const kindColour = this.boardClusters[+pick.path[0].tsumIdx];
    let path: TsumPath | null = pick.path;
    // Whether this chain comes off a kind read, which already judged its colour.
    let kindRead = false;
    if (cfg.kind.on && elsaIsMixed(kindColour)) {
      const a = pick.path[0], b = pick.path[pick.path.length - 1];
      const head = b.y > a.y ? b : a;
      const top = pick.top - cfg.rowTolerance, bottom = pick.bottom + cfg.rowTolerance;
      const pool = live.filter(function(p) {
        return p.tsumIdx === head.tsumIdx && p.y >= top && p.y <= bottom;
      });
      const got = elsaKindChain(this, head, pool, look.obstacles);
      logDebug(Log.Skill.ElsaKind, {
        atMs: Date.now() - t0, planned: pick.path.length,
        chainLen: got.path === null ? 0 : got.path.length,
        pool: got.pool, kept: got.kept, drops: got.drops, ms: got.ms,
      });
      // `kept` counts the members that did not darken.
      elsaKindVerdict(kindColour, got.kept < got.drops.length);
      kindRead = true;
      if (got.path === null) {
        // The head's kind has no chain here: its plan is dead, no ice to wait for.
        kindLifts++;
        dead = dead.concat(pick.path);
        continue;
      }
      kindChains++;
      path = got.path;
    } else {
      // `linkTsums` and not `link`: its bubble pop and its skill check both
      // belong to the play loop, and the second would nest a window in this one.
      this.linkTsums(pick.path);
    }
    // `starvedRun` is settled by the next look's judgement of this chain.
    drawn = path;
    drawnKind = kindRead ? undefined : kindColour;
    drawnOverIced = look.iced.length;
    chains++;
    // Let the band form before the next look reads it.
    this.sleep(cfg.iceFormMs);
  }
  // One more look at the HUD before the break: the round can end in the last
  // seconds of the window, past the looks above, and the break's grid and its
  // post-burst pops are what land on the tally otherwise.
  if (this.isRunning && !roundOver && elsaRoundOver()) {
    logInfo(Log.Skill.ElsaRoundOver, { atMs: Date.now() - t0, looks: looks });
    roundOver = true;
  }
  if (this.isRunning && !roundOver) {
    // Read the pile once more and break it. The look is bounded to now, so it
    // neither waits on a fall nor pops anything.
    const last = this.elsaLook(Date.now(), expected);
    looks++;
    if (last.iced.length > 0) { iced = last.iced; }
    // A pile the aimed taps miss is read as leftover by the next scan and
    // spent (`leftoverBurstMin`).
    aimedTaps += this.elsaBurstFrozen(iced);
    bursts++;
    // The break is a large clear; let it settle, then one look for the bomb it
    // spawned (where the clear count was shown) and pop it aimed. The play
    // loop's own scan follows the moment this hands back.
    this.sleep(elsaPostBurstSettleMs(iced.length));
    this.scanBoardQuick();
    this.popGameBubbles(this.gameBubbles.length);
    this.sleepUntil(closesAt);
  }

  logInfo(Log.Skill.ElsaDone, {
    skillLevel: level,
    windowMs: windowMs,
    looks: looks,
    chains: chains,
    // Looks that found no chain to draw.
    starvedLooks: starved,
    // Chains drawn that left their tsums standing: a colour the read merged,
    // or circles on bare floor.
    deadChains: deadChains,
    // Chains taken that froze under `chainFreezeMin`: a board the bands
    // could not reach any more.
    fruitlessChains: fruitlessChains,
    // Breaks inside the window plus the closing one.
    bursts: bursts,
    // The pile as last read going into the break. Near zero with several
    // chains drawn means something touched ice mid-window.
    icedLast: iced.length,
    aimedTaps: aimedTaps,
    // The round ended under the window: no closing break, no pops.
    roundOver: roundOver,
    // Bubbles tapped by the looks (the breaks' own taps not counted).
    bubblesPopped: bubblesPopped,
    // Salvos drawn (up to `cfg.salvos`) and their chains.
    salvos: salvos,
    salvoChains: salvoChains,
    // Chains drawn off a kind read, and plans it lifted (`elsaKindChain`).
    kindChains: kindChains,
    kindLifts: kindLifts,
    totalMs: Date.now() - t0,
  });
};

registerSkill({
  types: [SkillType.CoronationElsa],
  // She spends every bubble she sees, and the declaration is what says so --
  // aimed on the way in (`beforeActivate`), inside each look and after the
  // break, whatever the Bubble Strategy setting says. The consequence is the
  // one the flag exists for: an activation that emptied the board must not
  // count towards the play loop's own sweep.
  //
  // Uncapped-ish chains in ordinary play, whatever "Maximum Chain Number"
  // says: between windows the only job is refilling the gauge, which counts
  // tsums cleared, and three ten-chains fill it far faster than three
  // three-chains for the same scan gap.
  chainLimits: { maxChain: 5 },
  // Room for her own ice on top of the board's colours. Every shade the ice
  // reads at is an ordinary cluster to the scan and takes one of the
  // `uniqueTsumCount - 1` slots it keeps; ice has been measured at three
  // shades on one part-frozen board, and a colour without a slot is not in
  // the board array for any look to plan over. Four: three for the measured
  // shades and one for the colour the ordinary cut drops.
  extraClusterSlots: 4,
  sweepsBubbles: true,
  orderPaths: function(ts, paths, board) {
    // Before the round's first window, a cluster whose tsums read as ice is
    // a live colour -- learn it now, or it plays as a phantom pile all round.
    elsaNoteIceAlikes(ts, board);
    // Ice read here is *leftover*. A pile-sized leftover is a closing burst
    // that missed, and is spent -- out here there is no fresh pile for a
    // stray tap to cost. A smaller one is a band left standing on purpose:
    // it doubles under the next window's bands, so it is kept and only
    // chained around. Before the round's first window there is no ice, so
    // nothing is: an ice read then is a pale colour, and treating it as ice
    // fired six empty breaks and kept it out of chains (mugrabhyw).
    const leftover = elsaWindowRound === logRoundKey() ? elsaSplitIce(ts, board).iced : [];
    if (leftover.length >= CoronationElsaConfig.leftoverBurstMin) {
      // Aimed only. A leftover read is as often a pale colour or crystal
      // debris as ice, and the grid behind the aimed taps was 1.3s of the
      // gap between windows, three times over on `coronation_elsa_10.mp4`.
      ts.elsaBurstFrozen(leftover);
    }
    // Beyond that, only ever a filter: the ordering `calculatePaths` produced
    // is already longest-first, which is what this skill wants too.
    return elsaLiveChains(paths, leftover);
  },
  beforeActivate: function(ts) {
    // Spend whatever bubbles the cycle's own scan still holds, aimed, before
    // the window opens: a bubble holes every band drawn through it and breaks
    // any chain dragged over it, and there is no chain in the window worth
    // saving one for.
    // ts.popGameBubbles(ts.gameBubbles.length);
  },
  afterActivate: function(ts, board, activatedAt) {
    // Ice exists in this round from here on, so the ice-alike learning stops.
    elsaWindowRound = logRoundKey();
    // The board is the play loop's scan from before its last batch linked, so
    // its length is a full board's population -- the settle gate's seed.
    ts.useCoronationElsaSkill(activatedAt, board ? board.length : 0);
    // Always "did not fire". The gauge reads Active through the freeze window's
    // own animation, so a `true` here buys the whole choreography again on a
    // skill that is not actually ready.
    return false;
  }
});
