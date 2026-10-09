#!/usr/bin/env bash
# Host-side device operations for macOS and Linux. Sourced, not run.
#
# Everything specific to *this machine* lives here -- finding adb, discovering
# devices, pushing the device script. The launch algorithm itself is not here
# and must never be duplicated here: it is device/gap-service.sh, and this file
# only invokes it. See device/PROTOCOL.md.

PACKAGE="com.generalautomation.platform"
STAGE_DIR="/data/local/tmp/gap"
# Beside the stage dir, not in it: /data/local/tmp is the adb shell's own
# on every Android, while a rooted device's app makes the stage dir root's.
DEVICE_SCRIPT="/data/local/tmp/gap-service.sh"
PROTO_WANT=1

# The folder the app owns on shared storage -- Config.Storage.PARENT plus
# FOLDER in the app source, which tools/build-starter.sh gates this literal
# against. It is not a protocol key: copying and deleting a script's own files
# needs neither root nor the device script. A service started with --root=PATH
# needs GAP_STORAGE_ROOT set to the same path.
DEVICE_STORAGE="${GAP_STORAGE_ROOT:-/sdcard/Download/GeneralAutomationPlatform}"

# Where `update` looks for the published APKs. /releases/latest/download/ is a
# plain redirect to the newest non-draft release, so the asset names have to be
# stable -- tools/package-release.sh uploads gap-<abi>.apk beside the stamped
# ones for exactly this. No api.github.com, so no JSON to parse in sh and no
# 60-per-hour unauthenticated rate limit.
DEFAULT_RELEASE_BASE="https://github.com/game-automation-platform/game-automation-catalogue/releases/latest/download"
MANIFEST_NAME="gap-latest.txt"

# A pre-release channel: one line in channel.txt, the folder URL that holds a
# tester build's gap-latest.txt and APKs. `--channel URL` writes it, `--channel
# off` deletes it, and GAP_RELEASE_BASE still wins over both. Same shape as
# last-device.txt: beside the README, where a person can see and delete it.
CHANNEL_NAME="channel.txt"
CHANNEL_FILE="$BUNDLE/$CHANNEL_NAME"

saved_channel() { [ -f "$CHANNEL_FILE" ] && tr -d '\r' < "$CHANNEL_FILE" | head -1; }

RELEASE_BASE="${GAP_RELEASE_BASE:-$(saved_channel)}"
[ -n "$RELEASE_BASE" ] || RELEASE_BASE="$DEFAULT_RELEASE_BASE"

channel_active() { [ "$RELEASE_BASE" != "$DEFAULT_RELEASE_BASE" ]; }

# The folder a URL names. A tester is handed the catalogue's address, so a
# trailing .json or .txt is dropped: the manifest sits beside it. A query
# string is refused because "$RELEASE_BASE/<file>" cannot carry one.
channel_folder() {
  cf_url="${1%/}"
  case "$cf_url" in http://*|https://*) ;; *) return 1 ;; esac
  case "$cf_url" in *\?*|*\#*) return 1 ;; esac
  case "${cf_url#*://}" in */*) ;; *) return 1 ;; esac
  case "${cf_url##*/}" in *.json|*.txt) cf_url="${cf_url%/*}" ;; esac
  printf '%s' "$cf_url"
}

# A channel.txt written by hand, or by an older build, may hold the catalogue
# address (.../alpha.json); read it as the folder it sits in.
RELEASE_BASE="$(channel_folder "$RELEASE_BASE" || printf '%s' "$RELEASE_BASE")"

# set_channel <url|off> -- pins the channel, or returns to the release page.
set_channel() {
  if [ "$1" = off ]; then
    rm -f "$CHANNEL_FILE"
    RELEASE_BASE="$DEFAULT_RELEASE_BASE"
    log_line "release channel: back to the published releases"
    return 0
  fi
  sc_folder="$(channel_folder "$1")" || {
    log_line "error: --channel takes an http(s) folder URL with no ?query, or off."
    return 1
  }
  printf '%s\n' "$sc_folder" > "$CHANNEL_FILE"
  RELEASE_BASE="$sc_folder"
  log_line "release channel: $sc_folder (kept in $CHANNEL_NAME; --channel off undoes it)"
}

# The device chosen in the menu last time, so the same emulator is not picked
# again on every run. One line, its serial, beside the README where a person
# can see it and delete it. The menu writes it on every pick and reads it on
# start; the command line reads it when several devices are connected and
# --serial names none.
LAST_DEVICE_NAME="last-device.txt"
LAST_DEVICE_FILE="$BUNDLE/$LAST_DEVICE_NAME"

# Git Bash rewrites /data/local/tmp/... into a Windows path before adb sees it.
# Harmless everywhere else. (Same reason tools/env.sh sets it.)
export MSYS_NO_PATHCONV=1

ADB=""
ADB_SOURCE=""
ADB_WARNING=""

log_line() { printf '%s\n' "$*"; }

# ------------------------------------------------------------------ platform

host_os() {
  case "$(uname -s)" in
    Darwin)            echo darwin ;;
    Linux)             echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *)                 echo unknown ;;
  esac
}

# ----------------------------------------------------------------------- adb

# The bundle carries no adb. platform-tools.txt beside the README says where
# Google publishes it and what the archive must hash to; the first run
# downloads it into adb/<system>/, and every run after that finds it there.
PT_FILE="$BUNDLE/platform-tools.txt"
pt_kv() { kv "$(tr -d '\r' < "$PT_FILE" 2>/dev/null)" "$1"; }

# The tool's own adb, and what has to come out of the archive for it to run.
# adb.exe is a 32-bit MinGW build, which is why libwinpthread-1.dll travels
# with it. Start-Linux.sh under Git Bash lands on the windows case too.
own_adb() {
  case "$(host_os)" in
    windows) echo "$BUNDLE/adb/windows/adb.exe" ;;
    *)       echo "$BUNDLE/adb/$(host_os)/adb" ;;
  esac
}
adb_members() {
  case "$(host_os)" in
    windows) echo "adb.exe AdbWinApi.dll AdbWinUsbApi.dll libwinpthread-1.dll NOTICE.txt" ;;
    *)       echo "adb NOTICE.txt" ;;
  esac
}

# The major of "Version 37.0.0" in `adb version`. 0 when it cannot be read.
adb_revision() {
  "$1" version 2>/dev/null | sed -n 's/^Version \([0-9][0-9]*\)\..*/\1/p' | head -1
}

# Prefer the user's own adb when it is at least as new as ours. Two adb clients
# of different versions cannot share one server -- the newer kills the older's
# server and restarts it, which yanks the device out from under Android Studio
# or scrcpy. Using theirs when it is new enough means that never happens --
# and means a machine that already has a current adb never downloads one.
resolve_adb() {
  own="$(own_adb)"
  own_rev="$(adb_revision "$own")"
  # Nothing downloaded yet: measure theirs against what would be.
  [ -n "$own_rev" ] || own_rev="$(pt_kv revision)"
  own_rev="${own_rev%%.*}"
  [ -n "$own_rev" ] || own_rev=0

  if [ -n "${GAP_ADB:-}" ] && [ -x "$GAP_ADB" ]; then
    ADB="$GAP_ADB"; ADB_SOURCE="GAP_ADB"; return 0
  fi

  OLDER_ADB=""
  for cand in "$(command -v adb 2>/dev/null)" \
              "${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb" \
              "${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"; do
    [ -n "$cand" ] && [ -x "$cand" ] || continue
    rev="$(adb_revision "$cand")"
    [ -n "$rev" ] || continue
    if [ "$rev" -ge "$own_rev" ] 2>/dev/null; then
      ADB="$cand"; ADB_SOURCE="system r$rev"; return 0
    fi
    OLDER_ADB="$cand (r$rev)"
  done

  if [ ! -x "$own" ]; then
    download_adb || return 1
  fi
  ADB="$own"; ADB_SOURCE="downloaded r$own_rev"
  return 0
}

# Fetch Google's platform-tools for this computer into adb/<system>/ and keep
# adb out of it. Asks first: it is the one thing this tool ever downloads
# without being told to. --yes answers for a caller with no terminal.
download_adb() {
  os="$(host_os)"
  url="$(pt_kv "url_$os")"
  want="$(pt_kv "sha256_$os")"
  size="$(pt_kv "size_$os")"
  rev="$(pt_kv revision)"
  dir="$(dirname "$(own_adb)")"

  if [ -z "$url" ] || [ -z "$want" ]; then
    log_line "error: no adb found, and $PT_FILE"
    log_line "  does not say where to download one for $os. Re-extract the bundle, or set"
    log_line "  GAP_ADB to the full path of an adb you have."
    return 1
  fi
  # Google builds the Linux adb for x86_64 only.
  if [ "$os" = linux ]; then
    case "$(uname -m)" in
      x86_64|amd64) ;;
      *) log_line "error: no adb found, and Google publishes adb for Linux on x86_64 only --"
         log_line "  this is $(uname -m). Install your distribution's adb (apt install adb)"
         log_line "  and set GAP_ADB to its full path."
         return 1 ;;
    esac
  fi

  mb=$(( (${size:-0} + 524288) / 1048576 ))
  log_line "This tool needs Google's adb, and none is in this folder yet."
  log_line "  fetch : $url"
  [ "$mb" -gt 0 ] && log_line "  size  : about $mb MB"
  log_line "  into  : $dir"
  log_line "  check : sha256 from platform-tools.txt, recorded when this tool was built"
  log_line "Only adb is kept out of the archive; the rest is deleted."
  [ -n "$OLDER_ADB" ] && log_line "(An older adb is on this computer, $OLDER_ADB -- this tool wants r$rev or newer. Set GAP_ADB to use it anyway.)"
  if [ "${GAP_ASSUME_YES:-0}" != 1 ]; then
    if [ ! -t 0 ]; then
      log_line "Refusing to download without a confirmation -- add --yes, or set GAP_ADB."
      return 1
    fi
    printf '\n  download it now? [Y/n] '
    read -r ans || ans=""
    case "$ans" in
      ""|y|Y|yes|YES) : ;;
      *) log_line "Nothing was downloaded. Set GAP_ADB to the full path of an adb you have, or run this again."
         return 1 ;;
    esac
  fi

  if ! mkdir -p "$dir" 2>/dev/null || [ ! -w "$dir" ]; then
    log_line "error: cannot write into $dir."
    log_line "  Move this folder somewhere you can write to (Downloads, Desktop), or set GAP_ADB."
    return 1
  fi
  zip="$dir/platform-tools.zip"
  # Nothing half-done is left behind, not even the empty folder.
  discard_download() { rm -rf "$dir"; rmdir "$BUNDLE/adb" 2>/dev/null || true; }
  log_line "downloading platform-tools r$rev ..."
  if ! fetch_url "$url" "$zip"; then
    discard_download
    log_line "Could not download it. Check the internet connection, or set GAP_ADB to the"
    log_line "full path of an adb you have."
    return 1
  fi

  # Fail closed: this is a program about to be run, not a file to be looked at.
  got="$(sha256_of "$zip" 2>/dev/null || true)"
  if [ -z "$got" ]; then
    discard_download
    log_line "error: neither sha256sum nor shasum is here, so the download cannot be verified."
    log_line "  Nothing was kept. Install one of them, or set GAP_ADB."
    return 1
  fi
  if [ "$got" != "$want" ]; then
    discard_download
    log_line "The download did not match its checksum and was deleted. Nothing was kept."
    log_line "Try again; if it keeps failing, get the newest gap-starter-scripts bundle --"
    log_line "the pin in platform-tools.txt may be stale."
    return 1
  fi
  log_line "  sha256 ok"

  # shellcheck disable=SC2046
  if ! extract_members "$zip" "$dir" $(adb_members); then
    discard_download
    log_line "error: could not unpack it -- no unzip, bsdtar or python3 on this computer."
    log_line "  Install one (apt install unzip), or set GAP_ADB. Nothing was kept."
    return 1
  fi
  rm -f "$zip"
  for m in $(adb_members); do
    [ -f "$dir/$m" ] || { discard_download; log_line "error: the archive had no $m in it. Nothing was kept."; return 1; }
  done
  chmod +x "$(own_adb)" 2>/dev/null || true
  own_rev="$(adb_revision "$(own_adb)")"
  log_line "  adb r${own_rev:-?} is ready in ${dir#$BUNDLE/}"
  return 0
}

# extract_members <zip> <dir> <member>... -- the named files out of the
# archive's platform-tools/ folder, flat into <dir>, with whatever this
# computer has: unzip (macOS, most Linux), bsdtar (macOS's tar, some Linux),
# python3, or PowerShell for Start-Linux.sh under Git Bash on Windows.
extract_members() {
  em_zip="$1"; em_dir="$2"; shift 2

  if command -v unzip >/dev/null 2>&1; then
    for m in "$@"; do
      unzip -o -j -q "$em_zip" "platform-tools/$m" -d "$em_dir" >/dev/null 2>&1 || return 1
    done
    return 0
  fi

  em_tar=""
  if command -v bsdtar >/dev/null 2>&1; then em_tar=bsdtar
  elif tar --version 2>/dev/null | grep -q bsdtar; then em_tar=tar; fi
  if [ -n "$em_tar" ]; then
    em_list=""
    for m in "$@"; do em_list="$em_list platform-tools/$m"; done
    # shellcheck disable=SC2086
    "$em_tar" -xf "$em_zip" -C "$em_dir" --strip-components 1 $em_list >/dev/null 2>&1 || return 1
    return 0
  fi

  if [ "$(host_os)" = windows ]; then
    command -v powershell.exe >/dev/null 2>&1 || return 1
    em_tmp="$em_dir/_unpack"
    # .NET rather than Expand-Archive, for the reason gap-device.ps1 gives
    # at Get-Sha256: a script module a 5.1 under pwsh 7 cannot load.
    powershell.exe -NoProfile -NonInteractive -Command \
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('$(host_path "$em_zip")', '$(host_path "$em_tmp")')" \
      >/dev/null 2>&1 || { rm -rf "$em_tmp"; return 1; }
    for m in "$@"; do mv -f "$em_tmp/platform-tools/$m" "$em_dir/" 2>/dev/null || { rm -rf "$em_tmp"; return 1; }; done
    rm -rf "$em_tmp"
    return 0
  fi

  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$em_zip" "$em_dir" "$@" <<'PY' >/dev/null 2>&1 || return 1
import os, sys, zipfile
z, d, members = sys.argv[1], sys.argv[2], sys.argv[3:]
with zipfile.ZipFile(z) as zf:
    for m in members:
        with zf.open("platform-tools/" + m) as src, open(os.path.join(d, m), "wb") as dst:
            dst.write(src.read())
PY
  return 0
}

# macOS kills a quarantined binary outright: adb produces no output and dies
# with 137, which naively reads as "adb not found" -- the worst possible
# message. Name the real cause and the one-line cure.
check_adb_runs() {
  out="$("$ADB" version 2>/dev/null)"
  st=$?
  if [ -z "$out" ]; then
    if [ "$(host_os)" = darwin ]; then
      log_line "macOS blocked adb (Gatekeeper / quarantine), exit $st."
      log_line "Fix it once, in Terminal:"
      log_line "    xattr -dr com.apple.quarantine \"$BUNDLE\""
      log_line "Then run Start-Linux.sh again."
    else
      log_line "error: adb at $ADB produced no output (exit $st)."
    fi
    return 1
  fi
  return 0
}

adb_start_server() {
  err="$("$ADB" start-server 2>&1)"
  case "$err" in
    *"killing"*|*"doesn't match"*)
      ADB_WARNING="Replaced the running ADB server with $ADB_SOURCE. Android Studio, scrcpy or your emulator manager may briefly lose the device -- they reconnect automatically."
      ;;
  esac
  # Never `adb kill-server` on exit: leaving a working server behind is
  # strictly better than tearing down the user's other tools.
}

adb_s() { serial="$1"; shift; "$ADB" -s "$serial" "$@" 2>&1 | tr -d '\r'; }

# A local path as a native Windows binary will see it. MSYS_NO_PATHCONV above
# stops Git Bash rewriting paths -- right for the device side, wrong for this
# one, where /d/... resolves against the current drive and opens nothing.
# No-op off Windows, where cygpath does not exist.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# ------------------------------------------------------- the remembered device

recall_device() {
  [ -f "$LAST_DEVICE_FILE" ] || return 0
  head -n 1 "$LAST_DEVICE_FILE" 2>/dev/null | tr -d '\r\n'
}

# Best effort: a bundle on read-only media just forgets between runs.
remember_device() { printf '%s\n' "$1" > "$LAST_DEVICE_FILE" 2>/dev/null || true; }

# ----------------------------------------------------------------- discovery

# An emulator never registers itself with adb: it is a plain TCP endpoint that
# has to be connected to by port. Every family numbers its instances, so
# probing one port per family finds instance 0 and nothing else -- which is why
# a second emulator seems invisible and has to be installed to by hand.
#
#   MuMu 12/Nx  16384 + 32*i, and 5555 + 2*i
#   LDPlayer     5555 + 2*i
#   Nox         62001, then 62025 + i
#   MEmu        21503 + 10*i
#
# 7555 is MuMu's legacy port and every instance claims it, so the first one
# started binds it and the rest silently do not -- it can never stand in for a
# per-instance port. Four instances per family is the practical ceiling.
EMU_PORTS="16384 16416 16448 16480 7555 5555 5557 5559 5561 62001 62025 62026 62027 21503 21513 21523"

# An offline row is a connection whose adb handshake never finished: the port
# answered while the emulator's adbd did not (booting, wedged, restarting).
# adb never retries it, and `adb connect` on a serial already listed is a
# no-op -- so it sits in the server, which outlives this tool, and comes back
# on every Refresh looking like one more emulator. Kick those first: a port
# still open is dialed again below, a dead one just leaves. The kick is
# asynchronous, hence the short wait -- `adb connect` finding the corpse still
# listed would say "already connected" and dial nothing.
offline_serials() { list_devices | awk -F"$(printf '\t')" '$2 == "offline" { print $1 }'; }

reset_offline_devices() {
  stale="$(offline_serials | tr '\n' ' ')"
  [ -n "${stale% }" ] || return 0
  for s in $stale; do "$ADB" -s "$s" reconnect >/dev/null 2>&1; done
  i=0
  while [ "$i" -lt 10 ]; do
    left=""
    for s in $(offline_serials); do
      case " $stale" in *" $s "*) left=1 ;; esac
    done
    [ -n "$left" ] || break
    sleep 0.3
    i=$((i + 1))
  done
}

# Run the connects in parallel. A closed port refuses instantly, but an open
# port belonging to something that is not adb can stall the handshake for
# seconds, and serially that adds up to a Refresh nobody chooses twice.
probe_emulators() {
  reset_offline_devices
  # Waits on these pids only: a bare wait would also wait for any other
  # background job of this shell.
  pids=""
  for p in $EMU_PORTS ${GAP_EXTRA_PORTS:-}; do
    ( "$ADB" connect "127.0.0.1:$p" >/dev/null 2>&1 ) &
    pids="$pids $!"
  done
  for pid in $pids; do wait "$pid"; done
}

# serial<TAB>state<TAB>model -- every state kept, so the menu can explain an
# unauthorized or offline device rather than silently omitting it.
list_devices() {
  "$ADB" devices -l 2>/dev/null | tr -d '\r' | awk '
    NR > 1 && NF > 1 {
      serial = $1; state = $2; model = "";
      for (i = 3; i <= NF; i++) if ($i ~ /^model:/) { model = substr($i, 7); }
      gsub(/_/, " ", model);
      if (model == "") model = "-";
      print serial "\t" state "\t" model;
    }'
}

# One emulator can listen on several ports and shows up once per port. boot_id
# is per running device and identical across its ports, so it collapses those
# without hiding a genuine second device. (tools/deploy.sh lines 87-100.)
merge_duplicates() {
  seen="|"
  while IFS="$(printf '\t')" read -r serial state model; do
    [ -n "$serial" ] || continue
    if [ "$state" != device ]; then
      printf '%s\t%s\t%s\n' "$serial" "$state" "$model"
      continue
    fi
    id="$("$ADB" -s "$serial" shell cat /proc/sys/kernel/random/boot_id </dev/null 2>/dev/null | tr -d '\r\n')"
    [ -n "$id" ] || id="$serial"
    case "$seen" in *"|$id|"*) continue ;; esac
    seen="$seen$id|"
    printf '%s\t%s\t%s\n' "$serial" "$state" "$model"
  done
}

# ------------------------------------------------------- the device protocol

# invoke_verb <serial> <verb> [flags...] -> raw key=value output on stdout
invoke_verb() {
  serial="$1"; shift
  # host_path: under Git Bash adb is a native binary and cannot stat /d/...
  if ! "$ADB" -s "$serial" push "$(host_path "$BUNDLE/device/gap-service.sh")" "$DEVICE_SCRIPT" >/dev/null 2>&1; then
    printf 'proto=%s\nerr=push-failed\nmsg=could not push the device script to %s\nrc=1\n' \
      "$PROTO_WANT" "$serial"
    return 1
  fi
  # </dev/null or adb shell reads the terminal: an answer typed while an action
  # runs would be swallowed by adb instead of reaching the menu's next prompt.
  "$ADB" -s "$serial" shell "sh $DEVICE_SCRIPT $*" </dev/null 2>&1 | tr -d '\r'
}

# kv <output> <key> -- last occurrence wins, which is what makes `running`
# correct after a start (the script emits it before and after the launch).
kv() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | tail -1; }

proto_ok() {
  got="$(kv "$1" proto)"
  [ "$got" = "$PROTO_WANT" ] && return 0
  log_line "error: device script speaks proto '${got:-none}', this tool speaks $PROTO_WANT."
  log_line "The bundle is inconsistent -- re-extract it."
  return 1
}

# Everything between the sentinels, for the log pane.
extract_log() {
  printf '%s\n' "$1" | sed -n '/^---BEGIN service.log---$/,/^---END service.log---$/p' \
                     | sed '1d;$d'
}

# ------------------------------------------------------------------ the APK

# An APK in apk/ built for this ABI alone, or empty. Names may be anything; the
# ABI is matched as a substring, longest first so arm64-v8a beats armeabi-v7a.
# Separate from find_apk_for because this is the only one that answers "is
# there a build this device can load" -- the fallbacks below cannot.
find_apk_exact() {
  [ -d "$BUNDLE/apk" ] || return 1
  for f in "$BUNDLE"/apk/*"$1"*.apk; do
    [ -f "$f" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}

# Best APK in apk/ for a device ABI, or empty. The fat APK is a fallback and
# never a match: installing it leaves the ABI to the device, and an emulator
# that translates ARM picks arm64 on x86_64 hardware.
find_apk_for() {
  find_apk_exact "$1" && return 0
  for f in "$BUNDLE"/apk/*universal*.apk "$BUNDLE"/apk/*.apk; do
    [ -f "$f" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}

# Every APK in apk/, one per line, the given one first so the picker can offer
# it as choice 1. Newline-separated rather than word-separated: a name with a
# space in it is the operator's business, not a reason to split it in two.
apk_choices() {
  [ -n "$1" ] && printf '%s\n' "$1"
  for f in "$BUNDLE"/apk/*.apk; do
    [ -f "$f" ] || continue
    [ "$f" = "$1" ] || printf '%s\n' "$f"
  done
}

# A signature or downgrade mismatch is the one failure worth retrying, since the
# fix is always the same and the app's own state is a scripts folder on shared
# storage that the uninstall leaves alone. (tools/deploy.sh lines 158-163.)
install_apk() {
  serial="$1"; apk="$2"
  out="$("$ADB" -s "$serial" install -r "$apk" 2>&1 | tr -d '\r')"
  case "$out" in
    *Success*) printf '%s\n' "$out"; return 0 ;;
  esac
  case "$out" in
    *UPDATE_INCOMPATIBLE*|*VERSION_DOWNGRADE*|*SIGNATURE*)
      printf '%s\ninstall failed; uninstalling %s and retrying\n' "$out" "$PACKAGE"
      "$ADB" -s "$serial" uninstall "$PACKAGE" >/dev/null 2>&1
      "$ADB" -s "$serial" install "$apk" 2>&1 | tr -d '\r'
      return $?
      ;;
  esac
  printf '%s\n' "$out"
  return 1
}

# versionName of the installed app, or empty. Read with dumpsys rather than
# added to the probe reply on purpose: a new protocol key would mean touching
# device/gap-service.sh, PROTOCOL.md and PROTO_WANT, and this needs no root.
installed_version() {
  "$ADB" -s "$1" shell "dumpsys package $PACKAGE" 2>/dev/null \
    | tr -d '\r' | sed -n 's/^[[:space:]]*versionName=//p' | head -1
}

# ------------------------------------------------------ the Tsum Tsum library

# The catalogue GAP lists Tsum Tsum releases from. GAP ships with no
# third-party source, so the starter offers this one after an install.
SOURCE_URL="https://tsumtsumscripts.github.io/tsum-tsum-catalogue/catalogue.json"

# Opens GAP's gap://add-source link on the device; the player taps Add there.
# 0: the dialog is up. 1: am failed. 2: this GAP has no such link (an older
# one, which lists the library by itself).
offer_source() {
  os_out="$("$ADB" -s "$1" shell "am start -a android.intent.action.VIEW -d 'gap://add-source?url=$SOURCE_URL' -p $PACKAGE" 2>&1 | tr -d '\r')"
  case "$os_out" in
    *"unable to resolve"*) return 2 ;;
    *Error*|*Exception*) printf '%s\n' "$os_out"; return 1 ;;
  esac
  return 0
}

# --------------------------------------------------------- the published APK

# sha256sum is a GNU tool and macOS does not ship it; shasum comes with the
# system Perl there. Prints the bare digest.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

# --retry 2 and -f mirror tools/build-starter.sh, which fetches platform-tools
# the same way. -f matters most: without it a 404 body is written to the
# destination and the sha256 check is the only thing that catches it.
fetch_url() {
  url="$1"; dest="$2"

  # Git Bash's curl is a native Windows binary, so it needs the path the way
  # host_path writes it -- `-o /tmp/x` would otherwise open nothing at all.
  out="$(host_path "$dest")"

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 15 -o "$out" "$url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$out" "$url"
  else
    log_line "error: neither curl nor wget is installed; cannot download."
    return 1
  fi
}

# The release manifest, as protocol-shaped key=value text that kv() can read.
fetch_manifest() {
  tmp="${TMPDIR:-/tmp}/gap-latest.$$"
  fetch_url "$RELEASE_BASE/$MANIFEST_NAME" "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp"
  rm -f "$tmp"
}

# ------------------------------------------- a script's own files, on device

# device_files <serial> <name-glob> -- matching absolute paths, one per line.
# `find` is toybox and is on every Android this app runs on; the glob fallback
# covers the storage root and one level under it, which is where a script's
# own folder sits.
device_files() {
  # df_-prefixed because sh has no locals and `out` is a caller's variable.
  df_pat="$2"
  df_out="$(adb_s "$1" shell "find '$DEVICE_STORAGE' -type f -name '$df_pat' 2>/dev/null")"
  case "$df_out" in
    *"$DEVICE_STORAGE/"*) : ;;
    *) df_out="$(adb_s "$1" shell "ls -1d '$DEVICE_STORAGE/$df_pat' '$DEVICE_STORAGE'/*/'$df_pat' 2>/dev/null")" ;;
  esac
  # Real paths only: a missing `find`, a permission error and an unmatched glob
  # echoed back all arrive on the same stream.
  printf '%s\n' "$df_out" | grep "^$DEVICE_STORAGE/" | grep -v '[*?]'
}

# A serial as a folder name -- 127.0.0.1:16384 has a colon in it, and Windows
# refuses that.
safe_name() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'; }

# pull_file <serial> <device-path> <local-path>. What landed on disk is the
# verdict, not adb's exit status: `adb pull` writes progress to stderr and its
# status is not uniform across platform-tools revisions.
pull_file() {
  # Not `dest`: sh has no locals, and fetch_url and the callers here own a
  # variable of that name -- reusing it rewrote the caller's path mid-loop.
  serial="$1"; remote="$2"; to="$3"
  mkdir -p "$(dirname "$to")" 2>/dev/null || return 1
  rm -f "$to"
  "$ADB" -s "$serial" pull "$remote" "$(host_path "$to")" >/dev/null 2>&1
  [ -f "$to" ]
}

# delete_files <serial> -- device paths on stdin, one per line, removed in one
# call. It reports nothing about what went: `adb shell` does not forward the
# remote exit status on older platform-tools (PROTOCOL.md rule 4), so the
# caller re-lists instead.
delete_files() {
  serial="$1"
  quoted=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # Not quotable for the device shell, and not worth a second quoting scheme.
    case "$f" in *"'"*) continue ;; esac
    quoted="$quoted '$f'"
  done
  [ -n "$quoted" ] || return 0
  adb_s "$serial" shell "rm -f $quoted" >/dev/null 2>&1
}
