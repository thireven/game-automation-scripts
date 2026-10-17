#!/usr/bin/env node
// Build a channel and publish it to the testers' folder on R2 rather than the
// catalogue. See docs/PRERELEASE.md in general-automation-app.
//
//   npm run prerelease:alpha
//   node tools/release/prerelease.js --channel Alpha [--dry-run] [--stage DIR] [--no-build] [--yes] [--keep-old]
//
// Steps, each one stopping the run if it fails:
//   1. settle the release note (the same review release.js runs)
//   2. build the channel's archive
//   3. read the folder's current <folder>.json from R2 and add this build to its
//      history (HistoryLimit rows, newest first)
//   4. upload the zip, then check the served copy hashes to the entry's Hash
//   5. upload <folder>.json, then check the served copy names this version
//   6. delete zips past HistoryLimit from R2 (not with --keep-old)
//
// The zip goes up before the catalogue, so a tester never reads an entry naming
// a missing file. --dry-run does 1-3, writes the catalogue to build/prerelease/
// and uploads nothing. --stage DIR does the same into DIR, zip included: the
// deploy dashboard (GAP/tools/deploy) cuts that way and uploads it itself.
//
// A folder listed in Prerelease.Private (alpha) is not public: the tester gate
// Worker (GAP/tools/tester-gate) serves it only under <BaseUrl>/t/<token>/, one
// token per tester. The checks in 4 and 5 go through the gate with your own
// token, from GAP_TESTER_TOKEN or ~/.gap/tester-token (the dashboard writes it).
// Beta is a public opt-in and goes through release:beta into the catalogue.
//
// Needs rclone with the remote in config.json's Prerelease.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { projectDir, loadConfig, resolveChannel, archiveName } = require('./config');
const { noteProblem, reviewNote } = require('./review');
const { summaryItems, releaseMessage, runBuild, historyRow, utcTimestamp } = require('./release');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function rclone(args, opts = {}) {
  return execFileSync('rclone', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

/** The folder's current catalogue, or undefined on its first pre-release. */
function readRemoteCatalogue(remoteFile) {
  let text;
  try {
    text = rclone(['cat', remoteFile], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${remoteFile} is not valid JSON. Fix or delete it before publishing over it.`);
  }
}

/** Your own tester token, which reads a private folder through the gate. */
function testerToken() {
  if (process.env.GAP_TESTER_TOKEN) return process.env.GAP_TESTER_TOKEN.trim();
  const file = path.join(process.env.GAP_KEY_HOME || path.join(os.homedir(), '.gap'), 'tester-token');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

/** Fetch a URL, skipping any CDN copy with a query string. */
async function fetchFresh(url) {
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${url.replace(/\/t\/[^/]+\//, '/t/<token>/')} returned ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stageDir = flag('--stage') && path.resolve(flag('--stage'));
  const dryRun = argv.includes('--dry-run') || !!stageDir;
  const skipBuild = argv.includes('--no-build');
  const skipReview = argv.includes('--yes') || argv.includes('-y');
  const keepOld = argv.includes('--keep-old');

  const config = loadConfig();
  const channel = resolveChannel(config, flag('--channel'));
  if (channel.Status >= 2) {
    throw new Error(`${channel.name} is a production channel. Use npm run release:${channel.name.toLowerCase()}.`);
  }
  const pre = config.Prerelease;
  if (!pre || !pre.Remote || !pre.BaseUrl) {
    throw new Error('config.json has no Prerelease { Remote, BaseUrl }.');
  }

  // alpha/ holds alpha.json; the lowercase name is also the entry's Channel pill.
  const folder = channel.Directory.toLowerCase();
  const remoteDir = `${pre.Remote.replace(/\/$/, '')}/${folder}`;
  const publicDir = `${pre.BaseUrl.replace(/\/$/, '')}/${folder}`;
  const catalogueName = `${folder}.json`;
  const archive = archiveName(channel);

  // Where the checks read from: the gate for a private folder, else the folder itself.
  const isPrivate = (pre.Private || []).includes(folder);
  let readDir = publicDir;
  if (isPrivate && !dryRun) {
    const token = testerToken();
    if (!token) {
      throw new Error(`${folder}/ is private, and there is no tester token to check the upload with. ` +
        'Set GAP_TESTER_TOKEN, or add yourself under Testers in the deploy dashboard.');
    }
    readDir = `${pre.BaseUrl.replace(/\/$/, '')}/t/${token}/${folder}`;
  }

  // 1. The note, settled before anything is built.
  const changelogFile = path.join(projectDir, 'CHANGELOG.md');
  const limit = config.MessageMaxChars ?? 600;
  const render = (items) => releaseMessage(items, channel.Note);
  let items = summaryItems(fs.readFileSync(changelogFile, 'utf8'), channel.Version);
  let message = render(items);
  if (skipReview) {
    const problem = noteProblem(items, message, limit);
    if (problem) throw new Error(problem);
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('The release note has to be approved and there is no terminal. Pass --yes.');
    }
    const reviewed = await reviewNote({ items, channel, limit, render, changelogFile, allowSave: !dryRun });
    if (!reviewed.approved) throw new Error('Denied -- nothing was built or uploaded.');
    ({ items, message } = reviewed);
  }

  // 2. The build.
  console.log(`\nPre-releasing ${channel.Name} ${channel.Version} to ${publicDir}/${isPrivate ? ' (private)' : ''}`);
  if (skipBuild) console.log('Skipping the build (--no-build).');
  else runBuild(channel.name);
  const archivePath = path.join(projectDir, archive);
  if (!fs.existsSync(archivePath)) throw new Error(`The build produced no ${archive}.`);
  const bytes = fs.readFileSync(archivePath);
  const hash = sha256(bytes);

  // 3. The catalogue entry, inheriting the folder's history.
  const previous = readRemoteCatalogue(`${remoteDir}/${catalogueName}`);
  const scripts = (previous && Array.isArray(previous.Scripts)) ? previous.Scripts : [];
  const old = scripts.find((s) => s.Game === config.Game && s.Name === channel.Name);
  const inherited = (old && Array.isArray(old.Versions)) ? old.Versions.filter((v) => v && v.Version && v.File) : [];

  const same = inherited.find((v) => v.Version === channel.Version);
  if (same && same.Hash !== hash) {
    console.warn(`\nNote: ${channel.Version} is already published with a different hash. ` +
      'Testers who installed it will not be offered this build; bump the version for that.');
  }

  // File is the folder's own address even when it is private: the gate rewrites
  // it to each tester's /t/<token>/ address as it serves the catalogue.
  const entry = {
    Game: config.Game,
    Name: channel.Name,
    Version: channel.Version,
    Channel: folder,
    Date: utcTimestamp(new Date()),
    Hash: hash,
    File: `${publicDir}/${archive}`,
    Message: message,
  };
  if (channel.MinHost) entry.MinHost = channel.MinHost;
  if (channel.MaxHost) entry.MaxHost = channel.MaxHost;

  const historyLimit = config.HistoryLimit || 5;
  entry.Versions = [historyRow(entry)]
    .concat(inherited.filter((v) => v.Version !== entry.Version))
    .slice(0, historyLimit);

  // Zips that fell off the history, if they live in this folder.
  const kept = new Set(entry.Versions.map((v) => v.File));
  const pruned = [...new Set(inherited.map((v) => v.File))]
    .filter((f) => !kept.has(f) && f.startsWith(`${publicDir}/`))
    .map((f) => f.slice(publicDir.length + 1));

  // Other scripts in the folder's catalogue are kept as they are.
  const catalogue = {
    Name: (previous && previous.Name) || `GAP ${channel.name}`,
    Updated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    Scripts: [entry, ...scripts.filter((s) => s !== old)],
  };
  if (catalogue.Name === 'Official GAP') throw new Error('"Official GAP" is reserved; the app marks it UNSAFE.');

  const outDir = stageDir || path.join(projectDir, 'build', 'prerelease', folder);
  if (stageDir) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const catalogueFile = path.join(outDir, catalogueName);
  fs.writeFileSync(catalogueFile, JSON.stringify(catalogue, null, 2) + '\n');
  console.log(`\n${JSON.stringify(entry, null, 2)}\n`);

  if (stageDir) {
    fs.copyFileSync(archivePath, path.join(outDir, archive));
    console.log(`Staged ${archive} and ${catalogueName} in ${outDir}. Nothing uploaded.`);
    return;
  }
  if (dryRun) {
    console.log(`Dry run -- nothing uploaded. Catalogue written to ${catalogueFile}. To publish by hand:`);
    console.log(`  rclone copyto ${archive} ${remoteDir}/${archive}`);
    console.log(`  rclone copyto ${path.relative(projectDir, catalogueFile)} ${remoteDir}/${catalogueName}`);
    pruned.forEach((f) => console.log(`  would prune ${remoteDir}/${f} (past the ${historyLimit} kept)`));
    return;
  }

  // 4. The zip first, and check what testers will download.
  console.log(`Uploading ${archive} ...`);
  rclone(['copyto', archivePath, `${remoteDir}/${archive}`]);
  const served = sha256(await fetchFresh(`${readDir}/${archive}`));
  if (served !== hash) {
    throw new Error(`${entry.File} hashes to ${served}, not ${hash}. The catalogue was not uploaded.`);
  }
  console.log('  served zip matches Hash');

  // 5. The catalogue last.
  console.log(`Uploading ${catalogueName} ...`);
  rclone(['copyto', catalogueFile, `${remoteDir}/${catalogueName}`]);
  const live = JSON.parse((await fetchFresh(`${readDir}/${catalogueName}`)).toString('utf8'));
  const liveEntry = (live.Scripts || []).find((s) => s.Name === channel.Name);
  if (!liveEntry || liveEntry.Version !== entry.Version || liveEntry.Hash !== hash) {
    throw new Error(`${publicDir}/${catalogueName} does not list ${channel.Version} yet. Check the upload.`);
  }
  console.log(`  served ${catalogueName} lists ${channel.Version}`);

  // 6. Old zips nothing points at any more.
  for (const f of pruned) {
    if (keepOld) {
      console.log(`  kept ${f} (--keep-old)`);
      continue;
    }
    rclone(['deletefile', `${remoteDir}/${f}`]);
    console.log(`  pruned ${f} (past the ${historyLimit} kept)`);
  }

  console.log(isPrivate
    ? `\nPublished. Each tester adds ${pre.BaseUrl}/t/<their token>/${folder}/${catalogueName} as a library source.`
    : `\nPublished. Testers add ${publicDir}/${catalogueName} as a library source.`);
  console.log('Installable versions:');
  entry.Versions.forEach((v, i) => console.log(`  ${v.Version}${i === 0 ? '  (latest)' : ''}`));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
