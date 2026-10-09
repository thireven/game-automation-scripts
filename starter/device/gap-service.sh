#!/system/bin/sh
# The General Automation Platform service launcher, run ON the device.
#
# This is tools/start-service.sh's algorithm, relocated. Every step of it was
# already an `adb shell` call against this shell, so hosting it here means the
# logic exists once -- the Windows and POSIX front-ends only push this file and
# read its output -- and one launch costs one round trip instead of ten.
#
# Written for Android's mksh/toybox: strict POSIX, no [[ ]], no arrays, no
# bashisms. It must also arrive with LF line endings; a CR makes mksh fail on
# every line (see .gitattributes).
#
# Usage:  sh gap-service.sh <probe|start|stop|log|clean> [--force] [--tcp PORT]
#                                                        [--script ID]
#
# Output is key=value lines plus sentinel-delimited raw blocks. See PROTOCOL.md.

PROTO=1
PACKAGE=com.generalautomation.platform
# The app's id before the rename; its service would hold the socket name.
LEGACY_PACKAGE=com.gameautomation.platform
STAGE_DIR=/data/local/tmp/gap

VERB=""
FORCE=""
TCP_PORT=""
SCRIPT_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    probe|start|stop|log|clean) VERB="$1"; shift ;;
    --force)  FORCE=1; shift ;;
    --tcp)    TCP_PORT="$2"; shift 2 ;;
    --script) SCRIPT_ID="$2"; shift 2 ;;
    *) echo "proto=$PROTO"; echo "err=bad-usage"; echo "msg=unknown option: $1"
       echo "rc=2"; exit 2 ;;
  esac
done
[ -n "$VERB" ] || VERB=probe

echo "proto=$PROTO"

# `Mai[n]` is the same pattern to pgrep/pkill and a different string in the argv
# of the shell running it, which is what stops -f matching that shell as well.
service_running() { pgrep -f "$PACKAGE.Mai[n]" >/dev/null 2>&1; }

# The uid the running service belongs to; empty when none runs.
service_uid() {
  pid=$(pgrep -f "$PACKAGE.Mai[n]" 2>/dev/null | head -1)
  [ -n "$pid" ] && stat -c %u "/proc/$pid" 2>/dev/null
}

# A rooted device's app starts the service itself, as uid 0. From the adb
# shell that one can neither be killed nor replaced -- a second launch would
# come up beside it and sit inert, the socket name already taken -- so the
# verbs that would try say so instead.
foreign_service() {
  [ "$(id -u)" != 0 ] || return 1
  uid=$(service_uid)
  [ -n "$uid" ] && [ "$uid" != "$(id -u)" ]
}

fail_foreign() {
  fail not-ours "the service on this device was started by the app itself (uid $(service_uid)), and this tool cannot stop or replace it. On a rooted device the app manages the service; a reboot stops it."
}

# Whether this uid can write what a stage writes: the dir and its lib/.
stage_writable() {
  [ -w "$STAGE_DIR" ] && { [ ! -d "$STAGE_DIR/lib" ] || [ -w "$STAGE_DIR/lib" ]; }
}

# The same app leaves $STAGE_DIR owned by root, which this uid cannot write
# into or empty -- but can rename, the parent being its own. So a stage dir we
# cannot write is moved aside and a fresh one made; the app sweeps the aside
# copies next time it launches as root.
discard_stage_dir() {
  [ -e "$STAGE_DIR" ] || return 0
  rm -rf "$STAGE_DIR" 2>/dev/null
  [ -e "$STAGE_DIR" ] || return 0
  mv "$STAGE_DIR" "$STAGE_DIR.stale.$$" 2>/dev/null
}

# fail <slug> <message> [rc]
fail() {
  echo "err=$1"
  echo "msg=$2"
  echo "rc=${3:-1}"
  exit "${3:-1}"
}

emit_log() {
  echo "---BEGIN service.log---"
  cat "$STAGE_DIR/service.log" 2>/dev/null
  echo ""
  echo "---END service.log---"
}

# --------------------------------------------- verbs needing no package lookup

if [ "$VERB" = clean ]; then
  discard_stage_dir
  echo "step=clean"
  echo "rc=0"
  exit 0
fi

if [ "$VERB" = log ]; then
  emit_log
  if service_running; then echo "running=1"; else echo "running=0"; fi
  echo "rc=0"
  exit 0
fi

if [ "$VERB" = stop ]; then
  if service_running; then
    if foreign_service; then echo "running=1"; fail_foreign; fi
    pkill -f "$PACKAGE.Mai[n]" >/dev/null 2>&1
    # The old process needs this gap to release the abstract socket name.
    sleep 1
    echo "step=kill"
  else
    echo "step=not-running"
  fi
  if service_running; then
    echo "running=1"
    fail stop-failed "the service is still running after the kill"
  fi
  echo "running=0"
  echo "rc=0"
  exit 0
fi

# ------------------------------------------------------------------- resolve

DEVICE_ABI=$(getprop ro.product.cpu.abi)
ABILIST=$(getprop ro.product.cpu.abilist)
[ -n "$ABILIST" ] || ABILIST="$DEVICE_ABI"
echo "device_abi=$DEVICE_ABI"
echo "abilist=$ABILIST"
echo "sdk=$(getprop ro.build.version.sdk)"
echo "release=$(getprop ro.build.version.release)"
echo "model=$(getprop ro.product.model)"

if service_running; then echo "running=1"; else echo "running=0"; fi

APK=$(pm path "$PACKAGE" 2>/dev/null | sed 's/^package://' | head -1)
if [ -z "$APK" ]; then
  # Reported, not fatal for probe: the host still renders the row, and offers
  # the bundled APK if it has one.
  echo "installed=0"
  if [ "$VERB" = probe ]; then echo "rc=0"; exit 0; fi
  fail not-installed "$PACKAGE is not installed on this device"
fi
echo "installed=1"
echo "apk=$APK"
BASE_DIR=$(dirname "$APK")

# Android names the native library directory after the *instruction set* rather
# than the ABI -- arm64-v8a becomes "arm64" and armeabi-v7a becomes "arm", while
# x86_64 happens to be spelled the same either way -- so $BASE_DIR/lib/$(getprop
# ro.product.cpu.abi) is only ever right on an x86 device. Walking the device's
# own preference order finds the one directory the install actually created.
arch_for() {
  case "$1" in
    arm64-v8a) echo arm64 ;;
    armeabi*)  echo arm ;;
    *)         echo "$1" ;;
  esac
}

# An emulator that translates foreign native code lists those ABIs too (an
# Apple-silicon image offers x86, MuMu offers arm). The translation is for app
# processes; a shell-launched app_process is the real CPU either way and could
# not dlopen a library for the other one, so those candidates are skipped.
family_of() {
  case "$1" in
    arm*) echo arm ;;
    x86*) echo x86 ;;
    *)    echo "$1" ;;
  esac
}

WANT_FAMILY=$(family_of "$DEVICE_ABI")
ABI=""
LIB_DIR=""
for abi in $(echo "$ABILIST" | tr ',' ' '); do
  [ "$(family_of "$abi")" = "$WANT_FAMILY" ] || continue
  candidate="$BASE_DIR/lib/$(arch_for "$abi")"
  if [ -d "$candidate" ]; then
    ABI="$abi"
    LIB_DIR="$candidate"
    break
  fi
done

if [ -z "$LIB_DIR" ]; then
  # An APK built for the wrong ABI still leaves that ABI's directory behind,
  # which asks for a rebuild; nothing under lib/ at all is extractNativeLibs.
  echo "libs_present=$(ls "$BASE_DIR/lib" 2>/dev/null | tr '\n' ' ')"
  if [ "$VERB" = probe ]; then echo "err=no-libs"; echo "rc=0"; exit 0; fi
  fail no-libs "no native libraries this device can load under $BASE_DIR/lib"
fi
echo "abi=$ABI"
echo "libdir=$LIB_DIR"

# Match the loader to the libraries that are there rather than to the device: an
# app installed 32-bit on a 64-bit device ships .so files app_process64 could not
# load. Only the last path segment may be looked at -- the randomised directory
# above it can contain "64" by chance.
case "${LIB_DIR##*/}" in
  *64) LOADER=app_process64 ;;
  *)   LOADER=app_process32 ;;
esac
[ -x "/system/bin/$LOADER" ] || LOADER=app_process
echo "loader=$LOADER"

# Size and mtime of the installed APK. Every install changes it, which is what
# makes "the build on the device" recognisable without hashing 30 MB over ADB.
STAMP=$(stat -c '%s:%Y' "$APK" 2>/dev/null)
STAGED=$(cat "$STAGE_DIR/stamp" 2>/dev/null)
echo "stamp=$STAMP"
echo "staged=$STAGED"

ARGS=""
[ -n "$TCP_PORT" ]  && ARGS="$ARGS --listen-tcp=$TCP_PORT"
[ -n "$SCRIPT_ID" ] && ARGS="$ARGS --script=$SCRIPT_ID"
echo "args=$ARGS"

if [ "$VERB" = probe ]; then
  echo "rc=0"
  exit 0
fi

# --------------------------------------------------------------------- start

# Any option asks for something the running service was not started with, so
# taking one is itself a reason to restart.
[ -n "$ARGS" ] && FORCE=1

if [ -z "$FORCE" ] && [ "$STAMP" = "$STAGED" ] && service_running; then
  echo "step=already-running"
  echo "running=1"
  echo "rc=0"
  exit 0
fi

# Decided before anything is written: the kill below cannot reach it.
if foreign_service; then echo "running=1"; fail_foreign; fi

# A stage dir this uid cannot write is never launched from, matching stamp or
# not: the launch has to open its log there.
if [ -d "$STAGE_DIR" ] && ! stage_writable; then
  discard_stage_dir
  [ -e "$STAGE_DIR" ] && fail stage-failed "$STAGE_DIR belongs to another user and could not be moved aside"
  echo "step=stage-replaced"
  STAGED=""
fi

if [ "$STAMP" != "$STAGED" ]; then
  mkdir -p "$STAGE_DIR/lib" || fail stage-failed "could not create $STAGE_DIR/lib"
  cp -f "$APK" "$STAGE_DIR/gap.apk" || fail stage-failed "could not copy the APK into $STAGE_DIR"
  cp -f "$LIB_DIR"/*.so "$STAGE_DIR/lib/" || fail stage-failed "could not copy native libraries into $STAGE_DIR/lib"
  chmod -R 755 "$STAGE_DIR"
  # rm first: a stamp the app wrote as root can be unlinked here but not opened.
  rm -f "$STAGE_DIR/stamp"
  echo "$STAMP" > "$STAGE_DIR/stamp" || fail stage-failed "could not write $STAGE_DIR/stamp"
  echo "step=staged"
else
  echo "step=stage-skipped"
fi
[ -f "$STAGE_DIR/gap.apk" ] || fail stage-failed "could not stage the APK into $STAGE_DIR"

# Stop any previous instance so the socket is free. The sleep is the gap the old
# process needs to release the abstract socket name; binding it while the old one
# still holds it would leave a service nothing can talk to.
if service_running || pgrep -f "$LEGACY_PACKAGE.Mai[n]" >/dev/null 2>&1; then
  pkill -f "$PACKAGE.Mai[n]" >/dev/null 2>&1
  pkill -f "$LEGACY_PACKAGE.Mai[n]" >/dev/null 2>&1
  sleep 1
  echo "step=kill"
fi

# Same reason as the stamp: the launch truncates the log anyway, and a
# root-owned one would refuse to open.
rm -f "$STAGE_DIR/service.log"

# < /dev/null matches ServiceLauncher.kt and keeps the launch from ever blocking
# on a stdin adb is holding open.
CLASSPATH="$STAGE_DIR/gap.apk" LD_LIBRARY_PATH="$STAGE_DIR/lib" \
  nohup "$LOADER" /system/bin "$PACKAGE.Main" $ARGS \
  < /dev/null > "$STAGE_DIR/service.log" 2>&1 &
echo "step=launch"

sleep 3
emit_log

if service_running; then
  echo "running=1"
  echo "rc=0"
  exit 0
fi
echo "running=0"
fail launch-failed "the service exited immediately; see the log above"
