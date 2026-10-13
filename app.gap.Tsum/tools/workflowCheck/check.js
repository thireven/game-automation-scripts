#!/usr/bin/env node
// Checks the GAP Companion workflow runner (src/gapWorkflow.ts) and Tsum's
// check hook (src/workflow.ts) by driving the built bundle in a vm.
//
//   npm run workflow:check
//
// The contract is the app repo's docs/WORKFLOWS.md. Each case below receives a
// sync, begins the workflow and steps it until it finishes, with test nodes
// registered into the real library and the events captured off its hook. No
// game node runs: those need a device.
//
// Cases: per-loop values cycle; `loop {times}`; `stop`; running off the end
// (implicit stop) and the empty workflow; retries then skip; `terminate`; the
// check's refusals in its documented order; Tsum's Tsum List check; the presets
// mirror round trip.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRuntime } = require('../runtime/load');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-workflow-check-'));
const { ctx } = createRuntime({ quiet: true, storagePath: storage, build: process.argv.indexOf('--no-build') < 0 });
const run = (code) => vm.runInContext(code, ctx);

let failures = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    return;
  }
  failures++;
  console.log('FAIL ' + name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

// What the test nodes saw, and what the library emitted.
let calls = [];
let events = [];
ctx.gapWorkflowSetHooks({
  emit: (event, data) => { events.push({ event, data: JSON.parse(JSON.stringify(data)) }); },
  check: (workflow, presets) => ctx.workflowTsumCheck(workflow, presets),
});

// test.record: records its `value` param and is done.
ctx.gapWorkflowDefineNode({
  type: 'test.record', label: 'Record', params: [
    { key: 'value', label: 'Value', type: 'enum', perLoop: true,
      options: ['a', 'b', 'c', 'after', 'never'].map((v) => ({ value: v, label: v })) },
  ],
  run: (c) => { calls.push({ value: c.params.value, loop: c.loop, index: c.index }); return 'done'; },
});
// test.fail: fails every try.
ctx.gapWorkflowDefineNode({
  type: 'test.fail', label: 'Fail', params: [],
  run: (c) => { calls.push({ fail: c.tries }); return { fail: 'boom' }; },
});
// test.throw: throws, which counts as a fail.
ctx.gapWorkflowDefineNode({
  type: 'test.throw', label: 'Throw', params: [],
  run: () => { throw new Error('thrown'); },
});
// test.terminate: ends the whole workflow.
ctx.gapWorkflowDefineNode({
  type: 'test.terminate', label: 'Terminate', params: [],
  run: () => ({ terminate: 'stop-everything' }),
});
// test.twice: answers `again` once, then `wait`, then done.
let twice = 0;
ctx.gapWorkflowDefineNode({
  type: 'test.twice', label: 'Twice', params: [],
  run: () => { twice++; return twice === 1 ? 'again' : twice === 2 ? 'wait' : 'done'; },
});
// test.int: an int param with a range and a step.
ctx.gapWorkflowDefineNode({
  type: 'test.int', label: 'Int', params: [
    { key: 'n', label: 'N', type: 'int', min: 1, max: 9, step: 2 },
    { key: 'use', label: 'Use', type: 'enum', lists: ['presets', 'skills'], optional: true },
  ],
  run: () => 'done',
});

let rev = 0;
function receive(nodes, presets) {
  rev++;
  const workflow = nodes === null ? null : { id: 'wf_check', rev, name: 'check', nodes };
  return JSON.parse(ctx.gapWorkflowReceive(JSON.stringify({ hash: 'h' + rev, presets: presets || [], workflow })));
}
const ref = () => JSON.stringify({ id: 'wf_check', rev });
const node = (id, type, params) => ({ id, type, params: params || {} });

/** Begins the received workflow and steps it to the end. */
function runToEnd(limit) {
  calls = [];
  events = [];
  twice = 0;
  const refused = ctx.gapWorkflowBegin(ref());
  const answers = [];
  if (refused === null) {
    for (let i = 0; i < (limit || 200); i++) {
      const answer = ctx.gapWorkflowStep();
      answers.push(answer);
      if (answer === 'finished') break;
    }
  }
  return { refused, answers, state: JSON.parse(ctx.gapWorkflowState()), names: events.map((e) => e.event) };
}
const endOf = () => {
  const end = events.filter((e) => e.event === 'workflow.end');
  return end.length === 1 ? end[0].data : { count: end.length };
};

// --- cycling and loop times ---------------------------------------------------
receive([
  node('n1', 'test.record', { value: { perLoop: ['a', 'b'] } }),
  node('n2', 'loop', { times: 5 }),
  node('n3', 'test.record', { value: 'after' }),
]);
let r = runToEnd();
check('cycle: values wrap round the loops',
  JSON.stringify(calls.map((c) => c.value)) === JSON.stringify(['a', 'b', 'a', 'b', 'a', 'after']),
  calls.map((c) => c.value));
check('cycle: loop numbers 1..5', JSON.stringify(calls.slice(0, 5).map((c) => c.loop)) === '[1,2,3,4,5]', calls);
check('cycle: four workflow.loop events, from pass 2',
  JSON.stringify(events.filter((e) => e.event === 'workflow.loop').map((e) => e.data.loop)) === '[2,3,4,5]',
  events);
check('loop times: ends off the end as `end`', endOf().status === 'ended' && endOf().reason === 'end', endOf());
check('state: ended with reason', r.state.status === 'ended' && r.state.reason === 'end' && r.state.total === 3, r.state);
check('events: start first, end last', r.names[0] === 'workflow.start' && r.names[r.names.length - 1] === 'workflow.end', r.names);

// --- loop forever is bounded only by the step limit ---------------------------
receive([node('n1', 'test.record', { value: 'a' }), node('n2', 'loop', {})]);
r = runToEnd(30);
check('loop forever: still running after many steps', r.state.status === 'running' && calls.length >= 10, r.state);
ctx.gapWorkflowAbort('stopped');
check('abort: stopped run ends as `ended`/`stopped`',
  JSON.parse(ctx.gapWorkflowState()).status === 'ended' && endOf().reason === 'stopped', endOf());

// --- stop -----------------------------------------------------------------------
receive([node('n1', 'test.record', { value: 'a' }), node('n2', 'stop'), node('n3', 'test.record', { value: 'never' })]);
r = runToEnd();
check('stop: nodes after it never run', calls.length === 1 && calls[0].value === 'a', calls);
check('stop: reason `stop`', endOf().reason === 'stop' && endOf().status === 'ended', endOf());

// --- implicit stop, and the empty workflow ---------------------------------------
receive([node('n1', 'test.record', { value: 'c' })]);
r = runToEnd();
check('implicit stop: reason `end`', endOf().reason === 'end' && calls.length === 1, endOf());
receive([]);
r = runToEnd();
check('empty workflow: ends at once', r.answers.length === 1 && r.answers[0] === 'finished' && endOf().reason === 'end',
  r.answers);
check('empty workflow: node is null', r.state.node === null && r.state.nodeId === null, r.state);

// --- again / wait, retries then skip, throw, terminate -----------------------------
receive([node('n1', 'test.twice')]);
r = runToEnd();
check('again then wait: answers continue, wait, continue',
  JSON.stringify(r.answers.slice(0, 3)) === '["continue","wait","continue"]', r.answers);
check('again/wait: one workflow.node', r.names.filter((n) => n === 'workflow.node').length === 1, r.names);

receive([node('n1', 'test.fail'), node('n2', 'test.record', { value: 'after' })]);
r = runToEnd();
check('fail: tried 3 times', JSON.stringify(calls.filter((c) => c.fail).map((c) => c.fail)) === '[1,2,3]', calls);
const failed = events.filter((e) => e.event === 'workflow.nodeFailed');
check('fail: one nodeFailed, then the next node runs',
  failed.length === 1 && failed[0].data.tries === 3 && failed[0].data.error === 'boom'
  && calls[calls.length - 1].value === 'after', events);

receive([node('n1', 'test.throw')]);
r = runToEnd();
const thrown = events.filter((e) => e.event === 'workflow.nodeFailed');
check('throw: counts as a fail with its message', thrown.length === 1 && thrown[0].data.error === 'thrown', thrown);

receive([node('n1', 'test.terminate'), node('n2', 'test.record', { value: 'never' })]);
r = runToEnd();
check('terminate: whole workflow ends', endOf().status === 'terminated' && endOf().reason === 'stop-everything'
  && calls.length === 0, endOf());

// --- the check, in its documented order ------------------------------------------
const checkOf = () => JSON.parse(ctx.gapWorkflowCheck(ref()));
receive(null);
check('check: nothing assigned is no-workflow', checkOf().error === 'no-workflow', checkOf());
receive([node('n1', 'test.record', { value: 'a' })]);
check('check: other rev is workflow-stale',
  JSON.parse(ctx.gapWorkflowCheck(JSON.stringify({ id: 'wf_check', rev: rev + 1 }))).error === 'workflow-stale');
check('check: other id is workflow-stale',
  JSON.parse(ctx.gapWorkflowCheck(JSON.stringify({ id: 'wf_other', rev }))).error === 'workflow-stale');
check('check: a good workflow passes', checkOf().ok === true, checkOf());
receive([node('n1', 'zz.nope'), node('n2', 'aa.nope'), node('n3', 'zz.nope')]);
check('check: unknown types, sorted and unique', checkOf().error === 'workflow-unsupported:aa.nope,zz.nope', checkOf());
receive([node('n1', 'test.record')]);
check('check: required param missing', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.int', { n: { perLoop: [1, 3] } })]);
check('check: perLoop where not allowed', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.record', { value: { perLoop: Array(21).fill('a') } })]);
check('check: more than 20 per-loop values', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.record', { value: 'zzz' })]);
check('check: enum value not in options', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.int', { n: 4 })]);
check('check: int off step', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.int', { n: 11 })]);
check('check: int out of range', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'test.int', { n: 3, use: 'preset:ps_missing' })]);
check('check: unsynced preset is no-preset', checkOf().error === 'no-preset', checkOf());
receive([node('n1', 'test.int', { n: 3, use: 'preset:ps_a' })], [{ id: 'ps_a', name: 'A', values: { skillLevel: 3 } }]);
check('check: synced preset passes', checkOf().ok === true, checkOf());
receive([node('n1', 'test.int', { n: 3, use: 'skill:burst' })]);
check('check: a skill from the skills list passes', checkOf().ok === true, checkOf());
receive([node('n1', 'test.int', { n: 3, use: 'skill:not_a_skill' })]);
check('check: a skill not in the list', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'zz.nope')]);
r = runToEnd();
check('begin: a refused workflow is terminated with the code, before any node',
  r.refused === 'workflow-unsupported:zz.nope' && r.state.status === 'terminated'
  && r.names.join() === 'workflow.end', r);
check('receive: bad payload is bad-sync', JSON.parse(ctx.gapWorkflowReceive('{"presets":[]}')).error === 'bad-sync');

// --- Tsum's Tsum List check ---------------------------------------------------------
const listFile = path.join(storage, 'tsum_record', 'tsum_list_' + ctx.getDeviceId() + '.json');
fs.rmSync(listFile, { force: true });
// The check (workflowTsumCheck) applies to any param on the `tsums` list.
ctx.gapWorkflowDefineNode({
  type: 'test.pickTsum', label: 'Pick Tsum (test)',
  params: [{ key: 'pick', label: 'Tsum', type: 'enum', lists: ['tsums'], perLoop: true }],
  run: () => 'done',
});
const pickTsum = (pick) => node('s1', 'test.pickTsum', { pick });
receive([pickTsum({ perLoop: ['arielplus', 'goofyplus'] })]);
check('tsum list: missing file', checkOf().error === 'tsum-list-missing', checkOf());
check('tsum list: catalog lists.tsums is null', JSON.parse(ctx.gapWorkflowCatalog()).lists.tsums === null);
r = runToEnd();
check('tsum list: missing file terminates before any node',
  r.refused === 'tsum-list-missing' && endOf().status === 'terminated', endOf());
fs.mkdirSync(path.dirname(listFile), { recursive: true });
fs.writeFileSync(listFile, JSON.stringify({ at: '2026-10-04T00:00:00.000Z', build: 'global', tsums: [
  { order: 1, tsum: 'arielplus', name: 'Ariel+' }, { order: 2, tsum: '', name: '' },
  { order: 3, tsum: 'mickey', name: 'Mickey' }] }));
check('tsum list: a per-loop value not in it', checkOf().error === 'tsum-not-in-list:goofyplus', checkOf());
receive([pickTsum({ perLoop: ['arielplus', 'mickey'] })]);
check('tsum list: every value in it passes', checkOf().ok === true, checkOf());
const tsums = JSON.parse(ctx.gapWorkflowCatalog()).lists.tsums;
check('tsum list: catalog lists the named rows by full name',
  JSON.stringify(tsums) === JSON.stringify([{ value: 'arielplus', label: 'Ariel+' }, { value: 'mickey', label: 'Mickey' }]),
  tsums);

// --- Tsum's workflow run mode (buildRun) ----------------------------------------------
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dispatchEval', 'presets', 'base.json'), 'utf8'));
const settings = Object.assign({}, base.settings, { stopAfterGames: 5, autoLaunchApp: false });
function buildWorkflowRun() {
  run('gWorkflowArmed = ' + JSON.stringify(ref()));
  ctx.buildRun(JSON.parse(JSON.stringify(settings)), ctx.logStringsFor('en-US'));
  const out = {
    armed: run('gWorkflowArmed'), mode: run('gWorkflowRun'),
    tasks: run('gTaskController === undefined ? "" : Object.keys(gTaskController.tasks).join()'),
    stopping: run('gStopRequested'), autoLaunch: ctx.ts.autoLaunch, stopAfterGames: ctx.ts.stopAfterGames,
    applied: JSON.parse(ctx.quickBarApply('stopAfterGames', 3)), state: JSON.parse(ctx.quickBarState()),
  };
  ctx.endRun();
  out.after = run('gWorkflowRun');
  return out;
}
receive([pickTsum('mickey'), node('n2', 'tsum.playRounds', { rounds: 2 })]);
let built = buildWorkflowRun();
check('mode: the armed ref is taken and cleared', built.armed === null && built.mode === true, built);
check('mode: only the Workflow job is registered', built.tasks === 'workflow', built.tasks);
check('mode: Auto launch forced on, Stop after games forced off',
  built.autoLaunch === true && built.stopAfterGames === 0, built);
check('mode: stopAfterGames refused with why workflow', built.applied.why === 'workflow', built.applied);
check('mode: Quick Bar reports progress', typeof built.state.workflowStep === 'string'
  && built.state.workflowStep === 'L1 1/2', built.state);
check('mode: endRun clears it', built.after === false);
fs.rmSync(listFile, { force: true });
built = buildWorkflowRun();
check('mode: a refused workflow registers nothing and stops', built.tasks === '' && built.stopping === true, built);

// --- the catalog's shape --------------------------------------------------------------
const catalog = JSON.parse(ctx.gapWorkflowCatalog());
const tsumTypes = catalog.nodes.map((n) => n.type).filter((t) => t.indexOf('test.') !== 0);
check('catalog: api 1', catalog.api === 1, catalog.api);
check('catalog: Tsum nodes in contract order', JSON.stringify(tsumTypes) === JSON.stringify(['restartApp',
  'tsum.receiveHearts', 'tsum.sendHearts', 'tsum.skill', 'tsum.playRounds', 'loop', 'stop']), tsumTypes);
check('catalog: no presets list (reserved)', catalog.lists.presets === undefined);
check('catalog: listInfo for tsums', catalog.listInfo && catalog.listInfo.tsums.label === 'Tsum List', catalog.listInfo);
check('catalog: skills include nokill', catalog.lists.skills.some((s) => s.value === 'skill:nokill'));

// --- presets mirror ----------------------------------------------------------------------
ctx.getScriptPath = () => storage;
ctx.presetsMirror(JSON.stringify([{ name: 'A', values: { skillLevel: 3, bad: { x: 1 } } }, { nope: 1 }]));
check('presets mirror: round trip keeps scalar values only',
  ctx.presetsLocal() === JSON.stringify([{ name: 'A', values: { skillLevel: 3 } }]), ctx.presetsLocal());
fs.rmSync(path.join(storage, 'presets-' + ctx.getDeviceId() + '.json'), { force: true });
check('presets mirror: missing file is []', ctx.presetsLocal() === '[]');

// --- review fixes -------------------------------------------------------------------
// A stale rev is reported under the rev that was started, not the synced one.
receive([node('n1', 'test.record', { value: 'a' })]);
events = [];
const staleRef = JSON.stringify({ id: 'wf_check', rev: rev + 1 });
check('begin: stale rev refused as workflow-stale', ctx.gapWorkflowBegin(staleRef) === 'workflow-stale');
check('begin: stale rev keeps the started rev in state and end',
  JSON.parse(ctx.gapWorkflowState()).rev === rev + 1 && endOf().rev === rev + 1, endOf());

// A throwing emit hook neither stalls nor ends the runner.
ctx.gapWorkflowSetHooks({ emit: () => { throw new Error('host down'); },
  check: (workflow, presets) => ctx.workflowTsumCheck(workflow, presets) });
receive([node('n1', 'test.record', { value: 'a' }), node('n2', 'test.record', { value: 'b' })]);
r = runToEnd();
check('emit throws: the workflow still runs to its end',
  r.refused === null && calls.length === 2 && r.state.status === 'ended' && r.state.reason === 'end', r);
ctx.gapWorkflowSetHooks({
  emit: (event, data) => { events.push({ event, data: JSON.parse(JSON.stringify(data)) }); },
  check: (workflow, presets) => ctx.workflowTsumCheck(workflow, presets),
});

// A run that ended by a throw ends the workflow as failed/error.
receive([node('n1', 'test.record', { value: 'a' })]);
events = [];
ctx.gapWorkflowBegin(ref());
run('gWorkflowRun = true; gRunErrored = true; workflowRunEnded(); gRunErrored = false;');
check('run error: workflow ends failed/error', endOf().status === 'failed' && endOf().reason === 'error', endOf());

// Skills are listed by readable name.
const skills = JSON.parse(ctx.gapWorkflowCatalog()).lists.skills;
const burst = skills.filter((s) => s.value === 'skill:burst')[0];
const noSkill = skills.filter((s) => s.value === 'skill:nokill')[0];
check('catalog: skills carry readable labels', burst && burst.label === 'Burst' && noSkill.label === 'No skill', skills);

// The Skill node applies only a preset's round keys.
function nodeRun(type) {
  return run('WorkflowTsumNodes').filter((n) => n.type === type)[0].run;
}
const nodeCtx = (params) => ({ params, loop: 1, index: 0, tries: 1, setDetail: () => {} });
receive([node('n1', 'test.record', { value: 'a' })],
  [{ id: 'ps_x', name: 'X', values: { skillLevel: 4, trackRoundStats: false, maxRoundMinutes: 1,
    stopAfterGames: 2 } }]);
ctx.gapWorkflowBegin(ref());
let applied = null;
const realApply = run('applyLiveSettings');
ctx.applyLiveSettings = (values) => { applied = values; return 'applied'; };
const skillAnswer = nodeRun('tsum.skill')(nodeCtx({ use: 'preset:ps_x' }));
ctx.applyLiveSettings = realApply;
check('skill node: preset limited to round keys', skillAnswer === 'done'
  && JSON.stringify(applied) === '{"skillLevel":4}', applied);
ctx.gapWorkflowAbort('stopped');

// A chore node with a round on the board and a Now sweep queued finishes the
// round instead of waiting on the sweep (which waits on the round).
let played = 0;
let choreRan = 0;
const realBoard = run('roundInProgress');
ctx.roundInProgress = () => true;
ctx.ts = { isRunning: true, yieldAsked: true, mayContinue: () => false, openingRound: false,
  roundStartedAt: 0, keepRuby: false, skipMedals: false,
  taskPlayGameQuick: () => { played++; }, taskReceiveAllItems: () => { choreRan++; } };
const chore = nodeRun('tsum.receiveHearts');
let choreAnswer = chore(nodeCtx({ mode: 'claimAll' }));
check('chore: board up + sweep queued plays the round', choreAnswer === 'again' && played === 1
  && choreRan === 0, { choreAnswer, played, choreRan });
ctx.roundInProgress = () => false;
choreAnswer = chore(nodeCtx({ mode: 'claimAll' }));
check('chore: board gone, sweep still queued waits', choreAnswer === 'wait' && choreRan === 0, choreAnswer);
ctx.ts.isRunning = false;
ctx.roundInProgress = () => true;
choreAnswer = chore(nodeCtx({ mode: 'claimAll' }));
check('chore: a stopping run waits, even mid-round', choreAnswer === 'wait' && played === 1, choreAnswer);
ctx.ts = undefined;
ctx.roundInProgress = realBoard;

fs.rmSync(storage, { recursive: true, force: true });
console.log('workflow:check: ' + passed + ' passed, ' + failures + ' failed');
process.exit(failures === 0 ? 0 : 1);
