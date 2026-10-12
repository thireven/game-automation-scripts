# Workflows: how Tsum runs them

A GAP Companion **workflow** is an ordered list of nodes (restart the game,
collect hearts, pick a skill, play N rounds, loop...) built on the phone and
assigned to a device. The binding contract, for every layer, is the host's
`../general-automation-app/docs/WORKFLOWS.md` (on its `companion-app` branch).
This document is what Tsum does with it.

## Who does what

| Part | File | Does |
|:--|:--|:--|
| Runner library | `src/gapWorkflow.ts` | Generic and vendored verbatim by other scripts: the catalog, the last sync, `gapWorkflowCheck`, the cursor `{loop, index}`, per-loop values (they cycle), `loop` / `stop`, retries, state and events. References nothing else in this tree; `npm run typecheck:workflow` compiles it alone |
| Tsum's half | `src/workflow.ts` | The node catalog and lists, each node's implementation, the Tsum List check, the run mode, the presets mirror |
| Run mode | `src/index.ts` (`buildRun`), `src/runPlan.ts` (`workflowTaskTable`) | A workflow run registers the Workflow job instead of the chore table |
| Add-ons | not in this tree | GAP Companion may send private add-ons to the accounts that have them; they register through `src/addons.ts`, so their nodes come after the base's |
| Checks | `tools/workflowCheck/` | `npm run workflow:check` |

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
   node runs.
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
| `loop`, `stop` | The library: `loop {times}` (0 = forever) restarts at the first node; `stop` ends the workflow. Running off the end is an implicit stop |

Option lists: `tsums` (below) and `skills`, every skill this build has a handler
for plus `nokill`, as `skill:<id>` with a readable name (`WorkflowSkillLabels`,
mirroring the adapter's SKILLS; the id for a skill missing there). `presets` is the phone's, from the account.

## The Tsum List file

A node param on the `tsums` list needs this device's list, where each tsum's
`order` is its card's position in the collection: `<device folder>/tsum_list_state.json` (`getDevicePath()`, which is per device),
`{at, build, tsums: [{order, tsum, name, favorite}]}`.

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

## The presets mirror

The presets live in each page's WebView localStorage, out of the engine's reach.
On every save (`presetsStore`) and as each page opens, the page calls
`presetsMirror(json)` (through `runScriptCallback`: a `runScript` would count as
a run on the host), which writes `<script folder>/presets-<device id>.json`.
`gapPresetsLocal()` reads it back for GAP Companion's Import from device.

## Checks

`npm run workflow:check`; `npm run dispatch:eval` (preset `workflow.json`: only the Workflow
job and the one-shots, Stop after this round first);
`npm run events:docs:check` for the `workflow.*` events.
