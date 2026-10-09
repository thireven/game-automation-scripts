#!/usr/bin/env bash
# The starter's website. Sourced by gap.sh, after gap-device.sh.
#
# The page is served by tsum-stats (Tsum Tsum Stats' program), started with
# --starter pointing at this folder: the starter at /starter/, the stats site
# at /. The program is downloaded once, like adb, into server/<os>-<arch>/ and
# checked against the pin in tsum-stats.txt, which build-starter.sh copies
# from the tsum-stats release. GAP_STARTER_SERVER names a local build instead.
#
# The pin is a floor, not an exact version: tsum-stats updates itself on each
# launch and from the page's Update button, and must not be rolled back.

SITE_PIN_FILE="$BUNDLE/tsum-stats.txt"
site_kv() { kv "$(tr -d '\r' 2>/dev/null < "$SITE_PIN_FILE")" "$1"; }

# arm64 or amd64, the two tsum-stats is built for.
site_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo arm64 ;;
    x86_64|amd64)  echo amd64 ;;
    *)             echo "" ;;
  esac
}

site_dir() { echo "$BUNDLE/server/$(host_os)-$(site_arch)"; }
site_bin() {
  case "$(host_os)" in
    windows) echo "$(site_dir)/tsum-stats.exe" ;;
    *)       echo "$(site_dir)/tsum-stats" ;;
  esac
}

# The exit statuses tsum-stats leaves with after the page installed an update:
# a new tsum-stats, which run_site starts again, or new starter scripts, for
# which it starts this whole launcher again.
SITE_RESTART_CODE=75
SITE_RELOAD_CODE=76

# site_ver_ge A B: dotted version A is B or newer.
site_ver_ge() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$1" ]
}

# Records the installed program's own version, after it may have changed.
site_note_version() {
  v="$("$(site_bin)" --version 2>/dev/null | awk '{print $NF}')"
  [ -n "$v" ] && printf '%s\n' "$v" > "$(site_dir)/VERSION"
}

# Fetches the pinned program when it is missing or older than the pin. Asks
# first; --yes answers for a caller with no terminal.
site_download() {
  key="$(host_os)_$(site_arch)"
  url="$(site_kv "url_$key")"
  want="$(site_kv "sha256_$key")"
  size="$(site_kv "size_$key")"
  version="$(site_kv version)"
  bin="$(site_bin)"
  dir="$(site_dir)"

  if [ ! -f "$SITE_PIN_FILE" ]; then
    log_line "error: tsum-stats.txt is missing, so the website's program cannot be fetched."
    log_line "  Extract the bundle again, set GAP_STARTER_SERVER to a tsum-stats you have,"
    log_line "  or run with --menu for the terminal menu."
    return 1
  fi
  if [ -z "$(site_arch)" ] || [ -z "$url" ] || [ -z "$want" ]; then
    log_line "error: the website is not built for this computer ($(host_os), $(uname -m))."
    log_line "  Run with --menu for the terminal menu."
    return 1
  fi
  have="$(tr -d '\r\n ' < "$dir/VERSION" 2>/dev/null)"
  if [ -x "$bin" ] && [ -n "$have" ] && site_ver_ge "$have" "$version"; then
    return 0
  fi

  mb=$(( (${size:-0} + 524288) / 1048576 ))
  log_line "The starter's website needs its program, tsum-stats $version, and it is not here yet."
  log_line "  fetch : $url"
  [ "$mb" -gt 0 ] && log_line "  size  : about $mb MB"
  log_line "  into  : ${dir#$BUNDLE/}"
  log_line "  check : sha256 from tsum-stats.txt, recorded when this tool was built"
  if [ "${GAP_ASSUME_YES:-0}" != 1 ]; then
    if [ ! -t 0 ]; then
      log_line "Refusing to download without a confirmation -- add --yes."
      return 1
    fi
    printf '\n  download it now? [Y/n] '
    read -r ans || ans=""
    case "$ans" in
      ""|y|Y|yes|YES) : ;;
      *) log_line "Nothing was downloaded. Run with --menu for the terminal menu."; return 1 ;;
    esac
  fi

  mkdir -p "$dir" || { log_line "error: cannot write into $dir."; return 1; }
  tmp="$bin.download"
  log_line "downloading tsum-stats $version ..."
  if ! fetch_url "$url" "$tmp"; then
    rm -f "$tmp"
    log_line "Could not download it. Check the internet connection and try again."
    return 1
  fi
  if [ "$(sha256_of "$tmp" 2>/dev/null || true)" != "$want" ]; then
    rm -f "$tmp"
    log_line "The download did not match its checksum and was deleted. Nothing was kept."
    return 1
  fi
  log_line "  sha256 ok"
  mv -f "$tmp" "$bin" && chmod +x "$bin"
  printf '%s\n' "$version" > "$dir/VERSION"
  return 0
}

# Updates the downloaded program when a newer one is published. Quiet unless
# it did; offline it just keeps the one it has. TSUM_STATS_NO_UPDATE skips it.
site_update() {
  [ -n "${TSUM_STATS_NO_UPDATE:-}" ] && return 0
  before="$(tr -d '\r\n ' < "$(site_dir)/VERSION" 2>/dev/null)"
  # Shows only its "Updating ..." line; a failed check says nothing.
  "$(site_bin)" update 2>&1 >/dev/null | sed -n 's/^.*\(Updating Tsum Tsum Stats .*\)$/\1/p'
  site_note_version
  after="$(tr -d '\r\n ' < "$(site_dir)/VERSION" 2>/dev/null)"
  [ "$after" != "$before" ] && log_line "Updated tsum-stats ${before:-?} -> $after."
  return 0
}

# Starts the website in this terminal and opens it. Closing the terminal, or
# Ctrl-C, stops it.
run_site() {
  bin="${GAP_STARTER_SERVER:-}"
  if [ -z "$bin" ]; then
    # Update first, so a newer floor from a starter update never asks to download.
    had=0
    [ -x "$(site_bin)" ] && { had=1; site_update; }
    site_download || return 1
    # A fresh download is only the pinned floor; bring it to the newest release.
    [ "$had" = 1 ] || site_update
    bin="$(site_bin)"
  fi
  open="--open"
  if [ -n "${GAP_STARTER_RELOADED:-}" ]; then
    open=""   # the page is already open, and reloads itself
  else
    log_line ""
    log_line "Opening the starter in your browser: http://127.0.0.1:8090/starter/"
    log_line "Keep this window open while you use it. Ctrl-C here (or closing the window) stops it."
    log_line ""
  fi
  while :; do
    TSUM_STATS_RESTART_CODE=$SITE_RESTART_CODE GAP_STARTER_RELOAD_CODE=$SITE_RELOAD_CODE \
      "$bin" serve --starter "$(host_path "$BUNDLE")" $open
    rc=$?
    open=""
    case "$rc" in
      "$SITE_RESTART_CODE")
        [ -z "${GAP_STARTER_SERVER:-}" ] && site_note_version
        log_line ""
        log_line "Restarting the starter with the new tsum-stats ..." ;;
      "$SITE_RELOAD_CODE")
        log_line ""
        log_line "Restarting the starter with its new scripts ..."
        # The scripts were renamed into place, so this shell still holds the
        # old files; exec reads the new ones.
        GAP_STARTER_RELOADED=1 exec "$BUNDLE/bin/posix/gap.sh" ${GAP_ARGV[@]+"${GAP_ARGV[@]}"} ;;
      *) exit "$rc" ;;
    esac
  done
}
