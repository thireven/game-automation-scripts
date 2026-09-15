// ---------------------------------------------------------------------------
// Fever time: reading it, and telling everyone when it turns over.
//
// ## Why it is not a page
//
// Everything else the script recognises is a screen: it arrives, it is
// fingerprinted, something reacts, it leaves. A fever is not that. It is a
// *mode* the board is in -- the same GamePlaying screen with the lights turned
// down and the gauge at the bottom turned into a glowing timer -- so it has no
// `PageName`, it does not displace whatever else is on screen, and the play
// loop keeps running straight through it.
//
// That is also why the state cannot be read off the page router's verdict. The
// table does carry a `GamePlayingFever` entry, but its `variant` is
// documentation and tooling by contract (see `PageDef` in globals.d.ts) -- the
// script only ever learns the page *name*. So the mode is read here instead,
// from the same `FeverProbes` that entry is built from, and the two answers
// come from one list of pixels rather than two.
//
// ## What this file gives you
//
//   ts.isFeverTime()      one look, no memory: is a fever running right now.
//                         Pass a frame you already hold and it costs nothing
//                         but the probe read.
//   ts.feverRemainingMs() one look at the fever bar's fill: how long this
//                         fever has left. Same frame rule as above.
//   ts.feverLook()        both of those off one frame -- what the watcher
//                         samples, and what a screenless harness stubs.
//   gFever.active         the debounced answer, as of the last reading, plus
//                         when it started (`since`, `elapsedMs()`).
//   gFever.remainingMs()  the bar as last read, run forward by the clock; and
//                         `endsWithin(ms)`, the question the bubble hold asks.
//   gFever.subscribe()    a handler called once when a fever starts and once
//                         when it ends -- the broadcast the rest of the script
//                         reacts to, in the shape `gPages.subscribe` already
//                         uses: unique ids, one at a time, and a subscriber
//                         that throws does not cost the others their turn.
//
// Readings arrive from `record.feverTime` in pageHandlers.ts, which feeds
// `update()` every time the router looks at the screen. That is what makes the
// events fire on their own during a round without anything else calling in.
// The bar is read off that same capture, so knowing how long a fever has left
// costs no capture of its own.
// ---------------------------------------------------------------------------

/**
 * Consecutive readings that have to agree before the state flips.
 *
 * A fever runs for seconds, so one late reading costs nothing; a single wrong
 * one costs a pair of spurious events. This is the guard against a reading
 * that was *taken* and came back wrong -- a probe caught mid-transition, the
 * ring drawn a frame late. The other failure, a frame the router could not
 * read at all, is not debounced here at all: see `FeverUnknownHoldMs`, which
 * refuses it as evidence rather than counting it as two.
 */
const FeverConfirmSamples = 2;

/**
 * Shortest gap between two captures taken to read the fever state, in ms.
 *
 * The play loop asks the router what is on screen once per scan, which can be
 * several times a second, and each reading here is a capture of its own. A
 * fever lasts several seconds and its edges only have to be caught within one
 * `FeverConfirmSamples` window, so most of those looks buy nothing.
 */
const FeverSampleGapMs = 300;

/**
 * How long an unreadable screen may hold the fever state up, in ms.
 *
 * `update` is fed whatever the router matched, and mid-round "nothing matched"
 * is an ordinary frame rather than a rare one: a burst skill's full-screen
 * animation and the level-up banner both cover the HUD, so the board stops
 * fingerprinting for a second or more while a fever underneath it runs on. A
 * fever is *not* one of those any more -- `GamePlayingHudProbes` were measured
 * on the six fever frames and move by at most 12 against a 40 threshold, so a
 * plain fever still reads as `GamePlaying` -- which is exactly what makes an
 * `Unknown` mid-round mean an overlay on top of one.
 *
 * Taking that at face value would end and restart a running fever in a pair of
 * spurious events, and `FeverConfirmSamples` is no defence: the play loop asks
 * several times a second, so two disagreeing readings arrive in well under the
 * animation's own length. So an `Unknown` is treated as *no reading* rather
 * than as "no fever" -- the same refusal `inRoundPages()` makes in the play loop,
 * for the same reason (`OBSCURED_BOARD.md`).
 *
 * The window is bounded because "no reading" cannot be allowed to mean forever:
 * an app that went away, a screen the table has never had an entry for, and the
 * state would sit `active` with nothing left to correct it. Past this, an
 * unreadable screen is ordinary evidence again -- so one that stays unreadable
 * ends a fever `FeverConfirmSamples` readings later, a little over a window
 * after the board was last seen. Measured from the last frame the router could
 * read, so a screen flickering between the board and an animation keeps
 * holding, and one that goes and stays dark does not.
 */
const FeverUnknownHoldMs = 2000;

/**
 * The fever state, and who to tell when it changes.
 *
 * One per script run, like `gPages`. Deliberately not a `Tsum` field: the
 * subscriptions have to be registrable at load time, before any `Tsum` exists.
 */
class FeverWatcher {
  /** Whether a fever is running, as of the last confirmed reading. */
  active: boolean;
  /** When the current state began; 0 before the first reading. */
  since: number;
  /** When the last reading that counted was taken -- capture or not. */
  seenAt: number;

  subscriptions: FeverSubscriptionEntry[];

  /** The reading that disagrees with `active`, and how many of it there were. */
  private pending: boolean;
  private pendingCount: number;
  /** When the last reading that cost a capture was taken. */
  private capturedAt: number;
  /**
   * The fever bar as last read: how long was left, and when that was read.
   * `barReadAt` is 0 until a running fever's bar has been read, and again once
   * the fever ends. Kept through the debounce tail rather than cleared on the
   * first reading that says "no fever", so the hold and `active` agree.
   */
  private barRemainingMs: number;
  private barReadAt: number;
  /**
   * When a page the router could read was last seen -- the board or anything
   * else. What `FeverUnknownHoldMs` is measured from, so that a screen which
   * stays unreadable stops holding the state up one window after the last
   * frame that said anything, rather than one window after the last frame that
   * was ignored.
   */
  private readableAt: number;
  private nextIndex: number;
  /** Set while subscribers are running, so one that reads back cannot recurse. */
  private notifying: boolean;

  constructor() {
    this.active = false;
    this.since = 0;
    this.seenAt = 0;
    this.subscriptions = [];
    this.pending = false;
    this.pendingCount = 0;
    this.capturedAt = 0;
    this.barRemainingMs = 0;
    this.barReadAt = 0;
    this.readableAt = 0;
    this.nextIndex = 0;
    this.notifying = false;
  }

  // --- subscriptions -------------------------------------------------------

  /**
   * Register a reaction to a fever starting or ending.
   *
   * `id` is the handle: it has to be unique, and a second registration under
   * the same one replaces the first rather than running twice -- which is what
   * a reloaded script would otherwise do.
   */
  subscribe(sub: FeverSubscription): FeverSubscriptionEntry {
    const entry: FeverSubscriptionEntry = {
      id: sub.id,
      what: sub.what,
      handler: sub.handler,
      index: this.nextIndex++
    };
    for (let i = 0; i < this.subscriptions.length; i++) {
      if (this.subscriptions[i].id === entry.id) {
        entry.index = this.subscriptions[i].index;
        this.subscriptions[i] = entry;
        return entry;
      }
    }
    this.subscriptions.push(entry);
    return entry;
  }

  unsubscribe(id: string): boolean {
    for (let i = 0; i < this.subscriptions.length; i++) {
      if (this.subscriptions[i].id === id) {
        this.subscriptions.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // --- state ---------------------------------------------------------------

  /** How long the current state has been up, in ms. */
  elapsedMs(): number {
    return this.since === 0 ? 0 : Date.now() - this.since;
  }

  /**
   * How long the running fever has left, in ms: the bar as last read, less the
   * time since. 0 when no fever is running or its bar has not been read yet,
   * and never negative -- a fever the debounce has not yet called over reads
   * as "ending now".
   */
  remainingMs(): number {
    if (!this.active || this.barReadAt === 0) {
      return 0;
    }
    return Math.max(0, this.barRemainingMs - (Date.now() - this.barReadAt));
  }

  /**
   * Is a fever running and due to end within `ms`? The bubble hold's
   * question. False with no fever running, or before its bar has been read --
   * a fever whose length is unknown is not one to hoard bubbles for.
   */
  endsWithin(ms: number): boolean {
    return this.active && this.barReadAt !== 0 && this.remainingMs() <= ms;
  }

  /**
   * Feed the router's verdict, taking a reading when one is due.
   *
   * The only entry point that captures anything, and the one
   * `record.feverTime` calls. Three answers, not two:
   *
   *   GamePlaying   the board is up, so read it -- at most once per
   *                 `FeverSampleGapMs`, since each reading is a capture.
   *   Unknown       nothing fingerprinted, which mid-round is an animation
   *                 over the board rather than the board being gone. Not a
   *                 reading at all for `FeverUnknownHoldMs`; see there.
   *   anything else a real screen that is not the board, so whatever was
   *                 running is over. Free -- no capture is taken.
   */
  update(tsum: Tsum, page: PageName): boolean {
    if (page === PageName.Unknown && Date.now() - this.readableAt < FeverUnknownHoldMs) {
      // Deliberately touches nothing: not `readableAt`, which is what bounds
      // this window, and not `pending`, so a start or an end that was building
      // survives the animation that interrupted it.
      return this.active;
    }
    if (page !== PageName.GamePlaying) {
      return this.observe(tsum, false, page);
    }
    const now = Date.now();
    if (now - this.capturedAt < FeverSampleGapMs) {
      return this.active;
    }
    this.capturedAt = now;
    // One capture for both reads, owned by the Tsum side so a harness with no
    // screen can stand in for it (`tools/dispatchEval/fake.js`).
    const look = tsum.feverLook();
    if (look.active) {
      this.barRemainingMs = look.remainingMs;
      this.barReadAt = now;
    }
    return this.observe(tsum, look.active, page);
  }

  /**
   * Take one reading as given, and broadcast the transition it settles.
   *
   * For a caller that has already looked -- anything holding a frame can pass
   * `ts.isFeverTime(img)` here and pay no capture at all.
   */
  observe(tsum: Tsum, active: boolean, page: PageName): boolean {
    const now = Date.now();
    this.seenAt = now;
    if (page !== PageName.Unknown) {
      this.readableAt = now;
    }
    if (active === this.active) {
      // The state held, so whatever was building against it was noise.
      this.pendingCount = 0;
      if (this.since === 0) {
        this.since = now;
      }
      return this.active;
    }
    if (this.pending !== active) {
      this.pending = active;
      this.pendingCount = 0;
    }
    this.pendingCount++;
    if (this.pendingCount < FeverConfirmSamples) {
      return this.active;
    }
    const lasted = this.since === 0 ? 0 : now - this.since;
    this.active = active;
    this.since = now;
    this.pendingCount = 0;
    if (!active) {
      // The fever is over, so its bar says nothing about the next one.
      this.barReadAt = 0;
    }
    this.broadcast(tsum, {
      active: active,
      at: now,
      lastedMs: lasted,
      page: page,
      ts: tsum
    });
    return this.active;
  }

  /**
   * Forget the state without telling anyone.
   *
   * For a caller that knows the readings either side of it are unrelated -- a
   * new round, an app restart. A fever that was running is *not* broadcast as
   * ended, because it did not end: the screen it was on stopped existing.
   */
  reset(): void {
    this.active = false;
    this.since = 0;
    this.seenAt = 0;
    this.pendingCount = 0;
    this.capturedAt = 0;
    this.barRemainingMs = 0;
    this.barReadAt = 0;
    this.readableAt = 0;
  }

  private broadcast(tsum: Tsum, event: FeverEvent): void {
    if (this.notifying) {
      return;
    }
    this.notifying = true;
    try {
      for (let i = 0; i < this.subscriptions.length; i++) {
        const sub = this.subscriptions[i];
        if (!tsum.isRunning) {
          break;
        }
        try {
          sub.handler.call(tsum, event);
        } catch (e) {
          // One broken subscriber must not cost the others their turn, nor take
          // down the task that happened to be the one holding the screen.
          logError(Log.Fever.SubscriptionThrew, 'Fever subscription threw',
            { subscription: sub.id, errorText: '' + e });
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

/**
 * The watcher. One per script run, created at load time so that subscriptions
 * can register into it as the bundle evaluates -- `gPages` exists for the same
 * reason and in the same shape.
 */
var gFever = new FeverWatcher();

/**
 * Is a fever running on this frame?
 *
 * One look, no memory and no events: every probe in `FeverProbes` has to hold.
 * Pass an image to read the frame you already have -- the page handlers do not,
 * because the router releases its own frame before the queue runs, but anything
 * that took a screenshot for its own reasons should.
 */
Tsum.prototype.isFeverTime = function(img) {
  const own = img === undefined;
  const frame = own ? this.screenshot() : img;
  try {
    // One crossing for the whole list, as everywhere else a table of probes is
    // read off one frame.
    const samples = this.getColors(frame, FeverProbes);
    for (let i = 0; i < FeverProbes.length; i++) {
      const probe = FeverProbes[i];
      if ((absColor(probe, samples[i]) < probe.threshold) !== probe.match) {
        return false;
      }
    }
    return true;
  } finally {
    if (own) {
      releaseImage(frame);
    }
  }
};

/**
 * Where along the fever bar each `FeverBar.samples` reading is taken: the
 * middle of each equal slice of the fill, left to right. Built once, since the
 * table it is built from never changes.
 */
const FeverBarPoints: Point[] = (function() {
  const pts: Point[] = [];
  const step = (FeverBar.xEnd - FeverBar.xStart) / FeverBar.samples;
  for (let i = 0; i < FeverBar.samples; i++) {
    pts.push({x: Math.round(FeverBar.xStart + (i + 0.5) * step), y: FeverBar.y});
  }
  return pts;
})();

/**
 * How long the fever on this frame has left, in ms, off the bar's fill.
 *
 * The fill drains from the right, so the answer is the run of lit samples from
 * the left, each worth one slice of `FeverBar.durationMs`. Resolution is one
 * slice (500ms at 20 samples); `gFever.remainingMs()` runs it forward by the
 * clock between reads. Says nothing about whether a fever is running -- ask
 * `isFeverTime` first, since the ordinary gauge fills the same pixels yellow
 * and a full one reads as a full fever. Same frame rule as `isFeverTime`:
 * pass one you hold, or one is captured.
 */
Tsum.prototype.feverRemainingMs = function(img) {
  const own = img === undefined;
  const frame = own ? this.screenshot() : img;
  try {
    const samples = this.getColors(frame, FeverBarPoints);
    let lit = 0;
    while (lit < samples.length) {
      const c = samples[lit];
      if (Math.max(c.r, c.g, c.b) < FeverBar.litValue) {
        break;
      }
      lit++;
    }
    return Math.round(lit * FeverBar.durationMs / FeverBar.samples);
  } finally {
    if (own) {
      releaseImage(frame);
    }
  }
};

/**
 * Both reads off one frame: is a fever running, and if so how long it has
 * left. What the watcher takes each sample from. The bar is read only when
 * the frame says a fever is on it: off a fever the same pixels are the
 * ordinary gauge, whose fill says nothing about a fever's clock.
 */
Tsum.prototype.feverLook = function(img) {
  const own = img === undefined;
  const frame = own ? this.screenshot() : img;
  try {
    const active = this.isFeverTime(frame);
    return { active: active, remainingMs: active ? this.feverRemainingMs(frame) : 0 };
  } finally {
    if (own) {
      releaseImage(frame);
    }
  }
};

// This file ships with no subscription of its own. A fever start/end log line
// was tried and taken out again: the transition is detected too inconsistently
// for one, and a line that lies about a mode is worse than no line. Everything
// that wants to know -- a skill holding its activation, a statistic -- registers
// its own next to wherever it lives.
