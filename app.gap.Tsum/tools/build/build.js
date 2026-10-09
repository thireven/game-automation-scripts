#!/usr/bin/env node
// The build, written as a dependency graph rather than a list of commands.
//
//   node tools/build/build.js [--channel Alpha] [--adb] [--device SERIAL] [--jobs N]
//
// build.sh and build.ps1 are thin wrappers over this. They used to hold the same
// recipe twice, in two dialects, and had drifted: the PowerShell one wrote CRLF
// into dist/*.html and built its archive with a different tool, so the two
// shells shipped different bytes and different SHA256 sidecars from one tree.
//
// ## Why a graph
//
// Almost nothing in a build of this shape is actually sequential. Only
// pageDocs, dispatchEval and the shipped bundle need build/index.js; eventDocs
// reads the TypeScript sources directly, the code map reads the tree, and the
// tsum library is a plain file copy. Run in order that was ~16s of steps; run
// by need it is the length of the longest chain, which is the game bundle's
// compile and reprint.
//
// The other half of the win is not spawning node so often. It costs ~230ms to
// start and ~300ms more to load terser, against ~50ms to actually reprint one
// of the small page scripts -- so the eight separate minify processes spent
// 2.4s booting to do 0.4s of work. They are one process now (`--batch`), and
// the cheap file work here (copies, placeholder substitution) happens in this
// process rather than in a shell.
//
// ## Adding a step
//
// Add it to `steps` in the position it should *print*, name what it `needs`,
// and mark it `optional` if a finding from it should be read rather than block
// the build. tools/build/schedule.js does the rest.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const { projectDir, loadConfig, resolveChannel, archiveName } = require('../release/config');
const { runSteps, defaultJobs } = require('./schedule');
const { zipDirectory } = require('./zip');
const { signScript, SIGNATURE_FILE } = require('./signScript');

const argv = process.argv.slice(2);
const has = (name) => argv.includes('--' + name);
const valueOf = (name) => {
  const at = argv.indexOf('--' + name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const local = (...parts) => path.join(projectDir, ...parts);
const nodeBin = process.execPath;
const tsc = local('node_modules', 'typescript', 'bin', 'tsc');

const DEPLOY_DIR = '/sdcard/Download/GeneralAutomationPlatform/scripts/DEV';

/**
 * The host's install ledger, written beside a DEV push so the app lists the
 * folder as "Tsum Tsum DEV - <local deploy time>" rather than "DEV".
 */
function devLedger() {
  const at = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
  const file = local('build', 'gap-install.json');
  fs.writeFileSync(file, JSON.stringify({
    source: 'local', name: `Tsum Tsum DEV - ${stamp}`, version, installedAt: at.getTime(),
  }, null, 2));
  return file;
}

// The page scripts, minified in one process. All ES5, to match what
// tsconfig.settings.json and tsconfig.quickbar.json emit. `verify` is only
// spelled out where the file declares something reached by name from outside
// itself -- the rest declare one array or one call, and nothing is renamed
// either way because mangling is off. A new language file is one more line.
const PAGE_SCRIPTS = [
  { file: 'build/settings.js', verify: 'names:onEvent,onLog' },
  { file: 'build/quickbarPage.js', verify: 'names:onGapState,onQuickBarState' },
  { file: 'build/i18n.js', verify: 'names:i18nRegister,i18nText' },
  { file: 'build/uiEn.js' },
  { file: 'build/uiZhTw.js' },
  { file: 'build/uiJa.js' },
  { file: 'build/releaseStatus.js', verify: 'names:offeredHere,statusFlag' },
  { file: 'build/skillOptions.js' },
  // No `verify`, as skillOptions: `names:` looks for function declarations and
  // both of these files are one `var` holding an array.
  { file: 'build/bubbleOptions.js' },
  { file: 'build/stopAfterOptions.js' },
  { file: 'build/runPlan.js' },
  { file: 'build/settingDefaults.js' },
  { file: 'build/qrCode.js', verify: 'names:qrMatrix' },
  { file: 'build/presets.js', verify: 'names:presetsLoad,presetMatchName' },
  { file: 'build/pageStyle.js', verify: 'names:pageStyle,applyPageStyle' },
].map((job) => ({ in: job.file, out: job.file, ecma: 5, verify: job.verify }));

// config.json is the release identity: the game and one entry per channel. The
// version is package.json's. The archive is named from both, so a build and the
// metadata.json that ships beside it cannot disagree about what was built.
const channel = resolveChannel(loadConfig(), valueOf('channel') || '');
const version = channel.Version;
const archive = archiveName(channel);

// UTC, and the same string both old scripts produced: `2026-09-07 12:34:56 +00:00`.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const buildDate = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
  `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} +00:00`;

/** Run a child process, folding both of its streams into the step's log. */
function sh(log, file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (chunk) => log(chunk.toString());
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(file)} ${args.join(' ')} exited ${code}`)));
  });
}

/** Every tool in this build is a node script. */
const node = (log, ...args) => sh(log, nodeBin, args);

/**
 * The pages carry `$VERSION` and `$BUILD_DATE` placeholders rather than values
 * of their own, so package.json stays the one place the version is written.
 *
 * `$RELEASE_STATUS` is the same trick for the channel's floor: src/releaseStatus.ts
 * turns it into `ReleaseStatusMin`, which is what narrows both the skill list and
 * the settings schema to what this channel offers. Substituted after inlining
 * like the other two, which is safe because tools/minify runs terser with
 * `compress: false` -- the literal is still a literal in the minified page.
 */
const substitute = (text) => text
  .replaceAll('$BUILD_DATE', buildDate)
  .replaceAll('$VERSION', version)
  .replaceAll('$RELEASE_STATUS', String(channel.Status));

/** Stage the page assets so tools/inline/inline.js can resolve them by name. */
function stageAssets(log) {
  for (const name of ['index.html', 'index.css', 'felt.css', 'a11y.css', 'quickbar.html', 'quickbar.css',
    'feltQuickbar.css', 'a11yQuickbar.css', 'gapTokens.css']) {
    fs.copyFileSync(local('src', name), local('build', name));
  }
  // The GAP fonts as data URIs: the pages are opened from file:// on a device
  // that is often offline, so a font they have to fetch is a font they lack.
  // One sheet per family, so the Quick Bar inlines only the one it uses.
  for (const [sheet, family, file, weight] of GAP_FONTS) {
    const data = fs.readFileSync(local('src', 'fonts', file)).toString('base64');
    fs.writeFileSync(local('build', sheet),
      `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");` +
      `font-weight:${weight};font-style:normal;font-display:block}\n`);
  }
  log('[build] staged index/quickbar html+css, GAP tokens and fonts into build/\n');
}

/**
 * [sheet, family, file in src/fonts, weight range] -- Latin subsets: the felt
 * skin's Figtree and Caprasimo (the website's faces), and the kit's Plex Mono.
 */
const GAP_FONTS = [
  ['font-sans.css', 'Figtree', 'figtree.woff2', '500 800'],
  ['font-display.css', 'Caprasimo', 'caprasimo.woff2', '400'],
  ['font-mono.css', 'IBM Plex Mono', 'ibm-plex-mono.woff2', '400'],
];

/**
 * Fold a page's assets into it and substitute the placeholders. The inlined
 * copy is staged in build/ rather than dist/: a failure between the two steps
 * would otherwise leave a half-made page in the directory that gets zipped.
 */
async function inlinePage(log, source, dest) {
  const staged = 'build/' + path.basename(dest, '.html') + '.inlined.html';
  await node(log, 'tools/inline/inline.js', source, staged);
  fs.writeFileSync(local(dest), substitute(fs.readFileSync(local(staged), 'utf8')));
  fs.rmSync(local(staged));
}

/**
 * The game bundle, stripped of whitespace on the way into dist/ and left alone
 * in build/: the offline harnesses (tools/runtime, tools/pageDocs) read
 * build/index.js and want it readable when something there fails.
 *
 * The version is stamped in on the way past. build/index.js keeps the
 * placeholder -- that is the copy the harnesses read, and nothing there reads
 * it for meaning.
 */
async function distBundle(log) {
  const source = fs.readFileSync(local('build', 'index.js'), 'utf8');
  fs.writeFileSync(local('build', 'index.stamped.js'), source.replaceAll('$VERSION', version));
  await node(log, 'tools/minify/minify.js', 'build/index.stamped.js', 'dist/index.js',
    '--ecma', '2023', '--verify', 'bundle');
  fs.rmSync(local('build', 'index.stamped.js'));
}

/**
 * The archive, and its SHA256 beside it so a copy that has travelled to a
 * device can be checked back against the build it came from.
 *
 * The sidecar holds the bare 64-character lowercase digest and nothing else --
 * no filename field, no trailing newline -- because it is read to be passed
 * around as a web payload, and whoever reads it should get a value they can use
 * as-is. That is deliberately not `sha256sum -c` format.
 */
function writeArchive(log) {
  const names = zipDirectory(local('dist'), local(archive));
  const bytes = fs.readFileSync(local(archive));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(local(archive + '.sha256'), digest);
  log(`[build] ${archive} (${(bytes.length / 1024).toFixed(0)}K): ${names.join(', ')}\n`);
  log(`[build] SHA256 = ${digest}\n`);
}

/**
 * Signs dist/ for GAP Companion (`gap-signature.json`, tools/build/signScript.js)
 * when `GAP_SCRIPT_KEY` names a PEM private key. Unsigned builds still run;
 * they just get no companion. The id is `GAP_SCRIPT_ID` in src/index.ts.
 */
function signDist(log) {
  const keyFile = process.env.GAP_SCRIPT_KEY || devScriptKey();
  if (!keyFile) {
    log('[build] GAP_SCRIPT_KEY unset: dist/ is not signed (no GAP Companion)\n');
    return;
  }
  const id = /const GAP_SCRIPT_ID = '([^']+)'/.exec(fs.readFileSync(local('src', 'index.ts'), 'utf8'));
  if (!id) throw new Error('GAP_SCRIPT_ID not found in src/index.ts');
  const pkgVersion = JSON.parse(fs.readFileSync(local('package.json'), 'utf8')).version;
  const manifest = signScript({ dir: local('dist'), script: id[1], version: pkgVersion,
    keyPem: fs.readFileSync(keyFile, 'utf8') });
  log(`[build] dist/${SIGNATURE_FILE}: ${id[1]} ${pkgVersion}, ${Object.keys(manifest.files).length} files\n`);
}

/**
 * A DEV push (--adb) signs with the GAP Devkit's dev script key when the
 * gap-companion checkout sits beside this repo, as the Devkit's own deploy does.
 * Release builds never fall back to it.
 */
function devScriptKey() {
  if (!has('adb')) return undefined;
  const pem = path.join(projectDir, '..', '..', 'gap-companion', 'cloud', 'adapters', '.dev-key', 'script-private.pem');
  return fs.existsSync(pem) ? pem : undefined;
}

// Declaration order is print order. What actually runs when is decided by
// `needs` alone.
const steps = [
  { id: 'tsc:game', run: ({ log }) => node(log, tsc) },

  // Regenerated from the bundle that was just built: the dispatch order is
  // computed by PageRouter.plan rather than written down, so the only honest way
  // to document it is to ask the compiled router.
  //
  // Optional here, and in the three below it, is deliberate: a stale document, a
  // page nothing navigates off, a changed trace row or a drifted code map is
  // worth reading and never worth blocking a build over. `npm run
  // pages:docs:check`, `events:docs:check`, `dispatch:eval` and `map:check` are
  // the gates that fail.
  {
    id: 'docs:pages', needs: ['tsc:game'], optional: true,
    run: ({ log }) => node(log, 'tools/pageDocs/generate.js'),
  },
  // Reads the TypeScript program rather than the bundle -- what matters about an
  // emit is which file and line it is on and what type each payload field has,
  // and the bundle has thrown all three away. So it needs no compile, and runs
  // alongside one.
  {
    id: 'docs:events', optional: true,
    run: ({ log }) => node(log, 'tools/eventDocs/generate.js'),
  },
  {
    id: 'eval:dispatch', needs: ['tsc:game'], optional: true,
    run: ({ log }) => node(log, 'tools/dispatchEval/run.js'),
  },
  {
    id: 'check:codemap', optional: true,
    run: ({ log }) => node(log, 'tools/codemap/check.js', '--quiet'),
  },
  // Not optional, unlike the four above: this one is not a document going
  // stale, it is a setting that will silently do nothing on a running script or
  // break the round it is changed in -- which has shipped three times. Drives
  // the bundle tsc just wrote, so `--no-build` keeps it from compiling again
  // over the steps running beside it.
  {
    id: 'check:live', needs: ['tsc:game'],
    run: ({ log }) => node(log, 'tools/liveSettings/check.js', '--no-build'),
  },

  { id: 'tsc:settings', run: ({ log }) => node(log, tsc, '-p', 'tsconfig.settings.json') },
  // Behind the settings compile for want of a lock, not a core: both configs
  // emit build/i18n.js, the ui*.js catalogues and skillOptions.js from the same
  // sources. The output is identical either way, but two tsc processes writing
  // those paths at once can leave one of them half-written. Giving this config
  // its own outDir would buy back ~0.5s and cost a copy step plus a fix to
  // tools/quickbarPreview, which reads them out of build/ by name.
  {
    id: 'tsc:quickbar', needs: ['tsc:settings'],
    run: ({ log }) => node(log, tsc, '-p', 'tsconfig.quickbar.json'),
  },
  {
    id: 'minify:pages', needs: ['tsc:quickbar'],
    run: ({ log }) => node(log, 'tools/minify/minify.js', '--batch', JSON.stringify(PAGE_SCRIPTS)),
  },

  { id: 'stage:assets', run: ({ log }) => stageAssets(log) },
  {
    id: 'dist:index', needs: ['minify:pages', 'stage:assets'],
    run: ({ log }) => inlinePage(log, 'build/index.html', 'dist/index.html'),
  },
  // Deployed beside index.html, where the host looks for it -- a script without
  // one simply has no Quick Bar button.
  {
    id: 'dist:quickbar', needs: ['minify:pages', 'stage:assets'],
    run: ({ log }) => inlinePage(log, 'build/quickbar.html', 'dist/quickbar.html'),
  },
  { id: 'dist:bundle', needs: ['tsc:game'], run: ({ log }) => distBundle(log) },
  // GAP Companion's Settings tab: the settings page's schema as data, read by
  // `gapSettingsSchema` (src/index.ts). From the page scripts, so after their minify.
  {
    id: 'dist:companion', needs: ['minify:pages'],
    run: ({ log }) => node(log, 'tools/companion/settings.js', '--channel-status', String(channel.Status)),
  },
  // The tsum portrait libraries: not compiled, but shipped, so they go into
  // dist/ under the same rule as the scripts. Each is read off getScriptPath()
  // on first use rather than out of the bundle. tsumNames.dat and
  // tsumsCollection.dat are the Tsum List export's, for the collection screen.
  {
    id: 'dist:library',
    run: async ({ log }) => {
      await node(log, 'tools/minify/library.js', 'src/tsums.dat', 'dist/tsums.dat');
      await node(log, 'tools/minify/library.js', 'src/tsumsCollection.dat', 'dist/tsumsCollection.dat');
      await node(log, 'tools/minify/library.js', 'src/tsumNames.dat', 'dist/tsumNames.dat');
    },
  },
  // The license and the notices ride in the archive: both pages inline the GAP
  // fonts, whose OFL notice has to travel with them.
  {
    id: 'dist:notices',
    run: ({ log }) => {
      for (const name of ['LICENSE', 'NOTICE']) fs.copyFileSync(local('..', name), local('dist', name));
      log('[build] dist/LICENSE, dist/NOTICE\n');
    },
  },
  // The env vars this script asks GAP for (getEnv, env:KEY requests).
  {
    id: 'dist:env',
    run: ({ log }) => {
      const text = fs.readFileSync(local('gap-env.json'), 'utf8');
      JSON.parse(text); // a broken manifest fails the build, not the device
      fs.writeFileSync(local('dist', 'gap-env.json'), text);
      log('[build] dist/gap-env.json\n');
    },
  },

  // The page localStorage keys GAP's Library backs up (Back up / Restore settings).
  {
    id: 'dist:backup',
    run: ({ log }) => {
      const text = fs.readFileSync(local('gap-backup.json'), 'utf8');
      JSON.parse(text); // a broken manifest fails the build, not the device
      fs.writeFileSync(local('dist', 'gap-backup.json'), text);
      log('[build] dist/gap-backup.json\n');
    },
  },

  // Last into dist/: it hashes every file there, so the archive and the push carry it.
  {
    id: 'sign',
    needs: ['dist:index', 'dist:quickbar', 'dist:bundle', 'dist:library', 'dist:notices', 'dist:env', 'dist:backup', 'dist:companion'],
    run: ({ log }) => signDist(log),
  },
  { id: 'archive', needs: ['sign'], run: ({ log }) => writeArchive(log) },
];

async function main() {
  const jobs = Number(valueOf('jobs')) || defaultJobs();
  console.log(`[build] channel ${channel.name}, version ${version}, archive ${archive}`);
  console.log(`[build] offering skills and settings at status ${channel.Status} and above`);
  console.log(`[build] ${steps.length} steps, ${jobs} jobs`);

  fs.rmSync(local('dist'), { recursive: true, force: true });
  fs.rmSync(local('build'), { recursive: true, force: true });
  fs.mkdirSync(local('dist'));
  fs.mkdirSync(local('build'));

  const started = Date.now();
  const result = await runSteps(steps, { jobs });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    for (const failure of result.failures) console.error(`[build] FAILED ${failure.id}: ${failure.message}`);
    console.error(`[build] build failed after ${elapsed}s`);
    process.exit(1);
  }
  console.log(`[build] done in ${elapsed}s`);

  if (has('adb')) {
    const devices = valueOf('device') ? [valueOf('device')] : connectedEmulators();
    const failed = [];
    const ledger = devLedger();
    for (const device of devices) {
      console.log(`[build] pushing to ${device}...`);
      try {
        // A multi-file push fails if the target folder is missing.
        await sh((text) => process.stdout.write(text), 'adb', ['-s', device, 'shell', 'mkdir', '-p', `'${DEPLOY_DIR}'`]);
        // An unsigned build would leave an older push's signature behind, which
        // no longer matches the files, so GAP silently gives no companion.
        if (!fs.existsSync(local('dist', SIGNATURE_FILE))) {
          await sh((text) => process.stdout.write(text), 'adb', ['-s', device, 'shell', 'rm', '-f', `'${DEPLOY_DIR}/${SIGNATURE_FILE}'`]);
        }
        // Every dist/ file: gap-signature.json lists them all, and a missing one fails it.
        const files = fs.readdirSync(local('dist')).map((name) => 'dist/' + name);
        await sh((text) => process.stdout.write(text), 'adb', ['-s', device, 'push', ...files, DEPLOY_DIR]);
        await sh((text) => process.stdout.write(text), 'adb', ['-s', device, 'push', ledger, `${DEPLOY_DIR}/.gap-install.json`]);
      } catch (err) {
        // Keep going so one bad emulator doesn't block the rest.
        console.error(`[build] push to ${device} failed: ${err && err.message ? err.message : err}`);
        failed.push(device);
      }
    }
    if (failed.length) throw new Error(`push failed on ${failed.join(', ')}`);
  }
}

// Every emulator in `adb devices`: `emulator-NNNN`, or a local TCP serial such
// as BlueStacks' `127.0.0.1:5555`. Physical devices and offline entries are skipped.
function connectedEmulators() {
  const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
  const serials = [];
  for (const line of out.split('\n').slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (state !== 'device') continue;
    if (/^emulator-\d+$/.test(serial) || /^(127\.0\.0\.1|localhost):\d+$/.test(serial)) serials.push(serial);
  }
  // An emulator reached over `adb connect` also shows as 127.0.0.1:<console port + 1>; push once.
  const unique = serials.filter((serial) => {
    const port = /:(\d+)$/.exec(serial);
    return !port || !serials.includes(`emulator-${Number(port[1]) - 1}`);
  });
  if (!unique.length) throw new Error('no emulator listed in `adb devices`; pass --device SERIAL');
  return unique;
}

main().catch((err) => {
  console.error('[build] ' + (err && err.message ? err.message : err));
  process.exit(1);
});
