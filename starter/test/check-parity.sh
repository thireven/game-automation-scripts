#!/usr/bin/env bash
# Proves the two host layers read the device protocol the same way.
#
# Two modes, and the first one needs no hardware:
#
#   check-parity.sh            synthetic -- parse a canned protocol reply in
#                              both languages and compare the results
#   check-parity.sh --live S   also run a real `probe` against serial S through
#                              both hosts and diff the keys that matter
#
# Run it after touching PROTOCOL.md, gap-device.sh, gap-device.ps1 or
# gap-device.sh's parsing helpers.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$(cd "$here/.." && pwd)"
export BUNDLE

LIVE_SERIAL=""
[ "${1:-}" = "--live" ] && LIVE_SERIAL="${2:-}"

fails=0
check() {   # check <label> <got> <want>
  if [ "$2" = "$3" ]; then
    printf '  ok    %-34s %s\n' "$1" "$2"
  else
    printf '  FAIL  %-34s got [%s] want [%s]\n' "$1" "$2" "$3"
    fails=$((fails + 1))
  fi
}

# shellcheck source=../bin/posix/gap-device.sh
. "$BUNDLE/bin/posix/gap-device.sh"

SAMPLE='proto=1
device_abi=arm64-v8a
running=0
installed=1
step=staged
step=kill
step=launch
---BEGIN service.log---
line one
line two
---END service.log---
running=1
rc=0'

echo
echo "POSIX host -- synthetic protocol parse"
check "proto"            "$(kv "$SAMPLE" proto)"       "1"
# The device script emits `running` before and after the launch. Reading the
# first one would report every successful start as a failure.
check "running (last wins)" "$(kv "$SAMPLE" running)"  "1"
check "device_abi"       "$(kv "$SAMPLE" device_abi)"  "arm64-v8a"
check "installed"        "$(kv "$SAMPLE" installed)"   "1"
check "missing key"      "$(kv "$SAMPLE" nosuchkey)"   ""
check "rc"               "$(kv "$SAMPLE" rc)"          "0"
check "log block"        "$(extract_log "$SAMPLE" | tr '\n' '|')" "line one|line two|"

if proto_ok "$SAMPLE" >/dev/null 2>&1; then
  check "proto_ok accepts 1" "yes" "yes"
else
  check "proto_ok accepts 1" "no" "yes"
fi
if proto_ok 'proto=9
rc=0' >/dev/null 2>&1; then
  check "proto_ok rejects 9" "accepted" "rejected"
else
  check "proto_ok rejects 9" "rejected" "rejected"
fi

# The release manifest tools/package-release.sh publishes. Deliberately the
# same key=value shape as the device protocol so kv/Get-Kv read it too, rather
# than a second parser in two languages. Keys use `_` and never `.`: the POSIX
# kv interpolates the key straight into a sed pattern while Get-Kv escapes it,
# so a regex metacharacter would be the one thing the two could disagree on.
MANIFEST='version=0.13
commit=abc1234
apk_universal=gap-universal.apk
sha256_universal=1111111111111111111111111111111111111111111111111111111111111111
apk_arm64-v8a=gap-arm64-v8a.apk
sha256_arm64-v8a=2222222222222222222222222222222222222222222222222222222222222222
apk_x86_64=gap-x86_64.apk
sha256_x86_64=3333333333333333333333333333333333333333333333333333333333333333'

echo
echo "POSIX host -- release manifest parse"
check "version"          "$(kv "$MANIFEST" version)"           "0.13"
check "apk by abi"       "$(kv "$MANIFEST" apk_arm64-v8a)"     "gap-arm64-v8a.apk"
check "sha by abi"       "$(kv "$MANIFEST" sha256_arm64-v8a)"  "2222222222222222222222222222222222222222222222222222222222222222"
# Every 64-bit ABI gets its own APK, so no device has to pick one out of the
# fat build -- an emulator that translates ARM picks arm64 on x86_64 hardware.
check "apk x86_64"       "$(kv "$MANIFEST" apk_x86_64)"        "gap-x86_64.apk"
check "universal fallback" "$(kv "$MANIFEST" apk_universal)"   "gap-universal.apk"
check "absent abi"       "$(kv "$MANIFEST" apk_armeabi-v7a)"   ""

# The adb pin, platform-tools.txt: the real file, not a sample, since what is
# under test is that the shipped pin is whole. Each host reads it with its own
# kv, and a URL or checksum only one of them could read would download adb
# unverified on that platform.
PT_REV="$(pt_kv revision)"
echo
echo "POSIX host -- adb pin (platform-tools.txt)"
check "revision"         "$(printf '%s' "$PT_REV" | grep -cE '^[0-9]+\.[0-9]+(\.[0-9]+)?$')" "1"
for os in windows darwin linux; do
  # The pinned URL has to name the pinned revision, or the checksum is for
  # some other archive than the one the revision line claims.
  check "url $os names r$PT_REV" \
        "$(pt_kv "url_$os" | grep -cE "^https://dl\.google\.com/.*platform-tools_r$PT_REV-")" "1"
  check "sha256 $os is 64 hex" \
        "$(pt_kv "sha256_$os" | grep -cE '^[0-9a-f]{64}$')" "1"
  check "size $os is a number" \
        "$(pt_kv "size_$os" | grep -cE '^[0-9]+$')" "1"
done

# ------------------------------------------------- the same, in PowerShell
# Synthetic too, so parity is a gate on every machine with PowerShell rather
# than only when a device is plugged in.
find_powershell() {
  for p in "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" \
           "$(command -v pwsh 2>/dev/null)"; do
    [ -n "$p" ] && [ -x "$p" ] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}
# -m, not -w: forward slashes, which PowerShell accepts on Windows and which
# are the only separator that works if pwsh is installed on a Mac. cygpath is
# absent there, so the fallback hands back the path unchanged.
winbundle() { cygpath -m "$BUNDLE" 2>/dev/null || printf '%s' "$BUNDLE"; }

PSH="$(find_powershell || true)"
echo
if [ -z "$PSH" ]; then
  echo "PowerShell host -- skipped (no powershell.exe or pwsh here)"
else
  echo "PowerShell host -- same two samples through Get-Kv"
  # The samples travel in the environment, not in the command text: a
  # PowerShell here-string has to close on `'@` at column 0, which no indented
  # -Command string can offer, and quoting multi-line text through two shells
  # is how a parity gate ends up testing its own escaping.
  export GAP_T_SAMPLE="$SAMPLE" GAP_T_MANIFEST="$MANIFEST"
  # One process for all of it: starting PowerShell costs about a second.
  ps_vals="$("$PSH" -NoProfile -ExecutionPolicy Bypass -Command "
    . '$(winbundle)/bin/win/gap-device.ps1'
    # A failed dot-source is not fatal to PowerShell, so the sentinel has to
    # prove the functions actually arrived rather than that the line ran.
    if (-not (Get-Command Get-Kv -ErrorAction SilentlyContinue)) { exit 1 }
    \$s = \$env:GAP_T_SAMPLE
    \$m = \$env:GAP_T_MANIFEST
    Write-Output 'PSOK'
    Get-Kv \$s 'proto'
    Get-Kv \$s 'running'
    Get-Kv \$s 'device_abi'
    Get-Kv \$s 'nosuchkey'
    Get-Kv \$m 'version'
    Get-Kv \$m 'apk_arm64-v8a'
    Get-Kv \$m 'sha256_arm64-v8a'
    Get-Kv \$m 'apk_universal'
    Get-Kv \$m 'apk_armeabi-v7a'
    (Get-LogBlock \$s) -replace \"\`n\", '|'
    Write-Output \$global:DeviceStorage
    Write-Output \$global:LastDeviceName
    \$b = '$(winbundle)'
    Get-PlatformToolsPin -Bundle \$b -Key 'revision'
    Get-PlatformToolsPin -Bundle \$b -Key 'url_windows'
    Get-PlatformToolsPin -Bundle \$b -Key 'sha256_windows'
    Get-PlatformToolsPin -Bundle \$b -Key 'size_windows'
  " 2>/dev/null | tr -d '\r')"
  unset GAP_T_SAMPLE GAP_T_MANIFEST

  psline() { printf '%s\n' "$ps_vals" | sed -n "${1}p"; }

  # The sentinel separates "PowerShell disagreed" from "PowerShell could not
  # load the Windows host at all" -- the latter is what pwsh on a Mac does, and
  # it is a skip, not ten failures. Values start on line 2 because of it.
  if [ "$(psline 1)" != "PSOK" ]; then
    echo "  (this PowerShell cannot load bin/win/gap-device.ps1 -- skipping."
    echo "   That layer only ever ships to Windows, so this is not a failure.)"
  else
    check "ps proto"            "$(psline 2)"  "$(kv "$SAMPLE" proto)"
    check "ps running"          "$(psline 3)"  "$(kv "$SAMPLE" running)"
    check "ps device_abi"       "$(psline 4)"  "$(kv "$SAMPLE" device_abi)"
    check "ps missing key"      "$(psline 5)"  "$(kv "$SAMPLE" nosuchkey)"
    check "ps version"          "$(psline 6)"  "$(kv "$MANIFEST" version)"
    check "ps apk by abi"       "$(psline 7)"  "$(kv "$MANIFEST" apk_arm64-v8a)"
    check "ps sha by abi"       "$(psline 8)"  "$(kv "$MANIFEST" sha256_arm64-v8a)"
    check "ps universal"        "$(psline 9)"  "$(kv "$MANIFEST" apk_universal)"
    check "ps absent abi"       "$(psline 10)" "$(kv "$MANIFEST" apk_armeabi-v7a)"
    # extract_log's output ends in a newline and Get-LogBlock's does not, so the
    # trailing separator is an artefact of this comparison, not a disagreement.
    check "ps log block"        "$(psline 11)" "$(extract_log "$SAMPLE" | tr '\n' '|' | sed 's/|$//')"
    # Not protocol, but the same kind of hazard: the two hosts each name the
    # storage root themselves, and only one of them being wrong is invisible
    # until a copy comes back empty on that platform.
    check "ps storage root"     "$(psline 12)" "$DEVICE_STORAGE"
    # Likewise the file the chosen device is kept in: both hosts run out of
    # the same bundle folder, so a Windows pick has to be what Git Bash reads.
    check "ps last-device file" "$(psline 13)" "$LAST_DEVICE_NAME"
    # And the adb pin: a Windows user's download is only as verified as what
    # Get-Kv makes of the same file.
    check "ps pin revision"     "$(psline 14)" "$PT_REV"
    check "ps pin url"          "$(psline 15)" "$(pt_kv url_windows)"
    check "ps pin sha256"       "$(psline 16)" "$(pt_kv sha256_windows)"
    check "ps pin size"         "$(psline 17)" "$(pt_kv size_windows)"
  fi
fi

# ---------------------------------------------------------- the bundle's apk/
# Not the device protocol, but the same hazard: both hosts pick an APK out of
# apk/ themselves, and only one of them being wrong is invisible until someone
# installs the wrong ABI. The rule under test is that the fat APK is a fallback
# and never a match -- claiming otherwise is what told an x86_64 emulator to
# reinstall the APK that had just resolved to lib/arm64.
APK_FIX="${TMPDIR:-/tmp}/gap-parity-apk.$$"
trap 'rm -rf "$APK_FIX"' EXIT
mkdir -p "$APK_FIX/apk"
for n in universal arm64-v8a x86_64; do : > "$APK_FIX/apk/gap-0.13-abc1234-$n.apk"; done

# find_apk_* read $BUNDLE, which the gates below still need.
REAL_BUNDLE="$BUNDLE"
BUNDLE="$APK_FIX"
apk_name() {  # apk_name <finder> <abi>
  an_hit="$("$1" "$2" 2>/dev/null || true)"
  [ -n "$an_hit" ] && basename "$an_hit" || echo NONE
}
# The picker numbers this list, so the two hosts disagreeing on its order would
# put a different APK behind the same digit on the two platforms.
choice_names() { apk_choices "$1" | while IFS= read -r f; do printf '%s|' "$(basename "$f")"; done | sed 's/|$//'; }

ORDER_PLAIN="gap-0.13-abc1234-arm64-v8a.apk|gap-0.13-abc1234-universal.apk|gap-0.13-abc1234-x86_64.apk"
ORDER_FIRST="gap-0.13-abc1234-x86_64.apk|gap-0.13-abc1234-arm64-v8a.apk|gap-0.13-abc1234-universal.apk"

echo
echo "POSIX host -- apk/ matching"
check "exact x86_64"        "$(apk_name find_apk_exact x86_64)"       "gap-0.13-abc1234-x86_64.apk"
check "exact arm64"         "$(apk_name find_apk_exact arm64-v8a)"    "gap-0.13-abc1234-arm64-v8a.apk"
check "fat is not a match"  "$(apk_name find_apk_exact armeabi-v7a)"  "NONE"
check "fat is a fallback"   "$(apk_name find_apk_for armeabi-v7a)"    "gap-0.13-abc1234-universal.apk"
check "choice order"        "$(choice_names '')"                      "$ORDER_PLAIN"
check "detected goes first" "$(choice_names "$(find_apk_exact x86_64)")" "$ORDER_FIRST"
BUNDLE="$REAL_BUNDLE"

if [ -n "$PSH" ]; then
  ps_apk="$("$PSH" -NoProfile -ExecutionPolicy Bypass -Command "
    . '$(winbundle)/bin/win/gap-device.ps1'
    if (-not (Get-Command Find-ApkExact -ErrorAction SilentlyContinue)) { exit 1 }
    \$b = '$(cygpath -m "$APK_FIX" 2>/dev/null || printf '%s' "$APK_FIX")'
    function N(\$p) { if (\$p) { Split-Path -Leaf \$p } else { 'NONE' } }
    Write-Output 'PSOK'
    N (Find-ApkExact -Abi 'x86_64'      -Bundle \$b)
    N (Find-ApkExact -Abi 'arm64-v8a'   -Bundle \$b)
    N (Find-ApkExact -Abi 'armeabi-v7a' -Bundle \$b)
    N (Find-ApkFor   -Abi 'armeabi-v7a' -Bundle \$b)
    ((Get-ApkChoices -First '' -Bundle \$b) | ForEach-Object { Split-Path -Leaf \$_ }) -join '|'
    ((Get-ApkChoices -First (Find-ApkExact -Abi 'x86_64' -Bundle \$b) -Bundle \$b) | ForEach-Object { Split-Path -Leaf \$_ }) -join '|'
  " 2>/dev/null | tr -d '\r')"
  psapk() { printf '%s\n' "$ps_apk" | sed -n "${1}p"; }
  echo
  if [ "$(psapk 1)" != "PSOK" ]; then
    echo "PowerShell host -- apk/ matching skipped (cannot load bin/win/gap-device.ps1)"
  else
    echo "PowerShell host -- same apk/ folder"
    check "ps exact x86_64"       "$(psapk 2)" "gap-0.13-abc1234-x86_64.apk"
    check "ps exact arm64"        "$(psapk 3)" "gap-0.13-abc1234-arm64-v8a.apk"
    check "ps fat is not a match" "$(psapk 4)" "NONE"
    check "ps fat is a fallback"  "$(psapk 5)" "gap-0.13-abc1234-universal.apk"
    check "ps choice order"       "$(psapk 6)" "$ORDER_PLAIN"
    check "ps detected first"     "$(psapk 7)" "$ORDER_FIRST"
  fi
fi

# The device script itself must stay POSIX and free of CR, or mksh rejects it
# line by line on the device.
echo
echo "device script -- portability gates"
# NOT a grep for CR: Git Bash opens files in text mode and strips CR before
# the pattern sees it, so a grep test passes even on a file that mksh would
# reject line by line on the device.
has_cr() { ! LC_ALL=C tr -d '\r' < "$1" | cmp -s - "$1"; }
if has_cr "$BUNDLE/device/gap-service.sh"; then
  check "no CR in gap-service.sh" "CR present" "clean"
else
  check "no CR in gap-service.sh" "clean" "clean"
fi
if sh -n "$BUNDLE/device/gap-service.sh" 2>/dev/null; then
  check "POSIX sh -n" "ok" "ok"
else
  check "POSIX sh -n" "failed" "ok"
fi
bad="$(grep -nE '\[\[|\bmapfile\b|<<<|\$\{[A-Za-z_]+//' "$BUNDLE/device/gap-service.sh" \
       | grep -v '^9:' | head -3)"
check "no bashisms" "${bad:-none}" "none"

# The watch verb against a scratch watch dir, with getprop stubbed: the files
# it reads and writes are the engine contract (PROTOCOL.md § watch).
echo
echo "device script -- watch verb (synthetic)"
WATCH_FIX="${TMPDIR:-/tmp}/gap-parity-watch.$$"
mkdir -p "$WATCH_FIX/bin" "$WATCH_FIX/dir"
printf '#!/bin/sh\n[ "$1" = sys.boot_completed ] && echo 1\n' > "$WATCH_FIX/bin/getprop"
chmod +x "$WATCH_FIX/bin/getprop"
printf '1700000000 1 4242\n' > "$WATCH_FIX/dir/alive"
printf '1700000005 slow\n' > "$WATCH_FIX/dir/request"
printf '1700000006 4.3\n' > "$WATCH_FIX/dir/updating"
watch_verb() { PATH="$WATCH_FIX/bin:$PATH" GAP_WATCH_DIR="$WATCH_FIX/dir" sh "$BUNDLE/device/gap-service.sh" watch "$@"; }
W="$(watch_verb --emulator mumu)"
check "watch proto"            "$(kv "$W" proto)"         "1"
check "watch booted"           "$(kv "$W" booted)"        "1"
check "watch running"          "$(kv "$W" running)"       "0"
check "watch alive"            "$(kv "$W" alive)"         "1700000000"
check "watch alive_active"     "$(kv "$W" alive_active)"  "1"
check "watch request"          "$(kv "$W" request)"       "1700000005 slow"
check "watch updating"         "$(kv "$W" updating)"      "1700000006 4.3"
check "watch rc"               "$(kv "$W" rc)"            "0"
check "watch stamped"          "$(kv "$W" stamped)"       "1"
check "watch no err"           "$(kv "$W" err)"           ""
check "watch writes stamp"     "$(cat "$WATCH_FIX/dir/stamp" 2>/dev/null)" "$(kv "$W" now)"
check "watch --emulator"       "$(cat "$WATCH_FIX/dir/emulator" 2>/dev/null)" "mumu"
check "request kept w/o take"  "$([ -f "$WATCH_FIX/dir/request" ] && echo kept || echo gone)" "kept"
W="$(watch_verb --take)"
check "--take still reports"   "$(kv "$W" request)"       "1700000005 slow"
check "--take removes it"      "$([ -f "$WATCH_FIX/dir/request" ] && echo kept || echo gone)" "gone"
check "--take says taken"      "$(kv "$W" taken)"         "1"
W="$(watch_verb)"
check "no request is empty"    "$(kv "$W" request)"       ""
W="$(watch_verb --emulator 'mu mu')"
check "bad emulator refused"   "$(kv "$W" err)/$(kv "$W" rc)" "bad-usage/2"
# A dir the shell user cannot write (made by the engine as root): every write
# fails, and the poll says so. chmod is stubbed to fail, as it does on a dir we
# do not own. Skipped as root, which writes anyway.
if [ "$(id -u)" != 0 ]; then
  printf '1700000005 slow\n' > "$WATCH_FIX/dir/request"
  printf '1\n' > "$WATCH_FIX/dir/stamp"    # stale, so a same-second poll cannot match
  chmod 444 "$WATCH_FIX/dir/stamp"
  chmod 555 "$WATCH_FIX/dir"
  printf '#!/bin/sh\nexit 1\n' > "$WATCH_FIX/bin/chmod"
  /bin/chmod +x "$WATCH_FIX/bin/chmod"
  W="$(watch_verb --take)"
  check "locked: take fails"     "$(kv "$W" taken)/$(kv "$W" rc)" "0/1"
  check "locked: request kept"   "$([ -f "$WATCH_FIX/dir/request" ] && echo kept || echo gone)" "kept"
  check "locked: err"            "$(kv "$W" err)"           "watch-dir-unwritable"
  W="$(watch_verb)"
  check "locked: not stamped"    "$(kv "$W" stamped)/$(kv "$W" rc)" "0/0"
  rm -f "$WATCH_FIX/bin/chmod"
  chmod 755 "$WATCH_FIX/dir"
fi
rm -rf "$WATCH_FIX"

# ------------------------------------------------------------------ live run
if [ -n "$LIVE_SERIAL" ]; then
  echo
  echo "live probe against $LIVE_SERIAL"
  resolve_adb || exit 1
  posix_out="$(invoke_verb "$LIVE_SERIAL" probe)"

  ps_out=""
  for psh in \
    "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" \
    "$(command -v pwsh 2>/dev/null)"; do
    [ -n "$psh" ] && [ -x "$psh" ] || continue
    ps_out="$("$psh" -NoProfile -ExecutionPolicy Bypass -Command "
      . '$(cygpath -w "$BUNDLE" 2>/dev/null || echo "$BUNDLE")\bin\win\gap-device.ps1'
      if (Resolve-Adb -Bundle '$(cygpath -w "$BUNDLE" 2>/dev/null || echo "$BUNDLE")') {
        Invoke-Verb -Serial '$LIVE_SERIAL' -Verb 'probe' -Bundle '$(cygpath -w "$BUNDLE" 2>/dev/null || echo "$BUNDLE")'
      }" 2>/dev/null | tr -d '\r')"
    break
  done

  if [ -z "$ps_out" ]; then
    echo "  (no PowerShell here -- comparing the POSIX host against itself only)"
    ps_out="$posix_out"
  fi

  for k in proto device_abi abi libdir loader stamp installed running; do
    check "$k" "$(kv "$posix_out" "$k")" "$(printf '%s\n' "$ps_out" | sed -n "s/^$k=//p" | tail -1)"
  done

  # And against the script this was extracted from, which is the real question:
  # does the relocated algorithm still agree with tools/start-service.sh?
  repo_start="$BUNDLE/../../start-service.sh"
  if [ -f "$repo_start" ]; then
    echo
    echo "  cross-check against tools/start-service.sh (abi/loader/libs):"
    "$repo_start" --serial "$LIVE_SERIAL" 2>/dev/null | sed -n '1,6p' | sed 's/^/    /'
    echo "    device script says: abi=$(kv "$posix_out" abi) loader=$(kv "$posix_out" loader)"
    echo "                        libdir=$(kv "$posix_out" libdir)"
  fi
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "all checks passed"
  exit 0
fi
echo "$fails check(s) FAILED"
exit 1
