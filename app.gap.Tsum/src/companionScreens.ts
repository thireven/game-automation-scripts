// --- GAP Companion's screens, driven by this script ---------------------------
//
// What the phone shows for a Tsum device: its tabs, the Stats tab's cards, how
// each event reads, the summary's headline and the run bar's extra button. The
// adapter library checks it and ships it in the catalog, so phones have it even
// while the device is offline. Contract (UI 3): "Screens from the script" in the
// companion repo's cloud/adapters/README.md. Change it here; no phone or adapter
// release is needed.

/** Task names (`TaskName`, src/runPlan.ts, and the Now sweeps) as a person reads them. Add-ons add theirs. */
const CompanionTasks: { [task: string]: string } = {
  sendHearts: 'Sending hearts',
  receiveOneItem: 'Opening the mailbox',
  receiveItems: 'Receiving all gifts',
  taskTsumAppRestart: 'Restarting the Tsum app',
  taskClickAssist: 'Click Assist',
  autoUnlockLevel: 'Raising level caps',
  autoUnlockLevelNow: 'Raising level caps',
  buyBoxes: 'Buying boxes',
  buyBoxesNow: 'Buying boxes',
  exportTsumListNow: 'Exporting the Tsum list',
  buyOpenCapsuleNow: 'Buying the open capsule',
  wrapUpNow: 'Stopping after this round',
  taskWalkthrough: 'Recording a walkthrough',
  taskPlayGameQuick: 'Playing rounds',
};

const SKILL_FACT = { label: 'Skill', bind: 'data.skill', format: 'option:skillType', icon: 'skill' };
const BONUSES = ['Bonuses: {data.settings|trueKeys:bonus}', 'No bonus items'];
const NO_ROUNDS = 'Finished rounds show here.';
const ROUND_ROWS = { from: 'events', event: 'round.end' };

/** The Stats tab's My Tsum card; `gapScreens` fills its items, add-on parts included. */
const CompanionMyTsumCard = { card: 'My Tsum', icon: 'tsum', items: [] as unknown[] };

const CompanionScreens = {
  ui: 3,
  // quickBarState's myTsum is already the full name.
  summary: { headline: { label: 'My Tsum', bind: 'state.info.myTsum', icon: 'tsum', whenEmpty: 'Not identified yet' } },
  bar: [
    { action: 'wrapUp', when: '!state.flags.stopPending' },
    { action: 'cancelWrapUp', when: 'state.flags.stopPending' },
  ],
  barNote: [{ text: 'The run stops when this round ends.', when: 'state.flags.stopPending' }],
  tabs: [
    { id: 'stats', label: 'Stats', items: [
      CompanionMyTsumCard,
      { slot: 'totals' },
      { card: 'This run', icon: 'play', items: [
        { stats: [
          { label: 'Rounds', bind: 'state.readouts.rounds', unit: 'count', icon: 'rounds' },
          { label: 'Run time', bind: 'state.readouts.runSec', unit: 'sec', icon: 'time' },
          { label: 'Time in rounds', bind: 'state.readouts.playedSec', unit: 'sec', icon: 'played' },
          { label: 'Avg round', bind: 'state.readouts.avgRoundSec', unit: 'sec', icon: 'avgTime' },
          { label: 'Avg coins (base)', bind: 'state.readouts.baseCoinAvg', unit: 'coins', icon: 'coins' },
          { label: 'Avg coins (final)', bind: 'state.readouts.finalCoinAvg', unit: 'coins', icon: 'coins' },
          { label: 'Medals', bind: 'state.readouts.medals', unit: 'medals', icon: 'medal' },
        ] },
        { when: 'state.readouts.restRemainingSec', stats: [
          { label: 'Rest left', bind: 'state.readouts.restRemainingSec', unit: 'sec', icon: 'rest' },
        ] },
      ] },
      { card: 'Coins per round', icon: 'coins', items: [
        { chart: { type: 'column', rows: { ...ROUND_ROWS, limit: 20 }, empty: NO_ROUNDS, series: [
          { label: 'Coins', bind: 'data.finalCoins', color: 'coins' },
          { label: 'Base', bind: 'data.baseCoins', color: 'muted' },
        ] } },
      ] },
      { card: 'Recent rounds', icon: 'rounds', items: [
        { table: { rows: { ...ROUND_ROWS, limit: 10 }, empty: NO_ROUNDS, columns: [
          { label: 'Round', bind: 'data.round', format: 'int' },
          { label: 'Time', bind: 'data.seconds', format: 'clock', icon: 'time' },
          { label: 'Base', bind: 'data.baseCoins', format: 'number' },
          { label: 'Coins', bind: 'data.finalCoins', format: 'number', icon: 'coins', bold: true },
        ] } },
      ] },
    ] },
    { id: 'settings', label: 'Settings', items: [{ slot: 'settings' }] },
    { id: 'events', label: 'Events', items: [{ slot: 'events' }] },
  ],
  // Event shapes: EVENTS.md. The first template that fills in wins.
  events: {
    'run.started': { title: 'Run started', kind: 'start', facts: [
      SKILL_FACT,
      { label: 'Script version', bind: 'data.version', icon: 'version' },
    ] },
    'run.stopped': { title: 'Run stopped', kind: 'stop', facts: [
      { label: 'Rounds played', bind: 'data.rounds', format: 'number', icon: 'rounds' },
    ] },
    'task.start': { title: ['{data.task|map:tasks}', 'Next task'] },
    'round.start': {
      title: ['Round {data.round} started', 'Round started'],
      short: ['Playing {data.myTsumName} · Round {data.round}', 'Playing {data.myTsumName}', 'Playing'],
      facts: [SKILL_FACT, { label: 'My Tsum', bind: 'data.myTsumName', icon: 'tsum' }],
      note: BONUSES,
    },
    'round.over': {
      title: ["Round {data.round}: time's up", "Time's up"],
      facts: [{ label: 'Played', bind: 'data.seconds', format: 'clock', icon: 'time' }],
      note: 'Counting coins…',
    },
    'round.end': {
      title: ['Round {data.round}: {data.finalCoins|number} coins', 'Round {data.round} finished', 'Round finished'],
      kind: 'result',
      facts: [
        { label: 'Base coins', bind: 'data.baseCoins', format: 'number', icon: 'coins' },
        { label: 'Score', bind: 'data.score', format: 'number', icon: 'score' },
        { label: 'Time', bind: 'data.seconds', format: 'clock', icon: 'time' },
        { label: 'Medals', bind: 'data.medals', format: 'number', icon: 'medal' },
        SKILL_FACT,
      ],
      note: BONUSES,
    },
  },
  maps: { tasks: CompanionTasks },
};

/** The Stats tab's My Tsum card items: the base fact, then any add-on facts and buttons. */
function companionMyTsumCard(): unknown[] {
  return [
    { facts: [{ label: 'My Tsum', bind: 'state.info.myTsum', icon: 'tsum' }, ...gAddonMyTsumCard.facts] },
    ...gAddonMyTsumCard.buttons,
  ];
}

/**
 * The phone's screens as JSON. A standard global the companion adapter
 * library looks for (UI contract 3). Built per call, so an add-on that
 * registered after load is included.
 */
// noinspection JSUnusedGlobalSymbols
function gapScreens(): string {
  CompanionMyTsumCard.items = companionMyTsumCard();
  CompanionScreens.maps.tasks = Object.assign({}, CompanionTasks, gAddonTaskLabels);
  return JSON.stringify(CompanionScreens);
}
