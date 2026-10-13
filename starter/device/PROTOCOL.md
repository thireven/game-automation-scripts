# `gap-service.sh` host protocol, version 1

`device/gap-service.sh` runs on the device and is the only place the launch
algorithm exists. Both hosts — the PowerShell menu and the shell menu — do the
same two things:

```
adb -s <serial> push device/gap-service.sh /data/local/tmp/gap-service.sh
adb -s <serial> shell sh /data/local/tmp/gap-service.sh <verb> [flags]
```

The push is unconditional. At ~7 KB it costs one round trip, the same as
checking whether a push is needed, and unconditional means one fewer state to
get wrong. It lands beside the stage dir rather than in it: `/data/local/tmp`
belongs to the adb shell on every Android, while `/data/local/tmp/gap` is
root's on a rooted device whose app has started the service itself — a push
into it fails before any verb can run.

## Verbs

| Verb | Does |
|---|---|
| `probe` | Reports only. Never stages, kills or launches. Safe to call on every Refresh. |
| `start` | Stages if the stamp changed, kills a running instance, launches, waits 3 s, reports the log. A stage dir this uid cannot write (root's, from an in-app launch) is moved aside and staged afresh. |
| `stop` | `pkill` plus the 1 s socket-release gap. |
| `log` | Emits the `service.log` block and the running flag. |
| `clean` | `rm -rf /data/local/tmp/gap`, or moves it aside when it is another user's. Forces a full re-stage next `start`. |
| `watch` | One poll for the PC's watch mode (below). Reports only, apart from the files it writes in `/data/local/tmp/gap-watch`. |

A service running under another uid — the app's own root launch — is out of
reach of both `start` and `stop`: it cannot be killed from here, and a second
launch beside it would sit inert with the socket name taken. Both refuse with
`err=not-ours` rather than pretend. `start` still answers `already-running`
for it when the stamp matches and `--force` is absent.

Flags: `--force` (restart a service already running from this build),
`--tcp PORT`, `--script ID`. Passing `--tcp` or `--script` implies `--force`,
because the running service was not started with them. `watch` takes
`--take` and `--emulator NAME` instead.

## Output

Line-oriented. `key=value` lines, plus one optional raw block. Hosts must
tolerate unknown keys, and must strip `\r` from every line — `adb shell` line
endings vary by transport.

```
proto=1
device_abi=arm64-v8a
abilist=arm64-v8a,armeabi-v7a,armeabi
sdk=33
release=13
model=MuMu Player 12
running=0
installed=1
apk=/data/app/~~ab12/com.generalautomation.platform-cd34/base.apk
abi=arm64-v8a
libdir=/data/app/~~ab12/com.generalautomation.platform-cd34/lib/arm64
loader=app_process64
stamp=31204992:1755743001
staged=31204992:1755743001
args=
step=stage-skipped
step=kill
step=launch
---BEGIN service.log---
…raw text, passed straight to the host's log pane…
---END service.log---
running=1
rc=0
```

### Keys

| Key | Meaning |
|---|---|
| `proto` | Always first. Hosts **must** assert `proto=1` and refuse a mismatch, so a protocol change cannot half-land. |
| `running` | `1`/`0`. Emitted early (from `pgrep`) and again after a launch. The **last** occurrence is the verdict. |
| `installed` | `0` means the package is absent. `probe` still exits `rc=0` — the host renders the row and offers the bundled APK. |
| `libs_present` | Only when no loadable `libdir` was found: the space-separated names under `lib/`. Feeds the wrong-ABI hint. |
| `step` | Repeatable progress marker: `stage-replaced`, `staged`, `stage-skipped`, `kill`, `not-running`, `launch`, `already-running`, `clean`. |
| `err` | Machine slug: `not-installed`, `no-libs`, `not-ours`, `stage-failed`, `launch-failed`, `stop-failed`, `bad-usage`. |
| `msg` | Human sentence for the same failure. Safe to show verbatim. |
| `rc` | Always last. `0` success. |

`probe` reports `err=no-libs` with `rc=0`: it is a fact about the device, not a
failure of the probe. `start` treats the same condition as `rc=1`.

## `watch`

The PC's watch mode (tsum-stats `internal/starter`) runs this every 15 s on
each device it watches, to start GAP again after a restart and to restart a
frozen emulator from the host. It shares `/data/local/tmp/gap-watch/` with the
engine:

| File | Written by | Holds |
|---|---|---|
| `stamp` | `watch`, every call | `<epochSec>`. A fresh one (< 180 s) tells the engine a watcher is there, so GAP can come back after a restart (`comesBack: host`). |
| `request` | the engine | `<epochSec> <reason>`: restart this device from the host. The watcher takes it (`--take`) and restarts the emulator; when no watcher takes it within 60 s, the engine reboots from inside. |
| `alive` | the engine, every 30 s | `<epochSec> <active 0\|1> <pid>`. Stale means the engine froze. |
| `emulator` | `watch --emulator NAME` | The host's name for this emulator (`mumu`, `ldplayer`, `bluestacks`, ...). |

```
proto=1
now=1755743001
boot_id=6f1c2d3e-…
booted=1
uptime=842
running=1
uid=2000
alive=1755742990
alive_active=1
request=1755742995 slow
stamped=1
rc=0
```

| Key | Meaning |
|---|---|
| `now` | The device clock, epoch seconds. Compare `alive` and `request` with this, not the PC's clock. |
| `boot_id` | `/proc/sys/kernel/random/boot_id`. A new one means the device rebooted. |
| `booted` | `1` once `sys.boot_completed` is set. |
| `uptime` | Whole seconds since boot. |
| `running` | `1`/`0`, as for the other verbs. |
| `uid` | The running service's uid (`0` when the app started it as root), or empty. |
| `alive`, `alive_active` | From `alive`: when the engine last wrote it (empty when it never has) and whether a run was active. |
| `request` | The engine's restart request, as written, or empty. Printed before `--take` removes it. |
| `taken` | With `--take` only: `1` when the request is gone, `0` when it could not be removed (it would be seen again next poll). |
| `stamped` | `1` when `stamp` now holds `now`; `0` when it could not be written, so the engine will not see this watcher (`comesBack` is not `host`). |

A write that fails (`taken=0`, `stamped=0`, or `emulator` not written) adds
`err=watch-dir-unwritable` and a `msg` naming the files; usually the engine
made the dir as root without handing it to the shell user. `rc=1` only when a
write the call asked for failed (`--take`, `--emulator`); a failed `stamp`
alone keeps `rc=0`, since the facts reported are still good.

`--emulator` refuses a name with anything but letters, digits, `.`, `_` and
`-` (`err=bad-usage`). The verb is an addition to protocol 1, so `proto` stays
`1`: hosts push this script before every call, so the device always has it.

## Rules for a host implementation

1. Assert `proto=1`.
2. Strip `\r` from every line.
3. Take the **last** `running=` as the verdict — `start` emits it twice.
4. Read `rc=` for success, never the process exit status alone: `adb shell` does
   not forward the remote exit status on older platform-tools.
5. Pass the raw `service.log` block through to the log pane unparsed.
