// ---------------------------------------------------------------------------
// Coin Target (Alpha)
//
// Plays a round to an exact coin figure, for bingo missions ("earn N coins in
// one play"). The `coinTarget` setting is the figure; 0 is off and nothing in
// this file runs.
//
// What counts is the HUD's coin counter, the round's base coins -- the +Coin
// item's bonus is added after the round and is not aimed at. It is read every
// turn (`StatsRegions.liveCounters`) and taken once two reads agree; a value
// the counter cannot plausibly hold (lower than before, or more than what is
// in flight could pay) needs `implausibleReads` reads over `implausibleMs`.
//
// The counter lags the board: a chain pays when its last tsum pops. So every
// payout started is a "flight" -- a chain at its table value
// (`CoinTargetChainCoins`), a bubble at its estimate -- counted until a read
// taken after it should have landed. Flights are moved back by a pause.
// A chain linked short pays less than its table value, so the estimate errs
// towards stopping early.
//
// Bubbles still on the board pop by themselves after the timer (Last Bonus),
// so each one counts its estimate against what is still wanted.
//
// The bands, by `need` = target - counter - flights - bubble estimates:
//   far       above the skill hold: normal play, each batch trimmed so it
//             cannot pay more than `need`.
//   approach  up to the skill hold (`skillHoldCoins`, or 1.5x the largest
//             activation measured this round): the same, with the skill held.
//   careful   up to `carefulCoins`: the play loop hands each turn to
//             `coinTargetCarefulTurn` -- wait for the counter to settle, then
//             pop one bubble or draw one chain cut to the length that fits.
//   done      nothing left that fits: the round coasts (no touches) to its end,
//             unless the target is raised or cleared from the Quick Bar.
//
// Gated on the setting everywhere it reaches into shared code (play loop,
// `useSkill`, `maybeAutoTapSkill`, `tapGameBubble`, `clearAllBubbles`), so it
// is off for every round without it.
// ---------------------------------------------------------------------------

// --- Tuning data -------------------------------------------------------------

const CoinTargetConfig = {
  /** No skill activation while `need` is this low, until one is measured. */
  skillHoldCoins: 800,
  /** The hold once activations are measured: this times the largest. */
  skillHoldFactor: 1.5,
  /** One chain per turn, each waiting for the counter, while `need` is this low. */
  carefulCoins: 60,
  /** Least allowance per bubble, raised by what pops measure. */
  bubbleCoins: 40,
  /** Tsums a bubble's blast is assumed to take beyond those the scan counted. */
  bubbleSlackTsums: 2,
  /** A blind bubble sweep, counted as this many bubbles. */
  sweepBubbles: 3,
  /** After a chain's last tsum pops, until the counter shows it. */
  counterLagMs: 500,
  /** A skill's payout may still be landing this long after its activation ends. */
  skillLandMs: 5000,
  /** The careful band acts only on a counter unchanged this long (it may roll up). */
  steadyMs: 350,
  /** Between looks while waiting in the careful band. */
  waitPollMs: 120,
  /** No confirmed read this long into the round: give up for the round. */
  giveUpMs: 10000,
  /** The careful band acts only on a confirmed read this recent. */
  staleMs: 1500,
  /** An implausible read is taken after this many agreeing reads, this far apart. */
  implausibleReads: 3,
  implausibleMs: 400,
  /** Slack on the plausible ceiling, for payouts nothing accounted. */
  plausibleSlack: 30,
  /** A pop that paid nothing marks its spot dead within this radius (scan px). */
  deadBubbleRadius: 20,
};

/**
 * Coins a chain (or a burst) of N tsums pays, indexed by N, from the wiki's
 * "Coins Earned by Chain or Burst" chart. Past the table each tsum adds 12.
 * Some skills pay by their own formula; the skill is held near the target.
 */
const CoinTargetChainCoins: number[] = [
  0, 0, 0, 0, 1, 3, 5, 7, 10, 13,            // 0-9
  16, 21, 26, 31, 36, 46, 56, 66, 76, 86,    // 10-19
  96, 106, 116, 126, 136, 146, 156, 166, 176, 186,  // 20-29
  198, 210, 222, 234, 246, 258, 270, 282, 294, 306, // 30-39
  318, 330, 342, 354, 366, 378, 390, 402, 414, 426, // 40-49
  438, 450, 462, 474, 486, 498, 510,         // 50-56
];

/** A chain this long makes a bubble, whose pop pays later. */
const CoinTargetBubbleChain = 7;

// --- State --------------------------------------------------------------------

const enum CoinStep {
  /** No target, or given up this round: play as normal. */
  Off,
  /** Normal play, batch trimmed by `coinTargetFitPaths`. */
  Play,
  /** Within `carefulCoins`: `coinTargetCarefulTurn` plays the turn. */
  Careful,
  /** At or past the target: coast to the round's end. */
  Done,
}

interface CoinTargetFlight {
  /** When its coins should be on the counter, epoch ms. */
  landAt: number;
  coins: number;
}

interface CoinTargetRound {
  /** When the round (and this state) began. */
  roundAt: number;
  /** The confirmed counter; 0 at the whistle. */
  value: number;
  /** When the read confirming `value` was taken. */
  valueAt: number;
  /** When `value` last changed. */
  steadySince: number;
  /** The last read and how many in a row agreed with it, since when; -1 for none. */
  pending: number;
  pendingCount: number;
  pendingSince: number;
  everRead: boolean;
  gaveUp: boolean;
  staleLogged: boolean;
  flights: CoinTargetFlight[];
  /** What is still wanted, as of the last step and the batch planned since. */
  need: number;
  /** Least allowance per bubble: `bubbleCoins`, raised by what pops measure. */
  bubbleCoins: number;
  /** A careful pop being measured: where, the counter before it, when it lands. */
  pop: Point | null;
  popBase: number;
  popLandAt: number;
  /** Spots where a pop paid nothing: a misread bubble, not tapped again. */
  deadBubbles: Point[];
  /** The skill activation being measured: the counter before it, chains since. */
  skillSeenAt: number;
  skillBase: number;
  skillChainCoins: number;
  /** When the last activation's choreography returned. */
  skillDoneAt: number;
  /** The largest activation measured this round. */
  skillPayMax: number;
  /** For moving flights back by a pause. */
  pauses: number;
  lastStepAt: number;
  carefulLogged: boolean;
}

function coinTargetFresh(): CoinTargetRound {
  const now = Date.now();
  return { roundAt: now, value: 0, valueAt: now, steadySince: now,
    pending: -1, pendingCount: 0, pendingSince: 0, everRead: false, gaveUp: false,
    staleLogged: false, flights: [], need: Infinity, bubbleCoins: CoinTargetConfig.bubbleCoins,
    pop: null, popBase: -1, popLandAt: 0, deadBubbles: [],
    skillSeenAt: 0, skillBase: -1, skillChainCoins: 0, skillDoneAt: 0, skillPayMax: 0,
    pauses: -1, lastStepAt: now, carefulLogged: false };
}

var gCoinTarget: CoinTargetRound = coinTargetFresh();

/** At each round's start: the counter is back at 0. */
function coinTargetReset(): void {
  gCoinTarget = coinTargetFresh();
}

function coinTargetOn(ts: Tsum): boolean {
  return ts.coinTarget > 0 && !gCoinTarget.gaveUp;
}

// --- Arithmetic ----------------------------------------------------------------

/** Coins a chain of `len` pays. */
function coinTargetCoins(len: number): number {
  if (len < CoinTargetChainCoins.length) {
    return CoinTargetChainCoins[Math.max(0, len)];
  }
  const last = CoinTargetChainCoins.length - 1;
  return CoinTargetChainCoins[last] + (len - last) * 12;
}

/** What one bubble is expected to pay: the tsums round it, at least the allowance. */
function coinTargetBubblePay(b: GameBubble): number {
  return Math.max(gCoinTarget.bubbleCoins,
    coinTargetCoins((b.near || 0) + CoinTargetConfig.bubbleSlackTsums));
}

/** Whether a pop at this spot already paid nothing. */
function coinTargetDeadBubble(b: Point): boolean {
  const r = CoinTargetConfig.deadBubbleRadius;
  return gCoinTarget.deadBubbles.some(function(d) {
    return (d.x - b.x) * (d.x - b.x) + (d.y - b.y) * (d.y - b.y) <= r * r;
  });
}

/** The scan's bubbles worth counting: those not marked dead. */
function coinTargetBubbles(ts: Tsum): GameBubble[] {
  return (ts.gameBubbles || []).filter(function(b) { return !coinTargetDeadBubble(b); });
}

/** What a chain of `len` costs against `need`: its coins, plus its bubble's. */
function coinTargetCost(len: number): number {
  return coinTargetCoins(len) + (len >= CoinTargetBubbleChain ? gCoinTarget.bubbleCoins : 0);
}

/** The longest chain up to `maxLen` costing no more than `budget`; 0 if none earns. */
function coinTargetFitLength(maxLen: number, budget: number): number {
  for (let len = maxLen; len >= 4; len--) {
    if (coinTargetCost(len) <= budget) {
      return len;
    }
  }
  return 0;
}

/** The first `len` tsums of `path`, keeping its colour and anchor. */
function coinTargetCut(path: TsumPath, len: number): TsumPath {
  if (len >= path.length) {
    return path;
  }
  const cut = path.slice(0, len) as TsumPath;
  cut.tsumIdx = path.tsumIdx;
  cut.startY = path.startY;
  return cut;
}

/** When a clear of `tsums` started now should be on the counter. */
function coinTargetLandAt(tsums: number): number {
  return Date.now() + BoardFluxConfig.popStartMs + tsums * BoardFluxConfig.popPerTsumMs
    + CoinTargetConfig.counterLagMs;
}

function coinTargetFly(coins: number, landAt: number): void {
  if (coins <= 0) {
    return;
  }
  gCoinTarget.flights.push({ landAt: landAt, coins: coins });
  if (gCoinTarget.skillBase >= 0) {
    gCoinTarget.skillChainCoins += coins;
  }
}

/** Whether a skill activation may still be paying out. */
function coinTargetSkillLanding(ts: Tsum): boolean {
  const last = Math.max(ts.skillFiredAt, gCoinTarget.skillDoneAt);
  return last > 0 && Date.now() - last < CoinTargetConfig.skillLandMs;
}

/** The `need` below which the skill waits. */
function coinTargetSkillHold(): number {
  return Math.max(CoinTargetConfig.skillHoldCoins,
    gCoinTarget.skillPayMax * CoinTargetConfig.skillHoldFactor);
}

/** Coins started but not yet on the confirmed counter. */
function coinTargetInFlight(ts: Tsum): number {
  const s = gCoinTarget;
  let sum = 0;
  for (let i = 0; i < s.flights.length; i++) {
    if (s.flights[i].landAt > s.valueAt) {
      sum += s.flights[i].coins;
    }
  }
  // An activation still paying: as much as the hold allows for.
  if (coinTargetSkillLanding(ts)) {
    sum += coinTargetSkillHold();
  }
  return sum;
}

// --- The counter ----------------------------------------------------------------

/** Take `v` as the counter, read now. */
function coinTargetConfirm(v: number): void {
  const s = gCoinTarget;
  const now = Date.now();
  if (v !== s.value) {
    s.steadySince = now;
  }
  s.value = v;
  s.valueAt = now;
  s.everRead = true;
  s.staleLogged = false;
  // Old flights only ever count against later reads; keep the list short.
  s.flights = s.flights.filter(function(f) { return f.landAt > now - 10000; });
  // A careful pop that has landed: what it paid sets the allowance, or marks
  // the spot dead when it paid nothing.
  if (s.popBase >= 0 && now > s.popLandAt) {
    const paid = v - s.popBase;
    if (paid <= 0 && s.pop !== null) {
      s.deadBubbles.push(s.pop);
    }
    s.bubbleCoins = Math.max(s.bubbleCoins, paid);
    s.popBase = -1;
    s.pop = null;
  }
}

/**
 * One read of the HUD counter. Two agreeing reads confirm a plausible value;
 * one the counter cannot hold -- lower than the last, or past what is in
 * flight could pay -- takes `implausibleReads` over `implausibleMs`.
 */
function coinTargetSample(ts: Tsum): void {
  const s = gCoinTarget;
  const fields = ts.readStatsNumbers(StatsRegions.liveCounters);
  // Coins are the last field: a game carrying medals draws them to the left.
  const v = fields === null ? -1 : fields[fields.length - 1];
  if (v < 0) {
    return;
  }
  const now = Date.now();
  if (v === s.pending) {
    s.pendingCount++;
  } else {
    s.pending = v;
    s.pendingCount = 1;
    s.pendingSince = now;
  }
  if (s.everRead && v === s.value) {
    coinTargetConfirm(v);
    return;
  }
  const ceiling = s.value + coinTargetInFlight(ts)
    + coinTargetBubbles(ts).reduce(function(sum, b) { return sum + coinTargetBubblePay(b); }, 0)
    + CoinTargetConfig.plausibleSlack;
  const plausible = !s.everRead || (v > s.value && v <= ceiling);
  if (plausible ? s.pendingCount >= 2
      : s.pendingCount >= CoinTargetConfig.implausibleReads
        && now - s.pendingSince >= CoinTargetConfig.implausibleMs) {
    if (!plausible) {
      logDebug(Log.Play.CoinTargetImplausible, { was: s.value, read: v, ceiling: ceiling });
    }
    coinTargetConfirm(v);
  }
}

// --- The play loop's hooks -------------------------------------------------------

/**
 * Called once a turn, after the scan: reads the counter and says which band
 * the round is in. Off without a target.
 */
function coinTargetStep(ts: Tsum): CoinStep {
  const s = gCoinTarget;
  if (!coinTargetOn(ts)) {
    return CoinStep.Off;
  }
  const now = Date.now();
  // A pause stops the game's clock but not ours: move the flights back by it.
  if (s.pauses >= 0 && ts.pauses !== s.pauses) {
    const shift = now - s.lastStepAt;
    s.flights.forEach(function(f) { f.landAt += shift; });
  }
  s.pauses = ts.pauses;
  s.lastStepAt = now;
  // A new activation: measure it from the counter as it stood.
  if (ts.skillFiredAt > s.skillSeenAt) {
    s.skillSeenAt = ts.skillFiredAt;
    s.skillBase = s.value;
    s.skillChainCoins = 0;
  }
  coinTargetSample(ts);
  // A new figure is confirmed by a second read now rather than next turn.
  if (s.pending >= 0 && s.pending !== s.value) {
    coinTargetSample(ts);
  }
  if (!s.everRead && now - s.roundAt >= CoinTargetConfig.giveUpMs) {
    s.gaveUp = true;
    logWarn(Log.Play.CoinTargetUnreadable, { target: ts.coinTarget,
      lastRead: s.pending });
    ts.banner('Coin counter unreadable: playing normally', 5000);
    return CoinStep.Off;
  }
  // An activation that has stopped paying: what it paid, less chains drawn since.
  if (s.skillBase >= 0 && !coinTargetSkillLanding(ts) && s.valueAt > ts.skillFiredAt) {
    const paid = s.value - s.skillBase - s.skillChainCoins;
    s.skillPayMax = Math.max(s.skillPayMax, paid);
    s.skillBase = -1;
    logDebug(Log.Play.CoinTargetSkillPaid, { paid: paid, hold: coinTargetSkillHold() });
  }
  if (s.value >= ts.coinTarget) {
    return CoinStep.Done;
  }
  const bubbles = coinTargetBubbles(ts);
  s.need = ts.coinTarget - s.value - coinTargetInFlight(ts)
    - bubbles.reduce(function(sum, b) { return sum + coinTargetBubblePay(b); }, 0);
  if (s.need > CoinTargetConfig.carefulCoins) {
    return CoinStep.Play;
  }
  if (!s.carefulLogged) {
    s.carefulLogged = true;
    logInfo(Log.Play.CoinTargetCareful, { target: ts.coinTarget, coins: s.value,
      need: s.need, bubbles: bubbles.length });
  }
  return CoinStep.Careful;
}

/** Whether the skill waits: the target is close enough for a burst to pass it. */
function coinTargetHoldsSkill(ts: Tsum): boolean {
  return coinTargetOn(ts) && gCoinTarget.need <= coinTargetSkillHold();
}

/** After a skill's activation (and its choreography) returns: it may still pay. */
function coinTargetSkillRan(ts: Tsum): void {
  if (coinTargetOn(ts)) {
    gCoinTarget.skillDoneAt = Date.now();
  }
}

/** Any bubble tap (`tapGameBubble`): its payout is in flight. */
function coinTargetNotePop(ts: Tsum, b: GameBubble): void {
  if (!coinTargetOn(ts)) {
    return;
  }
  const pay = coinTargetBubblePay(b);
  coinTargetFly(pay, coinTargetLandAt((b.near || 8) + CoinTargetConfig.bubbleSlackTsums));
  gCoinTarget.need -= pay;
}

/** A blind bubble sweep (`clearAllBubbles`): counted as a few bubbles. */
function coinTargetNoteSweep(ts: Tsum): void {
  if (!coinTargetOn(ts)) {
    return;
  }
  const pay = gCoinTarget.bubbleCoins * CoinTargetConfig.sweepBubbles;
  coinTargetFly(pay, coinTargetLandAt(12));
  gCoinTarget.need -= pay;
}

/**
 * The far and approach bands: the batch cut so its table value fits `need`.
 * A chain that does not fit is shortened to one that does, or dropped; chains
 * of three pay nothing and pass as they are. Records what it keeps as flights
 * and takes it off `need`, so the skill hold later this turn sees it.
 */
function coinTargetFitPaths(ts: Tsum, paths: TsumPath[]): TsumPath[] {
  if (!coinTargetOn(ts)) {
    return paths;
  }
  const s = gCoinTarget;
  const kept: TsumPath[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    let len = path.length;
    if (len >= 4 && coinTargetCost(len) > s.need) {
      len = coinTargetFitLength(len, s.need);
      if (len === 0) {
        continue;
      }
    }
    s.need -= coinTargetCost(len);
    kept.push(coinTargetCut(path, len));
  }
  // Drawn one after another, so each lands later than the last; the batch's
  // running length is a safe bound on when.
  let drawn = 0;
  for (let i = 0; i < kept.length; i++) {
    drawn += kept[i].length;
    coinTargetFly(coinTargetCoins(kept[i].length), coinTargetLandAt(drawn));
  }
  return kept;
}

/**
 * One careful turn. Waits for every flight to land on a fresh, steady read,
 * then pops one bubble (while its estimate still fits) or draws the chain
 * whose table value comes closest to what is left. `done` when nothing more
 * fits -- bubbles left on the board then pop after the timer.
 *
 * The bubble pop is an override of the Bubble Strategy, on purpose: a bubble
 * left on the board pops after the timer and pays where it cannot be counted.
 */
function coinTargetCarefulTurn(ts: Tsum, board: BoardPoint[]): { drawn: TsumPath | null, done: boolean } {
  const s = gCoinTarget;
  const now = Date.now();
  let landing = coinTargetSkillLanding(ts);
  for (let i = 0; i < s.flights.length && !landing; i++) {
    landing = s.flights[i].landAt > s.valueAt;
  }
  const stale = now - s.valueAt > CoinTargetConfig.staleMs;
  if (stale && !s.staleLogged) {
    s.staleLogged = true;
    logWarn(Log.Play.CoinTargetStale, { coins: s.value, sinceMs: now - s.valueAt });
  }
  if (landing || stale || now - s.steadySince < CoinTargetConfig.steadyMs) {
    ts.sleep(CoinTargetConfig.waitPollMs);
    return { drawn: null, done: false };
  }
  const left = ts.coinTarget - s.value;
  const bubbles = coinTargetBubbles(ts);
  // The bubble that pays least, if even that fits.
  let pick: GameBubble | null = null;
  for (let i = 0; i < bubbles.length; i++) {
    if (pick === null || coinTargetBubblePay(bubbles[i]) < coinTargetBubblePay(pick)) {
      pick = bubbles[i];
    }
  }
  if (pick !== null && coinTargetBubblePay(pick) <= left) {
    s.popBase = s.value;
    s.pop = { x: pick.x, y: pick.y };
    s.popLandAt = coinTargetLandAt((pick.near || 8) + CoinTargetConfig.bubbleSlackTsums);
    tapGameBubble(ts, pick);
    ts.gameBubbles = [];
    logDebug(Log.Play.CoinTargetPop, { coins: s.value, left: left,
      estimate: coinTargetBubblePay(pick) });
    return { drawn: null, done: false };
  }
  const budget = left - bubbles.reduce(function(sum, b) { return sum + coinTargetBubblePay(b); }, 0);
  if (budget < 1) {
    return { drawn: null, done: true };
  }
  // Uncapped: "Maximum Chain Number" would hold every chain under what fits.
  // A large tsum may count as several, so its paths are not trusted here.
  const paths = calculatePaths(board, ts.myTsumIdx, false, 0, false, skillLinkReach(ts));
  let best: TsumPath | null = null;
  let bestCoins = 0;
  for (let i = 0; i < paths.length; i++) {
    if (paths[i].some(function(p) { return p.grow !== undefined; })) {
      continue;
    }
    const len = coinTargetFitLength(paths[i].length, budget);
    const coins = coinTargetCoins(len);
    if (len > 0 && (coins > bestCoins || (coins === bestCoins && best !== null && len < best.length))) {
      best = coinTargetCut(paths[i], len);
      bestCoins = coins;
    }
  }
  if (best === null) {
    // No chain of four or more on this board: look again next turn.
    ts.sleep(CoinTargetConfig.waitPollMs);
    return { drawn: null, done: false };
  }
  ts.linkTsums(best);
  // Its bubble, if it makes one, is counted by the scan that sees it.
  coinTargetFly(bestCoins, coinTargetLandAt(best.length));
  logDebug(Log.Play.CoinTargetChain, { coins: s.value, left: left, chain: best.length,
    pays: bestCoins });
  return { drawn: best, done: false };
}

/** Whether a coast the target started should end: the target was raised or cleared. */
function coinTargetResumes(ts: Tsum): boolean {
  return ts.coinTarget <= 0 || ts.coinTarget > gCoinTarget.value;
}

/** Logged and bannered once the round stops earning. */
function coinTargetFinish(ts: Tsum): void {
  const s = gCoinTarget;
  const bubbles = coinTargetBubbles(ts).length;
  const outcome = s.value === ts.coinTarget ? 'reached'
    : s.value > ts.coinTarget ? 'over' : 'short';
  logInfo(Log.Play.CoinTargetReached, { target: ts.coinTarget, coins: s.value,
    outcome: outcome, bubbles: bubbles });
  ts.banner(outcome === 'reached' ? 'Coin target reached: ' + s.value
    : outcome === 'over' ? 'Coin target passed: ' + s.value + ' of ' + ts.coinTarget
    : 'Coin target: stopped at ' + s.value + ' of ' + ts.coinTarget
      + (bubbles > 0 ? ' (' + bubbles + ' bubbles left)' : ''), 5000);
}
