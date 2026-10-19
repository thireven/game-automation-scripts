#!/usr/bin/env bash
# The numbered menu -- the bundle's only front-end on macOS and Linux.
#
# There is deliberately no native dialog path any more: a terminal is the one
# thing every machine that can run adb already has, and it is also the log
# pane, which no dialog box can be. Every option here has a command-line twin
# in gap.sh, so nothing is reachable only by menu.
#
# Two pages. The device list, and the page of the one device chosen from it,
# where every action runs. That device stays chosen -- across runs too, through
# last-device.txt -- until "d" asks for the list again, so nobody picks the
# same emulator after every action. Each page says what it is for and what to
# do next, because the terminal is all the guidance there is.
#
# Sourced by gap.sh with gap-device.sh and gap-actions.sh already loaded. This
# file asks questions and prints verdicts; it never talks to adb itself.

MENU_QUIT=0

menu_rule() { printf '  %s\n' "-------------------------------------------------------------------------"; }

menu_header() {
  printf '\n'
  printf '  Tsum Tsum Script -- service starter\n'
  printf '  adb: %s\n' "$ADB_SOURCE"
  [ -n "$ADB_WARNING" ] && printf '  note: %s\n' "$ADB_WARNING"
  menu_rule
}

menu_table() {
  printf '  %-3s %-20s %-18s %-11s %s\n' "#" "SERIAL" "MODEL" "ABI" "SERVICE"
  menu_rule
  i=1
  printf '%s\n' "$DEVICE_ROWS" | while IFS="$TAB" read -r serial state model abi svc rest; do
    [ -n "$serial" ] || continue
    printf '  %-3s %-20s %-18s %-11s %s\n' "$i)" "$serial" "$model" "$abi" "$svc"
    i=$((i + 1))
  done
  menu_rule
}

menu_pause() {
  printf '\n  [enter] to continue '
  read -r _dummy || return 0
}

# One verdict, indented so a multi-line message stays readable under it.
menu_verdict() {
  [ -n "$ACTION_MSG" ] || return 0
  printf '\n'
  [ "$ACTION_OK" = 1 ] && printf '  OK: ' || printf '  PROBLEM: '
  printf '%s\n' "$ACTION_MSG" | sed '2,$s/^/      /'
}

# What to do next, read off the SERVICE column. The one line a first-time
# user needs and the table cannot say. Worded the same as gap-menu.ps1.
menu_next_step() {  # menu_next_step <state> <svc> <abi>
  case "$2" in
    running)
      printf '  Next: nothing -- the service is up. Use the app on the device. After\n'
      printf '  the device reboots, come back here and choose 1 again.\n' ;;
    stopped)
      printf '  Next: choose 1 to start the service. The app needs it running before\n'
      printf '  a script can run.\n' ;;
    "not installed")
      if [ -d "$BUNDLE/apk" ]; then
        printf '  Next: install the app -- 6 for the APK in this bundle, or 8 for the\n'
        printf '  latest published one -- then 1 to start the service.\n'
      else
        printf '  Next: choose 8 to download and install the app, then 1 to start the\n'
        printf '  service.\n'
      fi ;;
    "wrong ABI")
      printf '  Next: the installed app was built for another processor. Choose 8,\n'
      printf '  which fetches the build for %s, then 1 to start the service.\n' "$3" ;;
    unreadable)
      printf '  Next: the device answered, but not in a way this tool could read.\n'
      printf '  Choose r to try again; if it stays like this, reconnect the device.\n' ;;
    unauthorized)
      printf '  Next: look at the device and tap Allow on the "Allow USB debugging?"\n'
      printf '  prompt, then choose r.\n' ;;
    offline)
      printf '  Next: choose 7 to reconnect, then r. If it stays offline, restart the\n'
      printf '  emulator, or unplug the phone and plug it in again.\n' ;;
    *)
      printf '  Next: adb reports this device as "%s". Put that right on the\n' "$1"
      printf '  device, then choose r.\n' ;;
  esac
}

# The chosen device's row again, after an action. Sets `row`; returns 1 when
# adb no longer lists the device, which sends the page back to the list.
menu_reprobe() {
  printf '  checking %s ...\n' "$serial"
  row="$(device_row "$serial")"
  [ -n "$row" ] && return 0
  printf '\n  %s is no longer listed by adb -- back to the device list.\n' "$serial"
  menu_pause
  return 1
}

# The page of one device. Loops here, re-probing that device alone after every
# action so the Service line is current, until d (the list) or q. q sets
# MENU_QUIT, which menu_main honours.
menu_device() {  # menu_device <row>
  row="$1"
  serial="$(printf '%s\n' "$row" | cut -f1)"
  while true; do
    state="$(printf '%s\n' "$row" | cut -f2)"
    model="$(printf '%s\n' "$row" | cut -f3)"
    abi="$(printf '%s\n' "$row" | cut -f4)"
    svc="$(printf '%s\n' "$row" | cut -f5)"

    menu_header
    printf '  Device : %s   %s   %s\n' "$serial" "$model" "$abi"
    printf '  Service: %s\n' "$svc"
    menu_rule
    printf '  Everything below acts on this device. It stays chosen, the next time\n'
    printf '  this tool runs too, until you choose d.\n'
    menu_next_step "$state" "$svc" "$abi"
    printf '\n'
    if [ "$state" = device ]; then
      printf '  Service (not needed on a rooted device -- the app starts it itself)\n'
      printf '  1) Start service\n'
      printf '  2) Restart service (force)\n'
      printf '  3) Stop service\n'
      printf '  4) Show service log\n'
      printf '  5) Follow service log   (Ctrl-C stops)\n'
      printf '\n'
      printf '  App and script files\n'
      [ -d "$BUNDLE/apk" ] && printf '  6) Install APK\n'
      # 8, not 7: 7 is Reconnect in the offline branch below, and the state
      # guard would then reject it here.
      if channel_active; then
        printf '  8) Download and install the latest pre-release APK   (channel.txt)\n'
      else
        printf '  8) Download and install the latest APK\n'
      fi
      printf '  9) Copy the logs  (script*.log, companion*.log)\n'
      printf ' 10) Delete the script log from the device\n'
      printf ' 11) Add the Tsum Tsum library to GAP   (tap Add on the device)\n'
    else
      printf '  This device is "%s" and cannot be used yet.\n' "$state"
      [ "$state" = offline ] && printf '  7) Reconnect\n'
    fi
    printf '\n  r) Refresh    d) Change device    q) Quit\n'
    printf '\n  choose: '
    read -r pick || { MENU_QUIT=1; return 0; }

    case "$pick" in
      q|Q) MENU_QUIT=1; return 0 ;;
      d|D|b|B) return 0 ;;
      r|R|"") menu_reprobe || return 0
              continue ;;
    esac
    # Options not printed for this state can still be typed, so each is guarded.
    # Guards are their own statement: `cond && run_action || continue` would
    # also swallow the verdict whenever the action itself failed.
    case "$pick" in
      1|2|3|4|5|6|8|9|10|11) [ "$state" = device ] || continue ;;
    esac
    case "$pick" in
      1) run_action "$serial" start   ;;
      2) run_action "$serial" restart ;;
      3) run_action "$serial" stop    ;;
      4) run_action "$serial" log     ;;
      5) run_action "$serial" follow  ;;
      6) [ -d "$BUNDLE/apk" ] || continue
         run_action "$serial" install ;;
      7) [ "$state" = offline ] || continue
         run_action "$serial" reconnect ;;
      8) run_action "$serial" update  ;;
      9)  run_action "$serial" copy-script   ;;
      10) run_action "$serial" delete-script ;;
      11) run_action "$serial" add-source    ;;
      *) continue ;;
    esac

    menu_verdict
    menu_pause
    menu_reprobe || return 0
  done
}

menu_main() {
  MENU_QUIT=0
  # Straight to the device chosen last time, when it is here and usable. One
  # that is here but not usable is shown in the list instead, with the reason,
  # since the list is the page that explains one.
  wanted="$(recall_device)"
  while true; do
    menu_header
    printf '  scanning for devices ...\n'
    refresh_devices
    n="$(device_count)"
    if [ "$n" -eq 0 ]; then
      printf '\n'
      no_devices_hint
      printf '\n  Once it is on and connected, choose r to look again.\n'
      printf '\n  r) Refresh    q) Quit\n\n  choose: '
      read -r pick || return 0
      case "$pick" in q|Q) return 0 ;; esac
      continue
    fi

    if [ -n "$wanted" ]; then
      idx="$(row_index "$wanted")"
      wanted=""
      if [ -n "$idx" ] && [ "$(row_field "$idx" 2)" = device ]; then
        printf '  %s, chosen last time, is here -- opening it.\n' "$(row_field "$idx" 1)"
        menu_device "$(row_line "$idx")"
        [ "$MENU_QUIT" = 1 ] && return 0
        continue
      fi
    fi

    printf '\n'
    printf '  Every phone and emulator adb can see, and where the service stands on\n'
    printf '  each. Type the number of the one to work on and press enter. It stays\n'
    printf '  chosen -- across runs of this tool too -- until you change it here.\n'
    printf '\n'
    menu_table
    printf '  r) Refresh    q) Quit\n'
    printf '\n  device: '
    read -r pick || return 0
    case "$pick" in
      q|Q) return 0 ;;
      r|R|"") continue ;;
    esac
    case "$pick" in
      ''|*[!0-9]*) continue ;;
    esac
    [ "$pick" -ge 1 ] && [ "$pick" -le "$n" ] || continue
    remember_device "$(row_field "$pick" 1)"
    menu_device "$(row_line "$pick")"
    [ "$MENU_QUIT" = 1 ] && return 0
  done
}
