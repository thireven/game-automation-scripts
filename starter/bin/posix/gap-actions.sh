#!/usr/bin/env bash
# What the menu options do, and what the user is told when they fail.
#
# Shared by the menu and the command line so a message is written once and
# reads the same either way. Sourced after gap-device.sh.

# Tab-separated rows: serial, state, model, abi, service, installed, err
DEVICE_ROWS=""
ACTION_OK=0
ACTION_MSG=""

TAB="$(printf '\t')"

# ------------------------------------------------------------------ refresh

# probe_row <serial> <state> <model> -- one device's row, enriched by one
# batched probe. A device that is not in the `device` state gets the reason as
# its SERVICE column rather than being hidden -- "no devices found" when the
# phone is sitting there unauthorized is the most confusing thing this tool
# could say.
probe_row() {
  serial="$1"; state="$2"; model="$3"
  abi="-"; svc="-"; installed="-"; err=""
  if [ "$state" = device ]; then
    out="$(invoke_verb "$serial" probe)"
    if proto_ok "$out" >/dev/null 2>&1; then
      abi="$(kv "$out" device_abi)"
      installed="$(kv "$out" installed)"
      err="$(kv "$out" err)"
      [ "$(kv "$out" running)" = 1 ] && svc="running" || svc="stopped"
      [ "$installed" = 0 ] && svc="not installed"
      [ "$err" = no-libs ] && svc="wrong ABI"
      # A push that failed still answers proto=1, and knows nothing else.
      [ "$err" = push-failed ] && svc="unreadable"
    else
      svc="unreadable"
    fi
  else
    svc="$state"
  fi
  # Never an empty field: `read` with IFS=tab folds two tabs into one and
  # every column after the gap shifts left.
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$serial" "$state" "$model" "${abi:--}" "$svc" "${installed:--}" "$err"
}

# Every device adb lists, one probed row each, into DEVICE_ROWS.
refresh_devices() {
  [ "${1:-probe}" = noprobe ] || probe_emulators
  DEVICE_ROWS=""
  raw="$(list_devices | merge_duplicates)"
  [ -n "$raw" ] || return 0

  while IFS="$TAB" read -r serial state model; do
    [ -n "$serial" ] || continue
    DEVICE_ROWS="$DEVICE_ROWS$(probe_row "$serial" "$state" "$model")
"
  done <<EOF
$raw
EOF
}

# device_row <serial> -- that one device's row, rebuilt: its adb state now, and
# what the probe says. Prints nothing when adb no longer lists it. What the
# device page reads after every action, so its Service line can change without
# rescanning every device.
device_row() {
  dr_line="$(list_devices | awk -F"$TAB" -v s="$1" '$1 == s { print; exit }')"
  [ -n "$dr_line" ] || return 0
  IFS="$TAB" read -r serial state model <<EOF
$dr_line
EOF
  probe_row "$serial" "$state" "$model"
}

device_count() { [ -n "$DEVICE_ROWS" ] && printf '%s\n' "$DEVICE_ROWS" | grep -c . || echo 0; }

row_line() { printf '%s\n' "$DEVICE_ROWS" | sed -n "${1}p"; }

row_field() { row_line "$1" | cut -d"$TAB" -f"$2"; }

# The row number of a serial in DEVICE_ROWS, or nothing.
row_index() { printf '%s\n' "$DEVICE_ROWS" | awk -F"$TAB" -v s="$1" '$1 == s { print NR; exit }'; }

no_devices_hint() {
  log_line "No device found."
  log_line ""
  log_line "  - Start your emulator, or plug the phone in with USB debugging enabled."
  log_line "  - Probed for emulators on 127.0.0.1: $EMU_PORTS"
  log_line "    A different port can be added with GAP_EXTRA_PORTS=\"12345\"."
  if [ -n "$(remote_hosts | tr -d ' ')" ]; then
    log_line "  - Also probed the same ports on GAP_REMOTE_HOSTS: $GAP_REMOTE_HOSTS"
    log_line "    Is each emulator's port forwarded onto the LAN and open in the firewall?"
  else
    log_line "    Emulators on another computer: set GAP_REMOTE_HOSTS=\"192.168.1.50\"."
  fi
}

# ---------------------------------------------------------------- diagnosis

# The one place a probe/start result is turned into English. Sets ACTION_MSG.
explain() {
  out="$1"
  err="$(kv "$out" err)"
  case "$err" in
    "") ACTION_MSG=""; return 0 ;;
    not-installed)
      ACTION_MSG="General Automation Platform is not installed on this device."
      ;;
    no-libs)
      # An APK built for the wrong ABI installs cleanly and only fails here.
      libs="$(kv "$out" libs_present)"
      dabi="$(kv "$out" device_abi)"
      if [ -n "$libs" ]; then
        ACTION_MSG="The installed APK carries ${libs%% } only, and this device runs $dabi.
Install a build for $dabi."
      else
        ACTION_MSG="The installed APK has no extracted native libraries.
It must be built for $dabi with extractNativeLibs=true."
      fi
      ;;
    push-failed)
      ACTION_MSG="Could not push the helper script to the device.
Is /data/local/tmp writable? Try reconnecting."
      ;;
    stage-failed|launch-failed|bad-usage)
      ACTION_MSG="$(kv "$out" msg)"
      ;;
    *)
      ACTION_MSG="$(kv "$out" msg)"
      [ -n "$ACTION_MSG" ] || ACTION_MSG="Failed: $err"
      ;;
  esac
  return 1
}

# ------------------------------------------------------------------ actions

# The install picker. Detection reads ro.product.cpu.abi off the device and is
# right far more often than a person reading the row would be -- an emulator
# spoofs a Samsung model name but not its ABI -- so the detected build is
# choice 1 and enter takes it. The list is for what detection cannot cover: a
# probe that came back empty, or trying another build deliberately.
#
# Sets PICKED_APK. Returns 1 if the operator backed out.
pick_apk() {  # pick_apk <abi> <choices> <default>
  # pa_-prefixed because sh has no locals and the caller owns `abi` and `f`.
  pa_abi="$1"; pa_list="$2"; pa_default="$3"
  PICKED_APK=""
  pa_n="$(printf '%s\n' "$pa_list" | grep -c . || true)"

  log_line ""
  log_line "  Which APK to install. Press enter for the one built for this device;"
  log_line "  type a number only if you have a reason to install another build."
  if [ -n "$pa_abi" ]; then
    log_line "  this device reports $pa_abi"
  else
    log_line "  could not read this device's ABI, so nothing is preselected"
  fi
  log_line ""
  pa_i=1
  while [ "$pa_i" -le "$pa_n" ]; do
    pa_f="$(printf '%s\n' "$pa_list" | sed -n "${pa_i}p")"
    pa_tag=""
    case "$(basename "$pa_f")" in
      *universal*) pa_tag="every ABI; the device chooses" ;;
    esac
    [ "$pa_f" = "$pa_default" ] && pa_tag="${pa_tag:+$pa_tag  }[enter]"
    if [ -n "$pa_tag" ]; then
      printf '    %d) %-34s %s\n' "$pa_i" "$(basename "$pa_f")" "$pa_tag"
    else
      printf '    %d) %s\n' "$pa_i" "$(basename "$pa_f")"
    fi
    pa_i=$((pa_i + 1))
  done
  log_line ""
  if [ -n "$pa_default" ]; then
    printf '  choose [enter = 1]: '
  else
    printf '  choose (enter cancels): '
  fi
  read -r pa_pick || pa_pick=""

  # Enter takes the default, and is a cancel only when there is none.
  if [ -z "$pa_pick" ]; then
    [ -n "$pa_default" ] || return 1
    PICKED_APK="$pa_default"
    return 0
  fi
  case "$pa_pick" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$pa_pick" -ge 1 ] && [ "$pa_pick" -le "$pa_n" ] || return 1
  PICKED_APK="$(printf '%s\n' "$pa_list" | sed -n "${pa_pick}p")"
  return 0
}

# Offers the Tsum Tsum library to GAP and says what happened. Sets SOURCE_MSG;
# returns 1 only when the offer itself failed.
source_offer() {
  SOURCE_MSG=""
  log_line "offering the Tsum Tsum library to GAP on $1 ..."
  # Captured, not piped: a pipe would report the `while`'s status.
  so_out="$(offer_source "$1")"; rc=$?
  [ -z "$so_out" ] || printf '%s\n' "$so_out" | while IFS= read -r l; do log_line "  $l"; done
  case "$rc" in
    0) SOURCE_MSG="On the device, tap Add to put the Tsum Tsum library in GAP's Sources." ;;
    2) SOURCE_MSG="This GAP lists the Tsum Tsum library by itself. Nothing to add." ;;
    *) SOURCE_MSG="Could not open GAP to add the Tsum Tsum library. See the log."; return 1 ;;
  esac
  return 0
}

# run_action <serial> <start|restart|stop|log|follow|install|update|reconnect|
#                      add-source|copy-script|delete-script>
# Streams commentary through log_line; leaves a verdict in ACTION_OK/ACTION_MSG.
run_action() {
  serial="$1"; action="$2"
  ACTION_OK=0
  ACTION_MSG=""

  case "$action" in
    reconnect)
      log_line "reconnecting $serial ..."
      "$ADB" disconnect "$serial" >/dev/null 2>&1
      out="$("$ADB" connect "$serial" 2>&1 | tr -d '\r')"
      log_line "$out"
      ACTION_OK=1
      ACTION_MSG="Reconnect attempted. Refresh to see the result."
      return 0
      ;;
    install)
      out="$(invoke_verb "$serial" probe)"
      abi="$(kv "$out" device_abi)"
      # A failed probe has no device_abi, and matching '' takes whichever APK
      # sorts first in the folder. It leaves no default instead, and the picker
      # asks outright rather than guessing.
      detected=""
      default=""
      if [ -n "$abi" ]; then
        detected="$(find_apk_exact "$abi" || true)"
        default="$detected"
        [ -n "$default" ] || default="$(find_apk_for "$abi" || true)"
      fi

      choices="$(apk_choices "$default")"
      count="$(printf '%s\n' "$choices" | grep -c . || true)"
      if [ "$count" -eq 0 ]; then
        ACTION_MSG="No APK in the bundle.
Put one in the apk/ folder next to Start, then try again."
        log_line "$ACTION_MSG"
        return 1
      fi

      # One APK and a device to match it against is not a choice worth asking
      # about; anything else is, because a wrong build installs cleanly and
      # only fails later, when the service will not start. With no terminal to
      # ask through -- or with --yes -- the detected default stands.
      apk="$default"
      if [ -t 0 ] && [ "${GAP_ASSUME_YES:-0}" != 1 ] &&
         { [ "$count" -gt 1 ] || [ -z "$apk" ]; }; then
        if pick_apk "$abi" "$choices" "$default"; then
          apk="$PICKED_APK"
        else
          ACTION_OK=1
          ACTION_MSG="Nothing was installed."
          log_line "$ACTION_MSG"
          return 0
        fi
      fi
      if [ -z "$apk" ]; then
        ACTION_MSG="Could not read the device's ABI, so no APK was chosen.
The device may have gone offline -- Refresh and try again."
        log_line "$ACTION_MSG"
        return 1
      fi
      log_line "installing $(basename "$apk") on $serial ..."
      # Captured rather than piped: a pipeline's status is the `while`'s, so
      # piping reported every failed install as a success.
      out="$(install_apk "$serial" "$apk")"; rc=$?
      printf '%s\n' "$out" | while IFS= read -r l; do log_line "  $l"; done
      if [ "$rc" -eq 0 ]; then
        ACTION_OK=1
        ACTION_MSG="Installed $(basename "$apk")."
        source_offer "$serial"
        ACTION_MSG="$ACTION_MSG
$SOURCE_MSG"
      else
        ACTION_MSG="Install failed. See the log."
      fi
      return 0
      ;;
    update)
      log_line "checking for a newer APK ..."
      channel_active && log_line "  channel: $RELEASE_BASE"
      man="$(fetch_manifest)" || {
        ACTION_MSG="Could not reach the release page.
Check the internet connection. Install APK still works offline from the bundle."
        log_line "$ACTION_MSG"
        return 1
      }
      ver="$(kv "$man" version)"
      [ -n "$ver" ] || {
        ACTION_MSG="The release manifest is unreadable. Try again later."
        return 1
      }

      # Same ABI matching the bundled path does, only against the manifest:
      # the exact ABI first, the universal build as the fallback.
      out="$(invoke_verb "$serial" probe)"
      abi="$(kv "$out" device_abi)"
      # Same guard as install: an empty ABI means the probe failed, and the
      # universal fallback below would download for a device that is not there.
      if [ -z "$abi" ]; then
        ACTION_MSG="Could not read the device's ABI, so no APK was chosen.
The device may have gone offline -- Refresh and try again."
        log_line "$ACTION_MSG"
        return 1
      fi
      name="$(kv "$man" "apk_$abi")"
      want="$(kv "$man" "sha256_$abi")"
      if [ -z "$name" ]; then
        name="$(kv "$man" apk_universal)"
        want="$(kv "$man" sha256_universal)"
      fi
      [ -n "$name" ] || {
        ACTION_MSG="The latest release publishes no APK for $abi."
        return 1
      }

      # A wrong-ABI install carries the same version as the APK that fixes it,
      # so "already on it" would leave the user stuck on a build that cannot
      # start, with no way out of this menu.
      have="$(installed_version "$serial")"
      if [ -n "$have" ] && [ "$have" = "$ver" ] && [ "$(kv "$out" err)" != no-libs ]; then
        ACTION_OK=1
        ACTION_MSG="Already on $ver -- nothing to download."
        log_line "$ACTION_MSG"
        return 0
      fi

      mkdir -p "$BUNDLE/apk"
      dest="$BUNDLE/apk/$name"
      chan="$(kv "$man" channel)"
      log_line "downloading $name ($ver${chan:+, $chan}) ..."
      fetch_url "$RELEASE_BASE/$name" "$dest" || {
        rm -f "$dest"
        ACTION_MSG="Could not download $name."
        log_line "$ACTION_MSG"
        return 1
      }

      if [ -n "$want" ]; then
        got="$(sha256_of "$dest" 2>/dev/null || true)"
        if [ -z "$got" ]; then
          log_line "  warning: no sha256 tool here, so the download is unverified"
        elif [ "$got" != "$want" ]; then
          rm -f "$dest"
          ACTION_MSG="$name did not match its published checksum and was deleted.
Nothing was installed."
          log_line "$ACTION_MSG"
          return 1
        else
          log_line "  sha256 ok"
        fi
      fi

      # By path, not through find_apk_for: that globs alphabetically, so a
      # bundled gap-0.12-*-arm64-v8a.apk would beat the gap-arm64-v8a.apk
      # just downloaded. `install` stays "the bundled APK", this is "the
      # published one".
      log_line "installing $name on $serial ..."
      out="$(install_apk "$serial" "$dest")"; rc=$?
      printf '%s\n' "$out" | while IFS= read -r l; do log_line "  $l"; done
      if [ "$rc" -eq 0 ]; then
        ACTION_OK=1
        ACTION_MSG="Updated to $ver${chan:+ ($chan)}${have:+ (was $have)}."
        source_offer "$serial"
        ACTION_MSG="$ACTION_MSG
$SOURCE_MSG"
      else
        ACTION_MSG="Install failed. See the log."
      fi
      return 0
      ;;
    add-source)
      if [ -z "$(installed_version "$serial")" ]; then
        ACTION_MSG="GAP is not installed on $serial. Install it first; that adds the library too."
        log_line "$ACTION_MSG"
        return 1
      fi
      source_offer "$serial" && ACTION_OK=1
      ACTION_MSG="$SOURCE_MSG"
      return 0
      ;;
    follow)
      # The terminal is the log pane, so this streams instead of snapshotting.
      # Ctrl-C has to stop the tail without stopping the menu: bash defers a
      # trap until the foreground child has died, so control just returns here.
      log_line ""
      log_line "following $STAGE_DIR/service.log on $serial -- Ctrl-C to stop"
      log_line ""
      trap ':' INT
      # Not piped through `tr -d '\r'` like every other adb call here: a pipe
      # block-buffers, and a log you are watching live has to arrive as it is
      # written. adb's shell output carries no CR to strip anyway.
      "$ADB" -s "$serial" shell "tail -n 200 -f $STAGE_DIR/service.log" 2>&1
      trap - INT
      ACTION_OK=1
      return 0
      ;;
    log)
      out="$(invoke_verb "$serial" log)"
      extract_log "$out" | while IFS= read -r l; do log_line "$l"; done
      ACTION_OK=1
      ACTION_MSG="Service log from $STAGE_DIR/service.log"
      return 0
      ;;
    stop)
      log_line "stopping the service on $serial ..."
      out="$(invoke_verb "$serial" stop)"
      proto_ok "$out" || { ACTION_MSG="Protocol mismatch."; return 1; }
      # A root-started service survives the kill; the device script says why.
      if [ "$(kv "$out" running)" = 1 ]; then
        explain "$out"
        [ -n "$ACTION_MSG" ] || ACTION_MSG="The service is still running."
        log_line "$ACTION_MSG"
        return 1
      fi
      ACTION_OK=1
      ACTION_MSG="Service stopped."
      return 0
      ;;
    start|restart)
      [ "$action" = restart ] && flags="start --force" || flags="start"
      log_line "starting the service on $serial ..."
      out="$(invoke_verb "$serial" $flags)"
      proto_ok "$out" || { ACTION_MSG="Protocol mismatch."; return 1; }

      abi="$(kv "$out" abi)"
      loader="$(kv "$out" loader)"
      [ -n "$abi" ] && log_line "  abi    : $abi ($loader)"
      [ -n "$(kv "$out" libdir)" ] && log_line "  libs   : $(kv "$out" libdir)"
      for s in $(printf '%s\n' "$out" | sed -n 's/^step=//p'); do
        log_line "  step   : $s"
      done

      body="$(extract_log "$out")"
      if [ -n "$body" ]; then
        log_line "  --- service log ---"
        printf '%s\n' "$body" | while IFS= read -r l; do log_line "  $l"; done
      fi

      # rc too: `running=1` is also what a refused restart says of the
      # service it could not replace.
      if [ "$(kv "$out" rc)" = 0 ] && [ "$(kv "$out" running)" = 1 ]; then
        ACTION_OK=1
        if [ "$(kv "$out" step | tail -1)" = already-running ]; then
          ACTION_MSG="Service was already running from this build - left alone.
Use Restart to force it."
        else
          ACTION_MSG="Service is running.
It survives an app reinstall, and stays up until the device reboots."
        fi
        return 0
      fi

      explain "$out"
      # The one failure the bundle can fix by itself.
      if [ "$(kv "$out" err)" = not-installed ] || [ "$(kv "$out" err)" = no-libs ]; then
        dabi="$(kv "$out" device_abi)"
        if find_apk_exact "$dabi" >/dev/null 2>&1; then
          ACTION_MSG="$ACTION_MSG

An APK for $dabi is in this bundle - use the Install APK option."
        elif [ "$(kv "$out" err)" = no-libs ]; then
          # Only a fat APK here, and the device already resolved one to the
          # wrong ABI. Installing it again lands in exactly the same place.
          ACTION_MSG="$ACTION_MSG

This bundle carries no $dabi-only APK - use Download latest APK to fetch one."
        elif find_apk_for "$dabi" >/dev/null 2>&1; then
          ACTION_MSG="$ACTION_MSG

An APK is in this bundle - use the Install APK option."
        fi
      fi
      [ -n "$ACTION_MSG" ] || ACTION_MSG="The service failed to start. See the log."
      log_line "$ACTION_MSG"
      return 1
      ;;
    copy-script|delete-script)
      # Two verbs, one job: they differ in whether the files survive it.
      pat="script*.log"; what="script log"  # script.1.log.. are rotations
      log_line "looking for $pat under $DEVICE_STORAGE ..."
      files="$(device_files "$serial" "$pat")"
      # A copy also takes GAP's companion link log (companion-<id>.log).
      case "$action" in
        copy-*) files="$(printf '%s\n%s\n' "$files" "$(device_files "$serial" 'companion*.log')" | grep .)" ;;
      esac
      if [ -z "$files" ]; then
        ACTION_MSG="No $what on this device.
Nothing matched $pat under $DEVICE_STORAGE.
A service started with --root= needs GAP_STORAGE_ROOT set to the same folder."
        log_line "$ACTION_MSG"
        return 1
      fi
      count="$(printf '%s\n' "$files" | grep -c .)"

      case "$action" in
        copy-*)
          dest="$BUNDLE/collected/$(safe_name "$serial")"
          n=0; bad=0
          while IFS= read -r f; do
            [ -n "$f" ] || continue
            # The device layout is kept under the destination, so two scripts
            # with a log of the same name cannot overwrite each other.
            rel="${f#$DEVICE_STORAGE/}"
            if pull_file "$serial" "$f" "$dest/$rel"; then
              n=$((n + 1)); log_line "  $rel"
            else
              bad=$((bad + 1)); log_line "  FAILED $rel"
            fi
          done <<EOF
$files
EOF
          if [ "$n" -eq 0 ]; then
            ACTION_MSG="Found $count file(s) but could not copy any. See the log."
            return 1
          fi
          ACTION_OK=1
          ACTION_MSG="Copied $n file(s) into
$dest"
          if [ "$bad" -gt 0 ]; then
            ACTION_MSG="$ACTION_MSG
$bad could not be copied -- see the log."
          fi
          return 0
          ;;
      esac

      # Deleting: nothing keeps a second copy, so the list is shown and
      # confirmed first. --yes skips the question; without a terminal to ask,
      # refusing beats deleting on an assumption.
      printf '%s\n' "$files" | sed "s|^$DEVICE_STORAGE/|  |"

      # The service opens script.log at startup and holds it for the life of the
      # process, and an emulator whose sdcard is a host folder cannot unlink a
      # file the host still has open, so the service is bounced around the delete.
      bounce=0
      if [ "$action" = delete-script ]; then
        bounce=1
        log_line "The service holds script.log open, so it is stopped for the delete and started again afterwards."
      fi

      if [ "${GAP_ASSUME_YES:-0}" != 1 ]; then
        if [ ! -t 0 ]; then
          ACTION_MSG="Refusing to delete without a confirmation -- add --yes."
          return 1
        fi
        printf '\n  delete these %s file(s) from %s? [y/N] ' "$count" "$serial"
        read -r ans || ans=""
        case "$ans" in
          y|Y|yes|YES) : ;;
          *) ACTION_OK=1; ACTION_MSG="Nothing was deleted."; return 0 ;;
        esac
      fi
      # `step=kill` means the stop found something to kill, which is the only
      # thing that earns a restart afterwards -- `step=not-running` must not
      # start a service the user had deliberately left down.
      was_running=0
      if [ "$bounce" = 1 ]; then
        log_line "stopping the service on $serial ..."
        out="$(invoke_verb "$serial" stop)"
        if proto_ok "$out"; then
          [ "$(kv "$out" step)" = kill ] && was_running=1
          if [ "$(kv "$out" running)" = 1 ]; then
            log_line "the service did not stop; files it holds open may survive the delete"
          fi
        fi
      fi

      printf '%s\n' "$files" | delete_files "$serial"

      # What is still there is the verdict; `rm` on the far side of adb shell
      # cannot report its own. Counted before the restart, because the service
      # writes a fresh script.log the moment it comes back up.
      left="$(device_files "$serial" "$pat" | grep -c .)"
      gone=$((count - left))

      svc_note=""
      if [ "$was_running" = 1 ]; then
        log_line "starting the service on $serial ..."
        out="$(invoke_verb "$serial" start)"
        if [ "$(kv "$out" running)" = 1 ]; then
          svc_note="
The service was stopped for the delete and is running again,
so a new script.log is already on the device."
        else
          svc_note="
The service was stopped for the delete and did not come back --
use Start service, then Show service log if it still will not."
        fi
      fi

      if [ "$left" -eq 0 ]; then
        ACTION_OK=1
        ACTION_MSG="Deleted $gone file(s) from $serial.$svc_note"
      elif [ "$gone" -gt 0 ]; then
        ACTION_OK=1
        ACTION_MSG="Deleted $gone file(s); $left could not be removed.
A file the running script still holds open is the usual reason.$svc_note"
      else
        ACTION_MSG="Nothing could be deleted. Is the storage writable?$svc_note"
        return 1
      fi
      return 0
      ;;
    *)
      ACTION_MSG="unknown action: $action"
      return 1
      ;;
  esac
}
