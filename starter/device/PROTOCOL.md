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

A service running under another uid — the app's own root launch — is out of
reach of both `start` and `stop`: it cannot be killed from here, and a second
launch beside it would sit inert with the socket name taken. Both refuse with
`err=not-ours` rather than pretend. `start` still answers `already-running`
for it when the stamp matches and `--force` is absent.

Flags: `--force` (restart a service already running from this build),
`--tcp PORT`, `--script ID`. Passing `--tcp` or `--script` implies `--force`,
because the running service was not started with them.

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

## Rules for a host implementation

1. Assert `proto=1`.
2. Strip `\r` from every line.
3. Take the **last** `running=` as the verdict — `start` emits it twice.
4. Read `rc=` for success, never the process exit status alone: `adb shell` does
   not forward the remote exit status on older platform-tools.
5. Pass the raw `service.log` block through to the log pane unparsed.
