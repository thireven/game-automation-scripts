// The trace stream: live debug data for a dev tool on the PC.
//
// The host carries `emitTrace(kind, data)` to whoever is connected to its trace
// port (21026, `gap-events.js --trace`). Nothing here is built unless someone is,
// so an unwatched run pays one host call a second. `LOGGING.md` § The trace
// stream; the host side is `../general-automation-app/docs/EVENTS.md`.

namespace Trace {
  /** Every `kind` this script traces. A consumer filters on these. */
  export const enum Kind {
    /** Every log record, debug included, whatever the Debug logs setting says. */
    Log = 'log',
    /** One board read: each tsum's cluster and centre, the cluster colours, the bubbles. */
    BoardScan = 'board.scan',
    /** The chains a batch is about to draw, as tsum centres. */
    BoardPaths = 'board.paths',
    /** Points and boxes a chore found, in screen pixels, to draw over a frame. */
    Marks = 'marks',
  }
  // The host adds `frame.square` / `frame.screen` (every capture, as a JPEG)
  // and `input.tap|down|move|up|key|type` (every touch it sends) by itself.
}

/** How long a `traceAttached()` answer is trusted. */
const TraceCheckMs = 1000;
var gTraceOn = false;
var gTraceCheckedAt = 0;

/** Whether a trace consumer is attached. Asks the host at most once a second. */
function traceOn(): boolean {
  const now = Date.now();
  if (now - gTraceCheckedAt >= TraceCheckMs || now < gTraceCheckedAt) {
    gTraceCheckedAt = now;
    gTraceOn = typeof traceAttached === 'function' && traceAttached();
  }
  return gTraceOn;
}

/**
 * Asks for the next capture to be sent as a frame, whatever the host's rate
 * limit says. Free with no viewer attached. Pair with `traceFrameOf`.
 */
function traceFrameAsk(): void {
  if (traceOn() && typeof traceWantFrame === 'function') {
    traceWantFrame();
  }
}

/** Id of the frame sent for the latest capture; 0 when it was not sent. */
function traceFrameOf(): number {
  return gTraceOn && typeof traceFrameId === 'function' ? traceFrameId() : 0;
}

/** One thing a chore found, in real screen pixels (what `tap` takes). */
type TraceMark = { x: number; y: number; r?: number; w?: number; h?: number; t?: string };

/**
 * Draws `marks` over the latest frame in a trace viewer: a circle (`r`) or box
 * (`w`, `h`) at x, y with an optional label `t`. `build` runs only when watched.
 * Use `Tsum.toRealXY` to convert from the 1080-wide space most chores use.
 */
function traceMarks(label: string, build: () => TraceMark[]): void {
  traceSend(Trace.Kind.Marks, function() {
    return { label: label, frame: traceFrameOf(), marks: build() };
  });
}

/** Sends one trace if someone is watching; `build` runs only then. */
function traceSend(kind: Trace.Kind, build: () => unknown): void {
  if (!traceOn()) {
    return;
  }
  try {
    emitTrace(kind, build());
  } catch (e) {
    // A trace must never end a run. Logged as a warning, which is traced too.
    logWarn(Log.Log.TraceFailed, 'A trace could not be built', { kind: kind, errorText: '' + e });
  }
}
