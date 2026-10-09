#!/usr/bin/env bash
# Assembles the standalone service-starter bundle.
#
# The bundle carries no adb: the tool downloads Google's platform-tools for
# the computer it is running on the first time it runs, verified against the
# checksums in starter/platform-tools.txt. That file is the pin. This
# script fetches the same three archives (cached in build/platform-tools/) to prove the pin still names real, unchanged bytes,
# and rewrites it with --record-sums when the revision is bumped.
#
# Two archives come out, and the .tar.gz is the one to hand to macOS users:
# tar does not propagate com.apple.quarantine, and Archive Utility does.
#
# --scripts-only leaves out the APKs: the same folder with only the scripts
# in it, a few hundred KB instead of ~40 MB. It is what a user who already has
# the full bundle extracts over it to pick up a starter fix, since an
# extracted bundle has no self-update. On its own it works exactly like the
# full bundle, less the APKs.
#
# --channel-url URL writes channel.txt into the bundle, so it starts pinned to a
# pre-release folder (see docs/PRERELEASE.md) and the tester passes no flag.
#
# The starter's website is served by tsum-stats, which the bundle downloads on
# first run like adb. --stats-pin FILE is that program's pin (default: the
# tsum-stats.txt of the tsum-stats checkout beside this repo, which its own
# release writes); it is copied in as tsum-stats.txt, and must name at least
# MIN_STATS, the first version that serves the starter.
#
# Bundles update their own scripts from the page. starter-version.txt (bump
# its version for every release) is copied in with update_url=<release
# URL>/starter.txt added; a --scripts-only build also writes that starter.txt
# beside the archives -- the version, and the .tar.gz's URL and sha256 -- and
# it is uploaded to the release with them. --release-url changes the base
# (default: this repo's latest GitHub release).
#
# Usage:
#   starter/build-starter.sh [--rev 37.0.1] [--apk-dir DIR] [--out DIR]
#                          [--archive-name NAME] [--scripts-only]
#                          [--channel-url URL] [--stats-pin FILE] [--release-url URL]
#                          [--no-download] [--record-sums]
set -euo pipefail

REV=""                # default: the revision platform-tools.txt pins
APK_DIR=""
OUT_DIR=""
ARCHIVE_NAME=""
NO_DOWNLOAD=""
RECORD_SUMS=""
SCRIPTS_ONLY=""
CHANNEL_URL=""
STATS_PIN=""
RELEASE_URL="https://github.com/TsumTsumScripts/tsum-tsum-script/releases/latest/download"
MIN_STATS="0.16"

while [[ $# -gt 0 ]]; do
  case "$1" in
    # A published platform-tools revision -- see repository2-3.xml. Moving
    # the pin needs --record-sums as well, since the checksums move with it.
    --rev)          REV="$2"; shift 2 ;;
    --apk-dir)      APK_DIR="$2"; shift 2 ;;
    --out)          OUT_DIR="$2"; shift 2 ;;
    # Basename of both archives, minus the extension. Also substituted into the
    # shipped README, so its macOS instructions name the file that was written.
    --archive-name) ARCHIVE_NAME="$2"; shift 2 ;;
    # No apk: just the scripts, to extract over a full bundle.
    --scripts-only) SCRIPTS_ONLY=1; shift ;;
    --channel-url)  CHANNEL_URL="$2"; shift 2 ;;
    --stats-pin)    STATS_PIN="$2"; shift 2 ;;
    --release-url)  RELEASE_URL="${2%/}"; shift 2 ;;
    --no-download)  NO_DOWNLOAD=1; shift ;;
    --record-sums)  RECORD_SUMS=1; shift ;;
    -h|--help) sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
# The GAP app checkout the gates compare against (Config.kt). Override with GAP_APP_DIR.
GAP_APP_DIR="${GAP_APP_DIR:-$root/../game-automation-app}"

SRC="$root/starter"
STAGE="$root/build/starter"
NAME="TsumTsum-Starter"
BUNDLE="$STAGE/$NAME"
[[ -n "$OUT_DIR" ]] || OUT_DIR="$root/build"
MANIFEST="$SRC/platform-tools.txt"

if [[ -n "$SCRIPTS_ONLY" && -n "$APK_DIR" ]]; then
  echo "error: --scripts-only carries no APK -- it does not take --apk-dir" >&2
  exit 2
fi

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

# Git Bash hands a native Windows Python paths like /d/work/..., which it
# resolves against the current drive as D:\d\work\... -- a directory that
# does not exist, so globs quietly match nothing and the step looks like it ran.
# Every path crossing into Python goes through this.
winpath() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }

die() { echo "error: $*" >&2; exit 1; }

# sha256sum is GNU coreutils and macOS does not ship it; shasum comes with the
# system Perl there. Prints the bare digest.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "neither sha256sum nor shasum is on PATH -- one of them is needed to verify platform-tools"
  fi
}

# The same reader the two hosts use on this file, so what the build verifies
# is what the tool will read. CR stripped: the working tree is on Windows.
kv() { tr -d '\r' < "$1" | sed -n "s/^$2=//p" | tail -1; }

# ------------------------------------------------------------------ download

PINNED_REV="$(kv "$MANIFEST" revision 2>/dev/null || true)"
[[ -n "$REV" ]] || REV="$PINNED_REV"
[[ -n "$REV" ]] || die "no --rev and ${MANIFEST#$root/} pins none"
if [[ "$REV" != "$PINNED_REV" && -z "$RECORD_SUMS" ]]; then
  die "${MANIFEST#$root/} pins r$PINNED_REV; moving to r$REV needs --record-sums as well"
fi
CACHE="$root/build/platform-tools/$REV"

# The pinned archives are "-win.zip" on Windows, unlike the floating
# "-latest-windows.zip" ones. Getting this wrong is a plain 404.
url_for() {
  local suffix="$1"
  [[ "$suffix" == windows ]] && suffix="win"
  echo "https://dl.google.com/android/repository/platform-tools_r$REV-$suffix.zip"
}

mkdir -p "$CACHE"
for os in windows darwin linux; do
  zipf="$CACHE/$os.zip"
  if [[ -f "$zipf" ]]; then
    echo "cached   : $os"
    continue
  fi
  [[ -n "$NO_DOWNLOAD" ]] && die "--no-download but $zipf is missing"
  echo "fetching : $os ($(url_for "$os"))"
  curl -fL --retry 2 -o "$zipf.part" "$(url_for "$os")" \
    || die "download failed for $os -- is revision '$REV' real?"
  mv -f "$zipf.part" "$zipf"
done

# The tool will download adb for every host, so the darwin build is checked
# for an arm64 slice here rather than found wanting on the first Apple Silicon
# Mac. `file` describes a fat binary across several lines with Mach-O flag
# lists in it; reduce it to which architectures are actually in there.
WORK="$STAGE/_extract"
rm -rf "$WORK"; mkdir -p "$WORK"
unzip -o -j -q "$CACHE/darwin.zip" platform-tools/adb -d "$WORK" \
  || die "platform-tools r$REV (darwin) has no member 'adb' -- the archive layout changed"
darwin_arch_line() {
  raw=""
  if command -v file >/dev/null 2>&1; then
    raw="$(file -b "$WORK/adb" 2>/dev/null | tr -d '\n')"
  fi
  if [[ -z "$raw" ]]; then
    # cafebabe = fat binary, feedfacf = thin 64-bit Mach-O.
    magic="$(od -An -tx4 -N4 "$WORK/adb" | tr -d ' \n')"
    case "$magic" in
      cafebabe|bebafeca) raw="Mach-O universal binary arm64 x86_64" ;;
      feedfacf|cffaedfe) raw="Mach-O 64-bit thin binary" ;;
      *) raw="unknown (magic $magic)" ;;
    esac
  fi

  arches=""
  [[ "$raw" == *arm64* ]]  && arches="arm64"
  [[ "$raw" == *x86_64* ]] && arches="${arches:+$arches + }x86_64"
  if [[ "$raw" == *universal* ]]; then
    echo "universal binary (${arches:-unknown})"
  else
    echo "single-architecture binary (${arches:-unknown})"
  fi
}
ADB_DARWIN_ARCH="$(darwin_arch_line)"
case "$ADB_DARWIN_ARCH" in
  *arm64*|*universal*) : ;;
  *) die "darwin adb is '$ADB_DARWIN_ARCH' -- no arm64 slice.
       Apple Silicon users would need Rosetta 2. Pin a different --rev." ;;
esac
echo "darwin   : $ADB_DARWIN_ARCH"

# What the archive says it is, so a pin cannot claim a revision it is not.
ADB_REVISION="$(unzip -p "$CACHE/windows.zip" platform-tools/source.properties 2>/dev/null \
                | sed -n 's/^Pkg.Revision=//p' | tr -d '\r')"
[[ -n "$ADB_REVISION" ]] || ADB_REVISION="$REV"
[[ "$ADB_REVISION" == "$REV" ]] \
  || die "the archives say Pkg.Revision=$ADB_REVISION, not $REV"
echo "adb rev  : $ADB_REVISION"

# A pinned revision is only reproducible if the bytes are pinned too. The
# pin is what ships: the tool reads this file to know what to fetch and what
# the bytes must hash to.
if [[ -n "$RECORD_SUMS" ]]; then
  {
    echo "# Where this tool's adb comes from."
    echo "#"
    echo "# Google publishes adb inside \"platform-tools\". The first time the tool runs"
    echo "# it downloads the archive for this computer from the URL below, checks it"
    echo "# against the sha256 here, keeps adb out of it (into adb/<system>/) and deletes"
    echo "# the rest. Nothing else is ever downloaded without being asked."
    echo "#"
    echo "# Bumping the revision: starter/build-starter.sh --rev <new> --record-sums"
    echo "# rewrites this file. Edit the checksums by hand and the download is refused."
    echo "revision=$ADB_REVISION"
    for os in windows darwin linux; do
      echo "url_$os=$(url_for "$os")"
      echo "sha256_$os=$(sha256_of "$CACHE/$os.zip")"
      echo "size_$os=$(wc -c < "$CACHE/$os.zip" | tr -d ' ')"
    done
  } > "$MANIFEST"
  echo
  echo "recorded the pin into ${MANIFEST#$root/} -- commit it:"
  grep -v '^#' "$MANIFEST" | sed 's/^/  /'
  echo
else
  for os in windows darwin linux; do
    [[ "$(kv "$MANIFEST" "url_$os")" == "$(url_for "$os")" ]] \
      || die "${MANIFEST#$root/} names another URL for $os (re-run with --record-sums if the revision changed on purpose)"
    [[ "$(kv "$MANIFEST" "sha256_$os")" == "$(sha256_of "$CACHE/$os.zip")" ]] \
      || die "platform-tools checksum mismatch for $os against ${MANIFEST#$root/} (re-run with --record-sums if the revision changed on purpose)"
  done
  echo "checksums: verified"
fi

# Only resolvable now: the default carries the adb revision the bundle pins.
if [[ -z "$ARCHIVE_NAME" ]]; then
  ARCHIVE_NAME="$NAME-$ADB_REVISION"
  [[ -z "$SCRIPTS_ONLY" ]] || ARCHIVE_NAME="$NAME-scripts"
fi

# ------------------------------------------------------------------ assemble

# Clear the contents, not the directory node. On Windows a process that once
# had this folder as its working directory keeps a handle on the node itself
# long after its files are gone, and `rm -rf "$BUNDLE"` then fails with EBUSY
# on an empty directory -- which under set -e ends the build with a message
# that says nothing about what is actually holding it. Emptying it is the same
# clean slate and cannot hit that.
mkdir -p "$BUNDLE"
find "$BUNDLE" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
[[ -z "$(ls -A "$BUNDLE" 2>/dev/null)" ]] \
  || die "could not empty $BUNDLE -- something is holding files in it"
cp -R "$SRC/." "$BUNDLE/"
# --apk-dir is the only source of APKs. A build left in the template tree would
# otherwise ride along and be offered to the operator as a choice.
rm -rf "$BUNDLE/apk"
# None of these is a template file: the adb the maintainer's own run of the
# tool downloaded into the tree, what they copied off a device, and which
# device they picked last. A bundle ships with no memory and no binaries.
rm -rf "$BUNDLE/adb" "$BUNDLE/collected" "$BUNDLE/last-device.txt" "$BUNDLE/channel.txt" "$BUNDLE/server" "$BUNDLE/.update"
# This script lives in starter/ but is the maintainer's, not the user's.
rm -f "$BUNDLE/build-starter.sh"

# The website's program: its pin, from the tsum-stats release.
[[ -n "$STATS_PIN" ]] || STATS_PIN="$root/../tsum-stats/tsum-stats.txt"
[[ -f "$STATS_PIN" ]] || die "no tsum-stats pin at $STATS_PIN (pass --stats-pin)"
STATS_VERSION="$(kv "$STATS_PIN" version)"
[[ "$(printf '%s\n%s\n' "$MIN_STATS" "$STATS_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" == "$MIN_STATS" ]] \
  || die "the tsum-stats pin names $STATS_VERSION; the starter website needs $MIN_STATS or newer -- release tsum-stats first"
cp "$STATS_PIN" "$BUNDLE/tsum-stats.txt"
echo "website  : tsum-stats $STATS_VERSION (downloaded on first run)"

# The scripts' own version, and where a bundle looks for a newer one.
STARTER_VERSION="$(kv "$SRC/starter-version.txt" version)"
[[ -n "$STARTER_VERSION" ]] || die "starter/starter-version.txt names no version"
printf 'update_url=%s/starter.txt\n' "$RELEASE_URL" >> "$BUNDLE/starter-version.txt"
echo "starter  : $STARTER_VERSION (updates from $RELEASE_URL/starter.txt)"

if [[ -n "$CHANNEL_URL" ]]; then
  [[ "$CHANNEL_URL" =~ ^https?://[^/?#]+/[^?#]+$ ]] \
    || die "--channel-url takes an http(s) folder URL with no ?query (got: $CHANNEL_URL)"
  # The starter appends gap-latest.txt, so a catalogue address means its folder.
  CHANNEL_URL="${CHANNEL_URL%/}"
  case "${CHANNEL_URL##*/}" in *.json|*.txt) CHANNEL_URL="${CHANNEL_URL%/*}" ;; esac
  printf '%s\n' "$CHANNEL_URL" > "$BUNDLE/channel.txt"
  echo "channel  : $CHANNEL_URL (pinned in channel.txt)"
fi

if [[ -n "$APK_DIR" ]]; then
  [[ -d "$APK_DIR" ]] || die "--apk-dir $APK_DIR does not exist"
  mkdir -p "$BUNDLE/apk"
  found=0
  for f in "$APK_DIR"/*.apk; do
    [[ -f "$f" ]] || continue
    cp "$f" "$BUNDLE/apk/"; found=$((found + 1))
  done
  [[ "$found" -gt 0 ]] || die "--apk-dir $APK_DIR contains no .apk"
  echo "apks     : $found"
else
  echo "apks     : none (the bundle starts the service only)"
fi

# Substitute what the build actually observed, so the shipped README can never
# name an adb revision the bundle does not pin.
for f in "$BUNDLE/README.txt"; do
  [[ -f "$f" ]] || continue
  # SOH as the delimiter: no plausible substitution value contains one, whereas
  # / and | both turn up in file descriptions and paths.
  sed -i.bak -e "s$(printf '\001')@ADB_REVISION@$(printf '\001')$ADB_REVISION$(printf '\001')g" \
             -e "s$(printf '\001')@ARCHIVE_NAME@$(printf '\001')$ARCHIVE_NAME$(printf '\001')g" \
             -e "s$(printf '\001')@STATS_VERSION@$(printf '\001')$STATS_VERSION$(printf '\001')g" "$f"
  rm -f "$f.bak"
done

# --------------------------------------------------------------- line endings
#
# Enforced here rather than merely checked, because the source of truth is a
# working tree on Windows with core.autocrlf=true: .gitattributes keeps a fresh
# clone honest, but an editor or a tool can still leave the wrong endings behind
# locally. Normalising at assembly time means the bundle is correct no matter
# what the working tree looks like -- and a CR in device/gap-service.sh is fatal
# on the device, where mksh rejects every line and it reads as a logic bug.
"$PYTHON" - "$(winpath "$BUNDLE")" <<'PY'
import pathlib, sys
bundle = pathlib.Path(sys.argv[1])

def norm(path, crlf):
    raw = path.read_bytes()
    body = raw.replace(b'\r\n', b'\n')
    out = body.replace(b'\n', b'\r\n') if crlf else body
    if out != raw:
        path.write_bytes(out)
        print(f"  normalised {'CRLF' if crlf else 'LF'}: {path.relative_to(bundle)}")

for p in list(bundle.rglob('*.sh')) + [bundle / 'platform-tools.txt', bundle / 'tsum-stats.txt', bundle / 'starter-version.txt']:
    if p.is_file():
        norm(p, crlf=False)
for p in list(bundle.rglob('*.ps1')) + [bundle / 'Start-Windows.cmd']:
    if p.is_file():
        norm(p, crlf=True)
PY

# --------------------------------------------------------------------- gates

echo
echo "--- gates ---"
gate_fail=0
gate() {
  if [[ "$2" == ok ]]; then printf '  ok    %s\n' "$1"
  else printf '  FAIL  %s: %s\n' "$1" "$2"; gate_fail=1; fi
}

# A CR in anything the device or a POSIX shell runs is fatal and looks like a
# logic bug, so it is checked rather than hoped for.
# NOT a grep for CR: Git Bash opens files in text mode and strips CR before
# the pattern ever sees it, so that test passes on every file -- on the one
# platform where the endings are actually at risk. Comparing the file against
# a CR-stripped copy of itself reads real bytes everywhere.
has_cr() { ! LC_ALL=C tr -d '\r' < "$1" | cmp -s - "$1"; }

lf_bad=""
while IFS= read -r f; do
  has_cr "$f" && lf_bad="$lf_bad ${f#$BUNDLE/}"
done < <(find "$BUNDLE/device" "$BUNDLE/bin/posix" "$BUNDLE/test" -name '*.sh' 2>/dev/null; \
         ls "$BUNDLE/Start-Linux.sh" "$BUNDLE/platform-tools.txt" 2>/dev/null)
gate "LF endings on shell scripts" "$(if [[ -n "$lf_bad" ]]; then echo "CR in$lf_bad"; else echo ok; fi)"

crlf_bad=""
for f in "$BUNDLE/Start-Windows.cmd" "$BUNDLE"/bin/win/*.ps1; do
  [[ -f "$f" ]] || continue
  has_cr "$f" || crlf_bad="$crlf_bad ${f#$BUNDLE/}"
done
gate "CRLF endings on Windows scripts" "$(if [[ -n "$crlf_bad" ]]; then echo "missing CR in$crlf_bad"; else echo ok; fi)"

sh -n "$BUNDLE/device/gap-service.sh" 2>/dev/null \
  && gate "device script is valid POSIX sh" ok \
  || gate "device script is valid POSIX sh" "sh -n failed"

# Every launcher and every script, in both bundles; no binaries in either. An
# adb/ folder here would be the maintainer's own download riding along, and
# an apk/ in the scripts-only bundle would be the small download silently
# being the big one.
missing=""
for f in README.txt platform-tools.txt Start-Windows.cmd Start-Linux.sh \
         device/gap-service.sh device/PROTOCOL.md \
         bin/posix/gap.sh bin/posix/gap-device.sh bin/posix/gap-actions.sh \
         bin/posix/gap-menu.sh bin/posix/gap-site.sh tsum-stats.txt starter-version.txt \
         bin/win/gap.ps1 bin/win/gap-menu.ps1 bin/win/gap-device.ps1 \
         bin/win/gap-actions.ps1 bin/win/gap-site.ps1; do
  [[ -e "$BUNDLE/$f" ]] || missing="$missing $f"
done
stray=""
[[ -e "$BUNDLE/adb" ]] && stray="$stray adb/"
[[ -e "$BUNDLE/stats" ]] && stray="$stray stats/"
[[ -e "$BUNDLE/server" ]] && stray="$stray server/"
[[ -n "$SCRIPTS_ONLY" && -e "$BUNDLE/apk" ]] && stray="$stray apk/"
gate "manifest complete" "$(
  if [[ -n "$missing" ]]; then echo "missing$missing"
  elif [[ -n "$stray" ]]; then echo "should not be in the bundle:$stray"
  else echo ok; fi)"

# Both hosts name the app's storage folder themselves -- the device protocol has
# no key for it -- so drift from Config.kt would show up only as "nothing found"
# when copying or deleting a script's files.
cfg="$GAP_APP_DIR/app/src/main/java/com/gameautomation/platform/Config.kt"
want_parent="$(sed -n 's/.*const val PARENT = "\([^"]*\)".*/\1/p' "$cfg" | head -1)"
want_folder="$(sed -n 's/.*const val FOLDER = "\([^"]*\)".*/\1/p' "$cfg" | head -1)"
if [[ -z "$want_parent" || -z "$want_folder" ]]; then
  gate "storage root matches Config.kt" "could not read PARENT/FOLDER from Config.kt"
else
  storage_bad=""
  for f in bin/posix/gap-device.sh bin/win/gap-device.ps1; do
    grep -qF "$want_parent/$want_folder" "$BUNDLE/$f" || storage_bad="$storage_bad $f"
  done
  if [[ -n "$storage_bad" ]]; then
    gate "storage root matches Config.kt" "$want_parent/$want_folder missing from$storage_bad"
  else
    gate "storage root matches Config.kt" ok
  fi
fi

# Same reason, for the release channel: the app's in-app updater and the two
# hosts each name it themselves, and drift would have a phone and a PC offering
# different versions of the same app.
want_base="$(sed -n 's/.*"\(https:\/\/[^"]*releases\/latest\/download\)".*/\1/p' "$cfg" | head -1)"
want_manifest="$(sed -n 's/.*const val MANIFEST_NAME = "\([^"]*\)".*/\1/p' "$cfg" | head -1)"
if [[ -z "$want_base" || -z "$want_manifest" ]]; then
  gate "release channel matches Config.kt" "could not read RELEASE_BASE/MANIFEST_NAME from Config.kt"
else
  release_bad=""
  for f in bin/posix/gap-device.sh bin/win/gap-device.ps1; do
    grep -qF "$want_base" "$BUNDLE/$f" && grep -qF "$want_manifest" "$BUNDLE/$f" \
      || release_bad="$release_bad $f"
  done
  if [[ -n "$release_bad" ]]; then
    gate "release channel matches Config.kt" "$want_base / $want_manifest missing from$release_bad"
  else
    gate "release channel matches Config.kt" ok
  fi
fi

if grep -rq '@ADB_REVISION@\|@ARCHIVE_NAME@\|@STATS_VERSION@' "$BUNDLE" 2>/dev/null; then
  gate "README placeholders substituted" "placeholders survived"
else
  gate "README placeholders substituted" ok
fi

bash "$BUNDLE/test/check-parity.sh" >/dev/null 2>&1 \
  && gate "host parity self-test" ok \
  || gate "host parity self-test" "check-parity.sh failed"

[[ "$gate_fail" -eq 0 ]] || die "gates failed; nothing packaged"

# ------------------------------------------------------------------- package

mkdir -p "$OUT_DIR"
TGZ="$OUT_DIR/$ARCHIVE_NAME.tar.gz"
ZIP="$OUT_DIR/$ARCHIVE_NAME.zip"

# Both archives are written by Python, from one list of what is executable.
#
# Neither `tar` nor `zip` may be trusted to read the mode off the filesystem
# here: this build runs on Windows, where files come out 0644 and MSYS chmod
# does not make that stick. Stamping the mode into the archive is the only way
# the bits are right on the machine that unpacks it -- and getting it wrong
# means Start-Linux.sh is not executable on exactly the two platforms the
# .tar.gz is recommended for.
#
# `zip` is also simply not installed on the maintainer's box, and Info-ZIP is
# not something a build should require.
"$PYTHON" - "$(winpath "$STAGE")" "$NAME" "$(winpath "$ZIP")" "$(winpath "$TGZ")" <<'PY'
import io, os, sys, stat, tarfile, zipfile

stage, name, zip_out, tgz_out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
root = os.path.join(stage, name)

files = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for fn in sorted(filenames):
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        files.append((rel, full, 0o755 if rel.endswith(".sh") else 0o644))

with zipfile.ZipFile(zip_out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for rel, full, mode in files:
        zi = zipfile.ZipInfo(f"{name}/{rel}")
        zi.date_time = (2026, 1, 1, 0, 0, 0)     # deterministic
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = (stat.S_IFREG | mode) << 16
        zi.create_system = 3                     # Unix, so the modes are honoured
        with open(full, "rb") as fh:
            z.writestr(zi, fh.read())
print(f"wrote {zip_out}")

with tarfile.open(tgz_out, "w:gz") as t:
    for rel, full, mode in files:
        ti = tarfile.TarInfo(f"{name}/{rel}")
        ti.size = os.path.getsize(full)
        ti.mode = mode
        ti.mtime = 1767225600                    # deterministic
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        ti.type = tarfile.REGTYPE
        with open(full, "rb") as fh:
            t.addfile(ti, fh)
print(f"wrote {tgz_out}")
PY

# What bundles already out there update from: upload it with the archives.
if [[ -n "$SCRIPTS_ONLY" ]]; then
  PIN_OUT="$OUT_DIR/starter.txt"
  {
    echo "# The newest starter scripts. A bundle whose starter-version.txt is older"
    echo "# downloads url, checks sha256 and installs it over itself. Written by"
    echo "# build-starter.sh --scripts-only; upload it to the release with the archives."
    echo "version=$STARTER_VERSION"
    echo "url=$RELEASE_URL/$ARCHIVE_NAME.tar.gz"
    echo "sha256=$(sha256_of "$TGZ")"
    echo "size=$(wc -c < "$TGZ" | tr -d ' ')"
  } > "$PIN_OUT"
  echo "wrote ${PIN_OUT#$root/}"
fi

echo
echo "adb        : downloaded on first run -- platform-tools r$ADB_REVISION ($ADB_DARWIN_ARCH on macOS)"
echo "website    : downloaded on first run -- tsum-stats $STATS_VERSION"
echo "tar.gz     : ${TGZ#$root/}   <- give this to macOS and Linux users"
echo "zip        : ${ZIP#$root/}"
[[ -z "$SCRIPTS_ONLY" ]] || echo "starter.txt: ${PIN_OUT#$root/}   <- upload with the archives, or bundles never see this release"
du -h "$TGZ" "$ZIP" 2>/dev/null | sed 's/^/             /'
