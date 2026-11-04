# Workflows: how Tsum runs them

A GAP Companion **workflow** is an ordered list of nodes (restart the game,
collect hearts, pick a skill, play N rounds, loop...) built on the phone and
assigned to a device. The binding contract, for every layer, is the host's
`../general-automation-app/docs/WORKFLOWS.md` (on its `companion-app` branch).
This document is what Tsum does with it.

## Who does what

| Part | File | Does |
|:--|:--|:--|
| Runner library | `src/gapWorkflow.ts` | Generic and vendored verbatim by other scripts: the catalog, the last sync, `gapWorkflowCheck`, the cursor `{loop, index}`, per-loop values (they cycle), `loop` / `stop`, `restartDevice` / `restartIfSlow`, resuming at a saved cursor, retries, state and events. References nothing else in this tree (the engine's `gapRestartDevice` / `gapPerf` only through `globalThis`, when present); `npm run typecheck:workflow` compiles it alone |
| Preset store | `src/gapPresets.ts` | Generic and vendored the same way: the device's own preset list, synced both ways with GAP Companion (below). `npm run typecheck:presets` compiles it alone |
| Tsum's half | `src/workflow.ts` | The node catalog and lists, each node's implementation, the Tsum List check, the run mode, the preset store's setup |
| Run mode | `src/index.ts` (`buildRun`), `src/runPlan.ts` (`workflowTaskTable`) | A workflow run registers the Workflow job instead of the chore table |
| Add-ons | not in this tree | GAP Companion may send private add-ons to the accounts that have them; they register through `src/addons.ts`, so their nodes come after the base's |
| Checks | `tools/workflowCheck/`, `tools/presetsCheck/` | `npm run workflow:check`, `npm run presets:check` |

## A workflow run

A remote start with a workflow reaches `gapRemoteStartRun` (src/companion.ts;
the adapter has already run `gapWorkflowCheck`), which calls
`startWorkflow(settings, refJson)`. That arms the ref and calls `start(settings)`:

1. `buildRun` takes the ref and clears it in the same call, so a refused
   (`busy`) start leaves nothing armed. The ref is never put in `Settings`, so
   `saveLastRunSettings` cannot replay it.
2. It forces **Auto launch on** (the run is unattended) and **Stop after games
   off** (`ts.stopAfterGames = 0`; the setting itself is untouched).
3. `gapWorkflowBegin` checks the workflow again and snapshots it. A refusal ends
   the workflow (`workflow.end`, status `terminated`) and the run, before any
   node runs. A ref with `at` (a resume after a device restart) starts there.
4. Only the **Workflow** job is registered (priority 90, every 3 s). The chore
   table is not: the workflow's order replaces the coded one. The Now one-shots
   (unlock, boxes, Tsum List) and Stop after this round still run, ahead of it.
5. Each pass of the job is one `gapWorkflowStep()`: at most one node call.
   `finished` stops the run; a run stopped from outside ends the workflow as
   `ended` / `stopped`, and one ended by a throw (`gRunErrored`, set in
   `start()`) as `failed` / `error`.

While it runs:
- `remoteSettingsApply` and `quickBarApply` refuse `stopAfterGames` with
  `why: 'workflow'` (`gapRemoteSet` answers `workflow-run`); `applyLiveSettings`
  skips it. `quickBarState` reports the page's own value, so neither page adopts
  the forced 0.
- The Send / Receive hearts switches add no job (`quickBarSyncJob`).
- Every node gets a banner and a log line (`workflow.*` events, `Log.Workflow`).
- `quickBarState()` adds `workflowStep` (`L2 3/5`: loop 2, step 3 of 5), which
  the Quick Bar shows in place of its Rounds row, and `workflow`, the whole line.

## The nodes

Node params override the run's settings for that node only, and are put back
afterwards. A chore node goes through one wrapper, one step per call:

1. `!ts.isRunning` (the run is stopping): `wait`.
2. A round is on (`quickBarInRound` or `roundInProgress`): finish it with
   `taskPlayGameQuick()` and answer `again`. The chore and any queued Now sweep
   only stand aside for it, and nothing else plays rounds here; checking it
   before step 3 is what keeps a sweep from deadlocking on the round.
3. `!ts.mayContinue()` (a Now sweep wants the screen): `wait`.
4. Call the chore method directly, once.
5. `ts.yieldAsked` (it handed back for a Now sweep): `again`; else `done`.

A node that fails is retried, then skipped after 3 tries (`workflow.nodeFailed`),
so the scheduler's five-throws restart can never loop.

| Node | Does |
|:--|:--|
| `restartApp` | Force-stops the build this device plays, launches it (`startTsumTsumApp`), waits for a known screen (`awaitAppUp`), then walks the startup screens to the friend list (`navigate(FriendPage)`) before the next node. Not `taskTsumAppRestart`, which needs Auto launch and ignores a live round. Fails with `app-not-up` |
| `tsum.receiveHearts` | `mode` `claimAll`: `taskReceiveAllItems`; `oneByOne`: `taskReceiveOneItem`. `skipRuby` / `skipMedals` set `keepRuby` / `skipMedals` for the call |
| `tsum.sendHearts` | `taskSendHearts` once. `toZeroScore` sets `sentToZero`; `maxRuntime` (minutes) sets `sendHeartMaxDuring` |
| `tsum.skill` | `preset:<id>`: the synced preset's round keys (`WorkflowPresetKeys`, the adapter's `presets.fields`) through `applyLiveSettings`; `skill:<id>`: `skillType`. Next-round keys land at the next whistle, as from the Quick Bar |
| `tsum.playRounds` | `taskPlayGameQuick` until `rounds` more rounds finished, counted by the change in `ts.runClock.rounds` (not the return value). Answers `wait` during the round delay or while a Now sweep waits, unless a round is already on the board. Detail: `N/M rounds`, or `playing round N of M` while one plays |
| `restartDevice`, `restartIfSlow` | The library, listed only when the engine has `gapRestartDevice` (below) |
| `loop`, `stop` | The library: `loop {times}` (0 = forever) restarts at the first node; `stop` ends the workflow. Running off the end is an implicit stop |

Option lists: `tsums` (below) and `skills`, every skill this build has a handler
for plus `nokill`, as `skill:<id>` with a readable name (`WorkflowSkillLabels`,
mirroring the adapter's SKILLS; the id for a skill missing there). `presets` is the phone's, from the account.

## Restarting the device

The library's own nodes, after the script's in the catalog (`…, restartDevice,
restartIfSlow, loop, stop`), offered only when the engine has `gapRestartDevice`.

- `restartDevice {minUptime?}` asks the engine for a restart
  (`gapRestartDevice`, reason `workflow`) with the **next** step as the resume
  cursor. Accepted: `workflow.restart` `restarting`, then the workflow ends as
  `ended` / `restart` and the run stops; the engine reboots and starts the run
  again with `at`.
- `restartIfSlow {over, fpsDrop?, captureRise?}` first asks `gapPerf` about the
  window `over`: `loop` (since this pass began; the previous pass when no
  script node has run yet in this one, e.g. the node is first in the loop),
  `run` (since the run began) or `recent` (the last 30 minutes). Not slow:
  `workflow.restart` `not-slow` (with `why` when nothing could be measured),
  next step. Slow: as `restartDevice`, reason `slow`. Missing params come from the
  device's `restart-rules.json`.
- A refusal (`restart-*`) is `workflow.restart` `skipped` with the `error`, and
  the workflow moves on. `restart-cooldown`, `restart-too-soon` and
  `restart-limit` are the device's limits at work; any other refusal also emits
  `workflow.nodeFailed` (never retried).
- Any outcome but a restart answers `wait`: the job rests its interval before
  the next step, so a loop of only these nodes cannot spin.
- **Resume**: `gapWorkflowBegin` with `at {loop, index}` starts there and emits
  `workflow.start` with `resumed`. An `at` past the last node (a restart that
  was the last step) emits a plain `workflow.start`, then ends as `end`.
- Banners: "Restarting the device", "Restart skipped: <error>", "Speed is fine;
  no restart" (or "Not enough speed data yet; no restart" / "No speed baseline
  yet; no restart" for `why` `not-enough-data` / `no-baseline`), "Workflow
  resumed: <name>, step N".

## The Tsum List file

A node param on the `tsums` list needs this device's list, where each tsum's
`order` is its card's position in the collection: `<device folder>/tsum_list_state.json` (`getDevicePath()`, which is per device),
`{at, build, tsums: [{order, tsum, name, favorite, skill}]}`. `skill` is the tsum's skill level (null when unread), which Auto Set Skill Level reads; a file from before it has none.

- The Export Tsum List chore writes it, overwriting, only when an export ends
  with reason `end of list`. A partial export (stopped, page limit, page turn
  failed) does not. The CSV beside it is unchanged, so the stats site reading it
  is unaffected.
- Keyed by the device id, not the CSV's `device` column: device names need not
  be unique, and a storage folder may be seen by more than one install. Nothing
  here assumes a particular emulator.
- `lists.tsums` comes only from it (labels: the full name as this build spells
  it); without it the catalog reports `null` and the phone shows "Needs Tsum
  List: Run Export Tsum List on the device".
- **The check** (`gapWorkflowCheck` and `gapWorkflowBegin`): a workflow with a
  node whose param is on the `tsums` list, on a device without the file → `tsum-list-missing`
  (banner "Run Export Tsum List first"); a chosen tsum, any per-loop value
  included, not in it → `tsum-not-in-list:<tsum>`.
- A node that finds the list out of date answers `{terminate: 'tsum-list-stale'}`
  (banner "Run Export Tsum List again").
- **Per device**: a param on the `tsums` list should be `perDevice`, so one
  workflow can pick a different Tsum on each device from that device's own list. The server sends
  each device only its own value; nothing here sees the others.

## Presets

One list per account and script: each device's own Presets (Settings page and
Quick Bar) is the account's list, and a save, rename or delete on any device or
the phone reaches the others. The server merges (the first change to reach it
wins; the other is kept as `<Name> (<device>)`); the device only tracks what
changed and takes what the server sends. The contract is GAP Companion's
`docs/WORKFLOWS.md`.

**The store** (`src/gapPresets.ts`) belongs to the engine world:
`<device folder>/presets-app.gap.Tsum.json` and its `.bak.json` twin, written in
turn so a kill mid-write leaves the other whole (`writeFile` truncates first). A
load takes the valid one with the higher `ver`; text in a file that neither
parses makes every global answer `store-unreadable`, and nothing is written over
it. `{instance, ver, scope, hash, presets: [{lid, name, values, id?, rev?,
prevRev?, dirty?, held?}], deleted: [{id, rev, name}]}`. A new store starts from
the old one-way mirror (`<script folder>/presets-<device id>.json`), entries
without ids. Names follow the contract's rule (whitespace collapsed, trimmed,
≤ 40, compared without case) and are unique.

**Pages** keep a localStorage cache and send ops (`src/presets.ts`), through
`runScriptCallback`:

| Global | Does |
|:--|:--|
| `gapPresetsRead(json)` | The list as pages show it, `{ok, instance, ver, presets}`; `{instance, ver}` still current answers `same: true` |
| `gapPresetsApply(json)` | `{ops}`, in order: `put {name, values, base}`, `rename {lid, name, base}`, `delete {lid, base}`, `seed {presets}`. `base` (`{lid, rev}` the page saw) lets an edit of an older copy reach the server as a conflict, and `prevRev` keeps our own adopted write from making the next edit one. A batch that changed anything bumps `ver`, is saved and emits `gap.presets {script}`; the answer adds one `{ok, lid?, error?}` per op (`full` past 32, held included; `name-taken`; `gone`), or is `{ok: false}` and the page says it was not saved |

A rename keeps the id, so workflow steps naming `preset:<id>` survive; so does a
delete followed by a save under the same name. The cache's marker
(`tsumtsumpresetsmark`, kept out of `gap-backup.json`) says which store it came
from: a list it does not match (a cache from before sync, a GAP Restore of an old
backup, a 5.0 session, which shares localStorage and the script id) is merged in
once by name as a `seed`. That can bring back a preset deleted since, or add a
`<Name> (<device>)` copy; nothing is lost. The old list is copied once to
`tsumtsumpresetslegacy`.

**GAP Companion's adapter** calls the standard globals: `gapPresetsStore()` (the
whole store), `gapPresetsAdopt(json)` (the account's merged list; refused as
`wrong-script` or `stale` when the store moved since it was read; lids the
server did not map are dropped only when named in `drop`, else kept as held) and
`gapPresetsLocal()` (`[{name, values}]`, for the one-way Import). Adopt emits
nothing. Held entries (the account had no room, or one too large to send) apply
like any other and stay on this device until the server takes them.

## Checks

`npm run workflow:check`; `npm run presets:check` (the store, its ops and adopt, the
pages' cache); `npm run dispatch:eval` (preset `workflow.json`: only the Workflow
job and the one-shots, Stop after this round first);
`npm run events:docs:check` for the `workflow.*` and `gap.presets` events.
