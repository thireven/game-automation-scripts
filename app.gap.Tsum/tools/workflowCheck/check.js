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
// mirror round trip; the add-on hooks (src/addons.ts) with a test add-on, the
// director and user direction (gapDirect, requestUserDirection, the unknown
// screen, the stall guard starting over); the
// restart nodes (`restartDevice`, `restartIfSlow`) against the host shim's
// stubbed natives, and resuming at a saved cursor (`at`).

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRuntime } = require('../runtime/load');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-workflow-check-'));
const { ctx, host } = createRuntime({ quiet: true, storagePath: storage, build: process.argv.indexOf('--no-build') < 0 });
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
const ref = (at) => JSON.stringify(at === undefined ? { id: 'wf_check', rev } : { id: 'wf_check', rev, at });
const node = (id, type, params) => ({ id, type, params: params || {} });

/** Begins the received workflow (at `at` when given) and steps it to the end. */
function runToEnd(limit, at) {
  calls = [];
  events = [];
  twice = 0;
  const refused = ctx.gapWorkflowBegin(ref(at));
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

// --- the catalog's shape --------------------------------------------------------------
const catalog = JSON.parse(ctx.gapWorkflowCatalog());
const tsumTypes = catalog.nodes.map((n) => n.type).filter((t) => t.indexOf('test.') !== 0);
check('catalog: api 1', catalog.api === 1, catalog.api);
check('catalog: Tsum nodes in contract order', JSON.stringify(tsumTypes) === JSON.stringify(['restartApp',
  'tsum.receiveHearts', 'tsum.sendHearts', 'tsum.skill', 'tsum.playRounds',
  'restartDevice', 'restartIfSlow', 'loop', 'stop']), tsumTypes);
const restartDef = catalog.nodes.filter((n) => n.type === 'restartDevice')[0];
const slowDef = catalog.nodes.filter((n) => n.type === 'restartIfSlow')[0];
check('catalog: restart nodes labelled, no group', restartDef.label === 'Restart device'
  && slowDef.label === 'Restart if slow' && restartDef.group === undefined, [restartDef, slowDef]);
check('catalog: restartIfSlow params', slowDef.params.map((p) => p.key).join() === 'over,fpsDrop,captureRise'
  && slowDef.params[0].options.map((o) => o.value).join() === 'loop,run,recent', slowDef.params);
check('catalog: no presets list (reserved)', catalog.lists.presets === undefined);
check('catalog: listInfo for tsums', catalog.listInfo && catalog.listInfo.tsums.label === 'Tsum List', catalog.listInfo);
check('catalog: skills include nokill', catalog.lists.skills.some((s) => s.value === 'skill:nokill'));

// --- device restart: the restart nodes and resuming --------------------------------
const realRestart = ctx.gapRestartDevice;
const realPerf = ctx.gapPerf;
const restartEvents = () => events.filter((e) => e.event === 'workflow.restart').map((e) => e.data);
const failedEvents = () => events.filter((e) => e.event === 'workflow.nodeFailed').map((e) => e.data);
function withoutNatives(body) {
  delete ctx.gapRestartDevice;
  delete ctx.gapPerf;
  try {
    return body();
  } finally {
    ctx.gapRestartDevice = realRestart;
    ctx.gapPerf = realPerf;
  }
}
const resetRestart = (answer, perfAnswer) => {
  host.restart.calls.length = 0;
  host.restart.perfCalls.length = 0;
  host.restart.answer = answer;
  host.restart.perfAnswer = perfAnswer || { ok: true, slow: false, why: 'not-enough-data', fps: null,
    captureMs: null, minutes: 0, base: null };
};

const plainTypes = withoutNatives(() => JSON.parse(ctx.gapWorkflowCatalog()).nodes.map((n) => n.type)
  .filter((t) => t.indexOf('test.') !== 0));
check('restart: without the native, not in the catalog', JSON.stringify(plainTypes) === JSON.stringify([
  'restartApp', 'tsum.receiveHearts', 'tsum.sendHearts', 'tsum.skill', 'tsum.playRounds', 'loop', 'stop']),
plainTypes);
receive([node('n1', 'restartDevice')]);
check('restart: without the native, a workflow with it is unsupported',
  withoutNatives(() => checkOf().error) === 'workflow-unsupported:restartDevice');
check('restart: with the native, it passes the check', checkOf().ok === true, checkOf());
for (const reserved of ['restartDevice', 'restartIfSlow', 'loop', 'stop']) {
  let threw = false;
  try {
    ctx.gapWorkflowDefineNode({ type: reserved, label: 'X', params: [], run: () => 'done' });
  } catch (e) {
    threw = true;
  }
  check('restart: ' + reserved + ' is reserved', threw);
}
receive([node('n1', 'restartDevice', { minUptime: 20 })]);
check('restart: minUptime off its step is refused', checkOf().error === 'bad-workflow:n1', checkOf());
receive([node('n1', 'restartIfSlow', { over: 'week' })]);
check('restart: unknown `over` is refused', checkOf().error === 'bad-workflow:n1', checkOf());

// Accepted: ends as `restart`, saving the next step as the resume cursor.
resetRestart({ ok: true, comesBack: 'boot' });
receive([node('n1', 'test.record', { value: 'a' }), node('n2', 'restartDevice', { minUptime: 30 }),
  node('n3', 'test.record', { value: 'never' })]);
r = runToEnd();
check('restartDevice: ends the workflow as ended/restart', endOf().status === 'ended'
  && endOf().reason === 'restart' && r.state.reason === 'restart', endOf());
check('restartDevice: nodes after it do not run here', calls.length === 1 && calls[0].value === 'a', calls);
const restartCall = host.restart.calls[0];
check('restartDevice: asks with the next step as `at`', host.restart.calls.length === 1
  && restartCall.reason === 'workflow' && restartCall.minUptimeMin === 30
  && JSON.stringify(restartCall.workflow) === JSON.stringify({ id: 'wf_check', rev, at: { loop: 1, index: 2 } }),
restartCall);
check('restartDevice: one workflow.restart, restarting',
  JSON.stringify(restartEvents()) === JSON.stringify([{ id: 'wf_check', nodeId: 'n2', index: 1, loop: 1,
    outcome: 'restarting' }]), restartEvents());
check('restartDevice: the run is told to finish', r.answers[r.answers.length - 1] === 'finished', r.answers);

// Refused by the device's limits: skipped, not a failed step.
resetRestart({ ok: false, error: 'restart-cooldown' });
receive([node('n1', 'restartDevice'), node('n2', 'test.record', { value: 'after' })]);
r = runToEnd();
check('restartDevice: a cooldown refusal skips to the next step', calls.length === 1 && calls[0].value === 'after'
  && endOf().reason === 'end', { calls, end: endOf() });
check('restartDevice: the refusal is reported, not failed', restartEvents().length === 1
  && restartEvents()[0].outcome === 'skipped' && restartEvents()[0].error === 'restart-cooldown'
  && failedEvents().length === 0, events);
check('restartDevice: no minUptime param sends none', host.restart.calls[0].minUptimeMin === undefined,
  host.restart.calls[0]);
check('restartDevice: after a refusal the job rests', r.answers[0] === 'wait', r.answers);

// A loop of only restart nodes rests on every refusal instead of spinning.
resetRestart({ ok: false, error: 'restart-cooldown' });
receive([node('n1', 'restartDevice'), node('n2', 'loop', { times: 0 })]);
r = runToEnd(6);
check('restartDevice: a refused restart-only loop alternates wait and continue',
  JSON.stringify(r.answers) === JSON.stringify(['wait', 'continue', 'wait', 'continue', 'wait', 'continue']),
  r.answers);
ctx.gapWorkflowAbort('stopped');

// Refused for another reason: skipped and a failed step, without retries.
resetRestart({ ok: false, error: 'restart-no-return' });
receive([node('n1', 'restartDevice'), node('n2', 'test.record', { value: 'after' })]);
r = runToEnd();
check('restartDevice: other refusals fail the step once and move on', host.restart.calls.length === 1
  && failedEvents().length === 1 && failedEvents()[0].error === 'restart-no-return'
  && calls.length === 1 && calls[0].value === 'after', { failed: failedEvents(), calls });

// A native that throws or answers garbage is restart-failed.
ctx.gapRestartDevice = () => 'not json';
receive([node('n1', 'restartDevice')]);
r = runToEnd();
ctx.gapRestartDevice = realRestart;
check('restartDevice: a garbage answer is restart-failed', restartEvents()[0].error === 'restart-failed'
  && endOf().reason === 'end', restartEvents());

// restartIfSlow, not slow: moves on without asking for a restart.
resetRestart({ ok: true, comesBack: 'host' }, { ok: true, slow: false, why: null, fps: 30, captureMs: 12,
  minutes: 9, base: { fps: 31, captureMs: 11, at: 1 } });
receive([node('n1', 'restartIfSlow', { fpsDrop: 50 }), node('n2', 'test.record', { value: 'after' })]);
r = runToEnd();
check('restartIfSlow: not slow moves on', host.restart.calls.length === 0 && calls.length === 1
  && endOf().reason === 'end', { calls: host.restart.calls, end: endOf() });
check('restartIfSlow: not slow rests before the next step', r.answers[0] === 'wait', r.answers);
check('restartIfSlow: not-slow event carries the speed',
  JSON.stringify(restartEvents()) === JSON.stringify([{ id: 'wf_check', nodeId: 'n1', index: 0, loop: 1,
    outcome: 'not-slow', fps: 30, captureMs: 12 }]), restartEvents());
check('restartIfSlow: param overrides go to gapPerf', host.restart.perfCalls[0].fpsDropPct === 50
  && host.restart.perfCalls[0].captureRisePct === undefined, host.restart.perfCalls[0]);

// The `over` windows: this loop (the default), this run, the last 30 minutes.
resetRestart({ ok: true }, { ok: true, slow: false, why: 'not-enough-data', fps: null, captureMs: null,
  minutes: 0, base: null });
receive([node('n0', 'test.record', { value: 'a' }), node('n1', 'restartIfSlow', { over: 'run' }),
  node('n2', 'restartIfSlow'), node('n3', 'restartIfSlow', { over: 'recent' }), node('n4', 'loop', { times: 2 })]);
run('var gapCheckNow = Date.now; var gapCheckClock = Date.now(); Date.now = function() { return gapCheckClock; };');
try {
  calls = [];
  events = [];
  ctx.gapWorkflowBegin(ref());
  const t0 = run('gapCheckClock');
  for (let i = 0; i < 4; i++) ctx.gapWorkflowStep();     // loop 1: work, run, loop, recent
  run('gapCheckClock += 60000');
  for (let i = 0; i < 4; i++) ctx.gapWorkflowStep();     // the loop node, then loop 2: work, run, loop
  const since = host.restart.perfCalls.map((c) => c.sinceMs);
  check('restartIfSlow: `run` and `loop` start at the run start in loop 1',
    since[0] === t0 && since[1] === t0, since);
  check('restartIfSlow: `recent` is the last 30 minutes', since[2] === t0 - 30 * 60000, since);
  check('restartIfSlow: in loop 2, `run` keeps the run start and `loop` the loop start',
    since[3] === t0 && since[4] === t0 + 60000, since);
  ctx.gapWorkflowAbort('stopped');

  // First in the loop, `loop` measures the previous pass: this one has done nothing yet.
  receive([node('n1', 'restartIfSlow'), node('n2', 'test.record', { value: 'a' }),
    node('n3', 'loop', { times: 0 })]);
  host.restart.perfCalls.length = 0;
  ctx.gapWorkflowBegin(ref());
  const t1 = run('gapCheckClock');
  ctx.gapWorkflowStep();                                 // pass 1: restartIfSlow
  ctx.gapWorkflowStep();                                 // pass 1: work
  run('gapCheckClock += 60000');
  for (let i = 0; i < 3; i++) ctx.gapWorkflowStep();     // loop, pass 2: restartIfSlow, work
  run('gapCheckClock += 60000');
  for (let i = 0; i < 2; i++) ctx.gapWorkflowStep();     // loop, pass 3: restartIfSlow
  const first = host.restart.perfCalls.map((c) => c.sinceMs);
  check('restartIfSlow: first in the loop, `loop` is the previous pass',
    JSON.stringify(first) === JSON.stringify([t1, t1, t1 + 60000]), first);
  ctx.gapWorkflowAbort('stopped');
} finally {
  run('Date.now = gapCheckNow;');
}

// restartIfSlow, slow: restarts with reason `slow`.
resetRestart({ ok: true, comesBack: 'boot' }, { ok: true, slow: true, why: 'fps', fps: 12, captureMs: 30,
  minutes: 10, base: { fps: 30, captureMs: 12, at: 1 } });
receive([node('n1', 'test.record', { value: 'a' }), node('n2', 'restartIfSlow', { over: 'run', captureRise: 200 }),
  node('n3', 'test.record', { value: 'never' })]);
r = runToEnd();
check('restartIfSlow: slow restarts with reason slow', host.restart.calls.length === 1
  && host.restart.calls[0].reason === 'slow' && host.restart.calls[0].workflow.at.index === 2
  && host.restart.perfCalls[0].captureRisePct === 200, host.restart.calls);
check('restartIfSlow: slow ends the workflow as restart', endOf().reason === 'restart'
  && restartEvents()[0].outcome === 'restarting' && restartEvents()[0].why === 'fps'
  && restartEvents()[0].fps === 12, restartEvents());
resetRestart({ ok: false, error: 'restart-no-return' });

// Resuming: `at` starts there, and workflow.start says so.
receive([node('n1', 'test.record', { value: { perLoop: ['a', 'b'] } }), node('n2', 'test.record', { value: 'c' }),
  node('n3', 'loop', { times: 2 })]);
check('resume: the check takes a ref with `at`', JSON.parse(ctx.gapWorkflowCheck(ref({ loop: 2, index: 1 }))).ok
  === true);
check('resume: a bad `at` is bad-args', JSON.parse(ctx.gapWorkflowCheck(ref({ loop: 0, index: 1 }))).error
  === 'bad-args' && JSON.parse(ctx.gapWorkflowCheck(ref({ loop: 1, index: -1 }))).error === 'bad-args'
  && JSON.parse(ctx.gapWorkflowCheck(ref({ loop: 1.5, index: 0 }))).error === 'bad-args');
r = runToEnd(50, { loop: 1, index: 1 });
check('resume: starts at `at`', JSON.stringify(calls.map((c) => c.value + c.loop + c.index))
  === JSON.stringify(['c11', 'b20', 'c21']), calls);
check('resume: workflow.start carries resumed', events[0].event === 'workflow.start'
  && JSON.stringify(events[0].data.resumed) === JSON.stringify({ loop: 1, index: 1 }), events[0]);
r = runToEnd(50, { loop: 2, index: 0 });
check('resume: per-loop values follow the resumed loop', calls[0].value === 'b' && calls[0].loop === 2, calls);
r = runToEnd(50, { loop: 1, index: 3 });
check('resume: `at` past the end ends as `end` with no node run', r.refused === null && calls.length === 0
  && endOf().reason === 'end' && endOf().status === 'ended', { calls, end: endOf() });
check('resume: `at` past the end starts plainly (no resumed)', events[0].event === 'workflow.start'
  && events[0].data.resumed === undefined, events[0]);
r = runToEnd(50);
check('resume: a plain start has no resumed', events[0].data.resumed === undefined, events[0]);

// Tsum's half: labels from the runner, and the banners' log lines.
check('tsum: restart node labels', ctx.workflowNodeLabel('restartIfSlow') === 'Restart if slow'
  && withoutNatives(() => ctx.workflowNodeLabel('restartDevice')) === 'restartDevice');
let said = true;
try {
  ctx.workflowSay('workflow.start', { id: 'wf_check', name: 'check', total: 3, resumed: { loop: 1, index: 1 } });
  for (const outcome of ['restarting', 'skipped', 'not-slow']) {
    ctx.workflowSay('workflow.restart', { id: 'wf_check', nodeId: 'n1', index: 0, loop: 1, outcome,
      error: 'restart-cooldown' });
  }
  for (const why of ['not-enough-data', 'no-baseline']) {
    ctx.workflowSay('workflow.restart', { id: 'wf_check', nodeId: 'n1', index: 0, loop: 1, outcome: 'not-slow', why });
  }
  ctx.workflowSay('workflow.end', { id: 'wf_check', status: 'ended', reason: 'restart', loop: 1, index: 0 });
} catch (e) {
  said = e.message;
}
check('tsum: restart and resume banners', said === true, said);

// --- Tsum's Tsum List check ---------------------------------------------------------
const listFile = path.join(ctx.getDevicePath(), 'tsum_list_state.json');
fs.rmSync(listFile, { force: true });
// The check (workflowTsumCheck) applies to any param on the `tsums` list.
ctx.gapWorkflowDefineNode({
  type: 'test.pickTsum', label: 'Pick Tsum (test)',
  params: [{ key: 'pick', label: 'Tsum', type: 'enum', lists: ['tsums'], perLoop: true, perDevice: true }],
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

// --- presets mirror ----------------------------------------------------------------------
ctx.getScriptPath = () => storage;
ctx.presetsMirror(JSON.stringify([{ name: 'A', values: { skillLevel: 3, bad: { x: 1 } } }, { nope: 1 }]));
check('presets mirror: round trip keeps scalar values only',
  ctx.gapPresetsLocal() === JSON.stringify([{ name: 'A', values: { skillLevel: 3 } }]), ctx.gapPresetsLocal());
fs.rmSync(path.join(storage, 'presets-' + ctx.getDeviceId() + '.json'), { force: true });
check('presets mirror: missing file is []', ctx.gapPresetsLocal() === '[]');

// --- Script add-ons (src/addons.ts), with a test add-on -------------------------------
let companion = JSON.parse(ctx.gapCompanion());
check('addons: none loaded, only the base actions',
  companion.actions.map((a) => a.name).join() === 'wrapUp,cancelWrapUp,lastSettings', companion.actions);
let screens = JSON.parse(ctx.gapScreens());
check('addons: none loaded, My Tsum card has the base fact only',
  JSON.stringify(screens.tabs[0].items[0].items) === JSON.stringify([{ facts: [
    { label: 'My Tsum', bind: 'state.info.myTsum', icon: 'tsum' }] }]), screens.tabs[0].items[0]);
const baseStatsItems = screens.tabs[0].items.length;
let hookRan = false;
let started = null;
const roundStatsSeen = [];
// A run already going: an add-on that loads now catches up on onRunStart.
run('gRunActive = true; gAddonRunStarted = true; ts = { fake: 1 }; var realController = gTaskController; gTaskController = { fake: 2 }');
check('addons: a test add-on registers',
  ctx.gapAddonRegister('test.addon', ctx.GAP_ADDON_API, (host) => {
    host.addActions([{ name: 'test.echo', label: 'Echo' }, { name: 'test.boom', label: 'Boom' }], (name, argsJson) => {
      if (name === 'test.boom') throw new Error('boom');
      return JSON.stringify({ ok: true, args: JSON.parse(argsJson) });
    });
    host.addStateInfo(() => ({ testInfo: 7 }));
    host.addTaskLabels({ testTask: 'Testing' });
    host.addMyTsumCard({ facts: [{ label: 'Test', bind: 'state.info.testInfo' }], buttons: [{ button: 'test.echo' }] });
    host.onRunStart((r, controller) => { started = { r, controller }; });
    host.onRunEnd(() => { hookRan = true; });
    host.addStatsCard({ card: 'Test card', icon: 'coins', items: [{ stats: [{ label: 'T', bind: 'state.info.testInfo' }] }] });
    host.onRoundStats((r, round) => { roundStatsSeen.push({ r, round }); throw new Error('reads nothing'); });
  }) === true);
check('addons: onRunStart replayed for a run already going',
  started !== null && started.r.fake === 1 && started.controller.fake === 2, started);
run('ts = undefined; gTaskController = realController');
companion = JSON.parse(ctx.gapCompanion());
check('addons: actions listed after the base actions',
  companion.actions.map((a) => a.name).join() === 'wrapUp,cancelWrapUp,lastSettings,test.echo,test.boom', companion.actions);
screens = JSON.parse(ctx.gapScreens());
check('addons: My Tsum card has the add-on fact and button',
  JSON.stringify(screens.tabs[0].items[0].items) === JSON.stringify([{ facts: [
    { label: 'My Tsum', bind: 'state.info.myTsum', icon: 'tsum' }, { label: 'Test', bind: 'state.info.testInfo' }] },
  { button: 'test.echo' }]), screens.tabs[0].items[0]);
check('addons: stats card goes in after the My Tsum card',
  screens.tabs[0].items.length === baseStatsItems + 1 && screens.tabs[0].items[1].card === 'Test card'
  && screens.tabs[0].items[2].slot === 'totals', screens.tabs[0].items.map((i) => i.card || i.slot));
check('addons: stats card added once, however often the screens are built',
  JSON.parse(ctx.gapScreens()).tabs[0].items.length === baseStatsItems + 1);
ctx.gapAddonsRoundStats({ fake: 5 }, { seconds: 60, score: 1, baseCoins: 2, finalCoins: 3, medals: 4 });
check('addons: onRoundStats gets the run and the round; a throw stays in the add-on',
  roundStatsSeen.length === 1 && roundStatsSeen[0].r.fake === 5 && roundStatsSeen[0].round.finalCoins === 3, roundStatsSeen);
check('addons: task label merged', screens.maps.tasks.testTask === 'Testing'
  && screens.maps.tasks.buyBoxes === 'Buying boxes', screens.maps.tasks);
check('addons: state info merged', JSON.parse(ctx.gapRemoteState()).info.testInfo === 7);
check('addons: an action runs', JSON.parse(ctx.gapRemoteAction('test.echo', '{"a":1}')).args.a === 1);
check('addons: unknown action still refused',
  JSON.parse(ctx.gapRemoteAction('nope', '{}')).why === 'unknown-action');
check('addons: a throwing action answers action-failed',
  JSON.parse(ctx.gapRemoteAction('test.boom', '{}')).why === 'action-failed');
check('addons: a duplicate id is refused', ctx.gapAddonRegister('test.addon', ctx.GAP_ADDON_API, () => {}) === false);
check('addons: another api is refused', ctx.gapAddonRegister('test.other', ctx.GAP_ADDON_API + 1, () => {}) === false);
ctx.endRun();
check('addons: onRunEnd runs from endRun', hookRan === true);

// A throwing install leaves nothing behind and does not use up its id.
let halfStarted = false;
const nodeCount = JSON.parse(ctx.gapWorkflowCatalog()).nodes.length;
check('addons: a throwing install is refused',
  ctx.gapAddonRegister('test.half', ctx.GAP_ADDON_API, (host) => {
    host.addActions([{ name: 'test.half', label: 'Half' }], () => '{}');
    host.addStateInfo(() => ({ halfInfo: 1 }));
    host.onRunStart(() => { halfStarted = true; });
    host.addStatsCard({ card: 'Half card', items: [] });
    host.onRoundStats(() => { halfStarted = true; });
    ctx.gapWorkflowDefineNode({ type: 'test.halfNode', label: 'Half', params: [], run: () => 'done' });
    throw new Error('half');
  }) === false);
check('addons: a failed install adds no action',
  JSON.parse(ctx.gapCompanion()).actions.every((a) => a.name !== 'test.half'));
check('addons: a failed install adds no state info', JSON.parse(ctx.gapRemoteState()).info.halfInfo === undefined);
check('addons: a failed install adds no workflow node',
  JSON.parse(ctx.gapWorkflowCatalog()).nodes.length === nodeCount);
check('addons: a failed install adds no stats card',
  JSON.parse(ctx.gapScreens()).tabs[0].items.every((i) => i.card !== 'Half card'));
ctx.gapAddonsRunStart({ fake: 3 }, { fake: 4 });
ctx.gapAddonsRoundStats({ fake: 3 }, null);
check('addons: a failed install adds no run or round hook', halfStarted === false);
ctx.gapAddonsRunEnd();
check('addons: a failed id can register again',
  ctx.gapAddonRegister('test.half', ctx.GAP_ADDON_API, () => {}) === true);

// User direction: gapDirect and requestUserDirection go to the one director.
const directRun = { isRunning: true, stallResets: 0, directQuietUntil: 0 };
run('var realController2 = gTaskController; gTaskController = { runningTask: "sendHearts" }');
ctx.ts = directRun;
check('direct: no director answers no-direct',
  JSON.parse(ctx.gapDirect('play', '{"id":"abcdefgh"}')).why === 'no-direct');
check('direct: no director, requestUserDirection is unavailable', ctx.requestUserDirection({}) === 'unavailable');
check('direct: no director, the unknown screen runs the escape',
  ctx.Tsum.prototype.directUnknownPage.call(directRun) === false && directRun.stallResets === 0);
const directSeen = { received: [], asked: [] };
let directAnswer = 'continue';
check('direct: an add-on sets the director',
  ctx.gapAddonRegister('test.director', ctx.GAP_ADDON_API, (host) => {
    host.setDirector({
      request: (r, opts) => {
        directSeen.asked.push(opts);
        if (directAnswer === 'throw') throw new Error('boom');
        return directAnswer;
      },
      receive: (op, args) => {
        directSeen.received.push({ op, args });
        if (op === 'continue') throw new Error('boom');
        return { ok: true, accepted: 1 };
      },
    });
  }) === true);
check('direct: a second director is refused',
  ctx.gapAddonRegister('test.director2', ctx.GAP_ADDON_API, (host) => {
    host.setDirector({ request: () => 'timeout', receive: () => ({ ok: true }) });
  }) === false);
check('direct: setDirector twice in one install is refused',
  ctx.gapAddonRegister('test.director3', ctx.GAP_ADDON_API, (host) => {
    host.setDirector({ request: () => 'timeout', receive: () => ({ ok: true }) });
    host.setDirector({ request: () => 'timeout', receive: () => ({ ok: true }) });
  }) === false);
check('direct: gapDirect passes op and parsed args',
  JSON.parse(ctx.gapDirect('play', '{"id":"abcdefgh","actions":[]}')).accepted === 1
  && directSeen.received[0].op === 'play' && directSeen.received[0].args.id === 'abcdefgh', directSeen.received);
check('direct: a throwing receive answers direct-failed',
  JSON.parse(ctx.gapDirect('continue', '{"id":"abcdefgh"}')).why === 'direct-failed');
check('direct: an unknown op is refused', JSON.parse(ctx.gapDirect('tap', '{}')).why === 'unknown-op');
check('direct: the outcome passes through, the stall guard is pardoned',
  ctx.requestUserDirection({ title: 'T', body: 'B' }) === 'continue' && directRun.stallResets === 1
  && directSeen.asked[0].title === 'T' && directSeen.asked[0].body === 'B', directSeen.asked);
directAnswer = 'throw';
check('direct: a throwing request is a timeout', ctx.requestUserDirection() === 'timeout');
directAnswer = 'continue';
check('direct: unknown screen, Continue handles it with the task in the body',
  ctx.Tsum.prototype.directUnknownPage.call(directRun) === true
  && directSeen.asked[directSeen.asked.length - 1].body === 'Paused on an unfamiliar screen (Sending hearts).',
  directSeen.asked[directSeen.asked.length - 1]);
directAnswer = 'timeout';
const askedBefore = directSeen.asked.length;
check('direct: unknown screen, a timeout runs the escape',
  ctx.Tsum.prototype.directUnknownPage.call(directRun) === false && directRun.directQuietUntil > Date.now());
check('direct: after a timeout the next unknown screen does not ask',
  ctx.Tsum.prototype.directUnknownPage.call(directRun) === false && directSeen.asked.length === askedBefore + 1);
directRun.isRunning = false;
check('direct: a stopped run is stopped at once', ctx.requestUserDirection() === 'stopped');
// The stall guard starts over after a request.
const guardTsum = { stallResets: 0, dismissSystemDialog: () => false, inBoot: () => false };
const guard = ctx.Tsum.prototype.newStallGuard.call(guardTsum, 'test');
for (let i = 0; i < 10; i++) ctx.Tsum.prototype.checkStall.call(guardTsum, guard, 'Unknown');
guardTsum.stallResets++;
ctx.Tsum.prototype.checkStall.call(guardTsum, guard, 'Unknown');
check('direct: the stall guard starts over after a request', guard.repeats === 0 && guard.rounds === 1, guard);
// While booting, an unknown screen is a startup one and is not counted.
guardTsum.inBoot = () => true;
for (let i = 0; i < 10; i++) ctx.Tsum.prototype.checkStall.call(guardTsum, guard, 'unknown');
check('boot: the stall guard leaves startup screens alone', guard.repeats === 0 && guard.rounds === 0, guard);
run('ts = undefined; gTaskController = realController2');

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
