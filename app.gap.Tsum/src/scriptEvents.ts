// The emitted event vocabulary: every name this script broadcasts, once.
//
// Separate from `Log` (src/logEvents.ts) on purpose. A log line is for a person
// reading a run afterwards; an emitted event is an *interface* another program
// reacts to as the run happens -- an OBS recorder starting on `round.start` and
// stopping on `round.end`. Renaming a log event costs a grep; renaming one of
// these breaks somebody's tooling.
//
// A `const enum` per component inside a namespace that is erased with them, the
// same shape as `Log`: the bundle carries the bare string and nothing else, and
// what it buys is one definition to jump to, find references on and rename.
//
// The host defines none of these names and reads none of the payloads -- see
// `../general-automation-app/docs/EVENTS.md`. What each one carries is EVENTS.md,
// which is generated from the call sites by `npm run events:docs`, so adding an
// event here and emitting it is the whole of the work.
namespace Emit {
  /** One start()..stop(). */
  export const enum Run {
    /** A run has been asked for and its world is about to be built. */
    Started = 'run.started',
    /** The run's world has been dismantled; nothing is playing. */
    Stopped = 'run.stopped',
  }

  /** The task loop's jobs. */
  export const enum Task {
    /**
     * The loop has switched to another job (`TaskName`, src/runPlan.ts, or a
     * Now sweep's name): sending hearts, the mailbox, playing rounds. Emitted
     * only when the job differs from the last one, so back-to-back rounds say
     * it once. The companion app shows it as what the device is doing.
     */
    Started = 'task.start',
  }

  /**
   * One played round.
   *
   * Three events rather than two because the interesting moment is not the same
   * as the obvious one: `Over` is the board ending, `End` is the score tally
   * having finished and the figures being readable. A recorder that stops on
   * `Over` cuts the tally off.
   */
  export const enum Round {
    /**
     * The pre-round screen is up with the bonus items set, and Start is about to
     * be tapped. **The signal to start recording** -- emitted here rather than on
     * the board so a recording opens on the items the round is being played with;
     * the board follows a few seconds later.
     * `id` is the round's own, repeated by every other `round.*` event of that
     * round -- which is how a consumer several emulators dial into tells one
     * round's events from another's, where `round` counts a single device's
     * rounds and starts at 1 on each. It is also the CSV row's id. `settings` is
     * what the round is being played under: the gameplay settings the stats CSV
     * records as columns, as the settings object holds them.
     */
    Start = 'round.start',
    /** The board is finished and the score tally is beginning. */
    Over  = 'round.over',
    /**
     * The tally is done and the figures have been read. **The signal to stop
     * recording**, and the only event carrying the round's numbers. `settings`
     * repeats what `round.start` said, so this one event stands on its own.
     */
    End   = 'round.end',
  }

  /**
   * A GAP Companion workflow (the app repo's docs/WORKFLOWS.md § 8). Emitted by
   * the runner library (src/gapWorkflow.ts) through the hook src/workflow.ts
   * sets, so the call sites carry these strings rather than the members.
   */
  export const enum Workflow {
    /**
     * A workflow passed its check and its first node is next. `resumed`
     * (`{loop, index}`) when it carries on after a device restart.
     */
    Start      = 'workflow.start',
    /** A node's first call in this pass (not repeated for again, wait or a retry). */
    Node       = 'workflow.node',
    /** Pass `loop` (2 or more) begins at the first node. */
    Loop       = 'workflow.loop',
    /** A node failed its last try and was skipped. */
    NodeFailed = 'workflow.nodeFailed',
    /** The workflow is over: `status` is ended, failed or terminated, `reason` why. */
    End        = 'workflow.end',
    /**
     * A `restartDevice` / `restartIfSlow` step: `outcome` is restarting, skipped
     * (`error` says why) or not-slow; `why`, `fps`, `captureMs` from the speed check.
     */
    Restart    = 'workflow.restart',
  }

  /**
   * GAP Companion's push channel (the app repo's cloud/adapters/README.md §
   * Notifications). The server turns it into a notification on the phones of
   * the device's account and keeps it out of the event history; `gap.*` names
   * are the platform's. Sent only by `gapNotify` and `gapDirectEmit` (src/companion.ts).
   */
  export const enum Companion {
    /** A notification: title, body, category, tag, lines, progress, actions. */
    Notify = 'gap.notify',
    /**
     * A user direction request's state (`waiting`, `working`, `closed`), sent by
     * the director add-on. The server takes the screenshot and asks the phones.
     */
    Direct = 'gap.direct',
  }
}
