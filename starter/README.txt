Tsum Tsum Script -- service starter
====================================

What this is
------------
General Automation Platform needs a privileged helper service running on the phone or
emulator. Android only lets a PC start that service, and it stops when the
device reboots -- so it has to be started again after every reboot.

The exception is a rooted emulator or phone: there the app can start the
service by itself, and the service options in this tool are not needed.

That is what this bundle is for. Extract it, run the file for your system --

    Windows            Start-Windows
    macOS and Linux    Start-Linux

-- and a page opens in your browser. Pick your device and press "Start
service". The tool remembers the device you picked and opens straight to it
next time. (On a Mac
you really do run Start-Linux: macOS and Linux run the same shell, so one file
covers both. The two names may show as Start-Windows.cmd and Start-Linux.sh;
whether the ending is shown is a setting on your computer, and either way the
name in front of the dot is the one to look for.) The same page installs the app, exports the
script log and your round stats as one zip, clears them off the phone, and
links to Tsum Tsum Stats, which runs alongside it. Keep the terminal window it
was started from open while you use it; closing it stops the page. Nothing gets
installed on your computer.

The page is served by Tsum Tsum Stats' program, tsum-stats @STATS_VERSION@.
The first time it runs, the tool asks to download it (about 25 MB, from the
Tsum Tsum Stats releases on GitHub) into a "server" folder here, checked
against a checksum recorded in tsum-stats.txt when this tool was built.
After that it keeps itself current: each start fetches a newer version if one
is out, and the page's Updates section checks every few hours, with a "Check
for updates" button. "Update now" restarts the page on the new version without
closing the window. Every download is checked against its published checksum.
Set TSUM_STATS_NO_UPDATE=1 before starting to turn the automatic part off.

The one other thing the tool needs that it does not carry is Google's `adb`.
The first time the page opens it offers to download it -- platform-tools @ADB_REVISION@,
about 8 to 16 MB depending on your system, straight from dl.google.com --
into an "adb" folder next to this README. The download is checked against a
checksum recorded in platform-tools.txt when this tool was built, only adb is
kept out of it, and it is never downloaded again. If a current adb is already
on your computer (Android Studio, say), the tool uses that one instead and
downloads nothing.

The page also installs the app: the latest release, downloaded from GitHub,
or one carried in an "apk" folder next to this README -- see "Installing the
app" below.


macOS -- read this first
------------------------
There is no separate macOS file. Run Start-Linux.sh, the same one Linux uses --
and run it from Terminal, because double-clicking a .sh in Finder opens it in
an editor instead of running it.

macOS also blocks files that came out of a downloaded zip. Using the .tar.gz
download instead avoids that entirely:

    Open Terminal, then:
        cd ~/Downloads
        tar -xzf @ARCHIVE_NAME@.tar.gz
        cd TsumTsum-Starter
        ./Start-Linux.sh
    Files extracted this way are never quarantined, so nothing gets blocked.

If you already extracted the .zip and nothing seems to happen, run this once
in Terminal, using the folder you extracted:

    xattr -dr com.apple.quarantine "/path/to/TsumTsum-Starter"

then run  ./Start-Linux.sh  as above. (The adb the tool downloads for itself
is never quarantined -- only files that came through a browser are.)


Windows
-------
Double-click            Start-Windows

A console window opens, then the page in your browser; keep the console open
while you use the page. If Windows SmartScreen asks, choose
"More info" then "Run anyway" -- Start-Windows.cmd is a two-line text file and
you are welcome to open it in Notepad first.

If your workplace locks PowerShell down and Start-Windows.cmd will not run, see
"Doing it by hand" at the bottom.


Linux
-----
From a terminal:                         ./Start-Linux.sh

There is no desktop app to install: run it from a terminal, and the page opens
in your browser. Keep the terminal open while you use it. (Double-clicking it in a file manager works only if your
file manager is set to run scripts in a terminal -- a terminal is simpler.)


Using it
--------
1. Start your emulator, or plug the phone in with USB debugging turned on.
     - On a phone: Settings > About phone > tap "Build number" seven times,
       then Settings > Developer options > USB debugging.
     - The first time, the phone shows an "Allow USB debugging?" prompt.
       Tap Allow. Until you do, the tool lists the phone as "unauthorized".
     - Emulators (MuMu, LDPlayer, Nox, MEmu) are found automatically.
2. Run Start-Windows or Start-Linux. The page opens in your browser at
   http://127.0.0.1:8090/starter/ and lists every device adb can see.
3. Click your device. Its Service card says what it needs; usually that is
   "Start service".

After a few seconds it should say the service is running. It stays up until the
device reboots, and it survives reinstalling the app.

The device you picked stays picked, the next time you run the tool too.
(The choice is one line in last-device.txt next to this README -- delete the
file to forget it.)

Start, Restart and Stop manage the service over ADB, and are only needed when
the device is NOT rooted -- a rooted emulator or phone grants the app root and
the service starts from inside the app by itself. Everything else works the
same either way.

A device you expect is missing, or stuck offline? "Restart adb", next to
Refresh, restarts the adb server (kill-server, then start-server) and looks
again.

On the page
-----------
  Start service           starts it, or leaves it alone if it is already
                          running from the version of the app now installed
  Restart / Stop          start it again even if it was running / stop it
  Show service log        what the service printed when it started
  Follow live             the same log, live, until you stop it
  Download & install      fetch the newest published APK and install it
  Install APK             only when an "apk" folder is in the bundle
  Reconnect               offered for a device that has gone offline
  Export logs & stats     zip up the script log, service log, round stats and
                          Tsum lists, and ask where to save the zip
  Import round stats      copy stats_*.csv and Tsum lists into "collected" and
                          into Tsum Tsum Stats
  Copy script log         copy the script log into a "collected" folder here
  Delete script log /     delete them from the device, after showing the files
  Delete round stats      and asking (the script log delete stops the service
                          over the delete and starts it again if it was running)
  Restart adb             restart the adb server and look for devices again
  Stats site              Tsum Tsum Stats, at http://127.0.0.1:8090/

Run with --menu (-Menu on Windows) to get the old numbered menu in the
terminal instead of the page. It does the service, app and script log options,
not the export or the stats import.

Testing a pre-release build
---------------------------
A tester is given a folder URL (or the address of its catalogue file). Run

  Start-Linux.sh --channel https://example.com/alpha/alpha.json     (macOS, Linux)
  Start-Windows.cmd -Channel https://example.com/alpha/alpha.json   (Windows)

once, or paste it into "Testing a pre-release" on the page. It is kept in
channel.txt, and "Download & install" then takes that folder's latest APK (checked against its checksum) instead of the published release. The
line it prints names the build's channel, alpha or beta. `--channel off`
(`-Channel off` on Windows) or deleting channel.txt goes back to the published
releases. A pre-release replaces the installed app; Android will not install an
older build over a newer one, so leaving it means uninstalling first.


Installing the app
------------------
"Download & install the latest APK" fetches the newest General Automation
Platform release from GitHub, picks the build for your device, and installs it.
The download is kept in the "apk" folder next to this README.

If that "apk" folder already holds .apk files (a bundle that ships the app, or
an earlier download), an "Install APK" button also appears, which installs one
of them with no internet needed.

After either install, GAP opens on the device and asks to add the Tsum Tsum
library to its Sources: tap Add. That is where the script is installed from.
If you skipped it, "Add the Tsum Tsum library" asks again.

When the folder holds more than one build, it lists them and preselects the one
matching the ABI the device reports:

    this device reports x86_64

      1) gap-0.13-abc1234-x86_64.apk       [enter]
      2) gap-0.13-abc1234-arm64-v8a.apk
      3) gap-0.13-abc1234-armeabi-v7a.apk

Press enter unless you have a reason not to. Choice 1 comes from the device
itself, which is more reliable than the model name on the row above it -- an
emulator can report a phone's model while running on a different processor.


Updating this tool
------------------
The tool updates itself. The page's Updates section lists the starter (these
scripts) and tsum-stats (the website's program), checks for newer versions
every few hours and has a "Check for updates" button. "Update the starter"
downloads the newest scripts, checks them against their published checksum
and puts them in place, then restarts the tool in the same window; the page
reloads by itself. Your adb, apk, server and collected folders, channel.txt
and the device you picked last are left alone, and so is Start-Windows.cmd,
which Windows reads while it runs. Set TSUM_STATS_NO_UPDATE=1 before starting
to stop the automatic checks; the buttons still work.

A copy from before the tool updated itself (it has no starter-version.txt)
needs one update by hand. Every release page offers the tool two ways:

    gap-starter.zip / .tar.gz            these scripts and the app
    gap-starter-scripts.zip / .tar.gz    just the scripts -- no app

To pick up a fix without downloading the app again, take the "-scripts" one
and extract it over the folder you already have, saying yes when asked to
replace files. It unpacks into a folder of the same name, so extracting it
next to the old one lands the new files exactly where the old ones were, and
your adb and apk folders stay as they are. On its own it works too: it fetches
adb the first time, the same as the full bundle does, and only lacks the
"Install APK" option.

Neither carries adb or the website's program, which updates itself (see the
top of this file). If they pin a newer adb than the one already
in your adb folder, the one you have keeps being used -- delete the adb
folder to have the newer one fetched.


Getting logs and stats off the device, and clearing them
--------------------------------------------------------
The quickest way: "Export logs & stats" on the page. It zips up the script
log, the service log, the round stats and the Tsum lists of the device (or of
every device) and asks where to save the zip -- the one file to send when you
ask for help. Chrome and Edge show their own save dialog; other browsers get
your computer's.

A script keeps its log on the device, under
/sdcard/Download/GeneralAutomationPlatform:

    script-<id>.log what the script logged, plus its rotated copies

"Copy script log to folder" copies it to your computer, into a "collected" folder next to this
README -- one folder per device, and the layout the device had:

    collected/127.0.0.1-16384/logs/script-<id>.log

Copying again overwrites what was copied before, and nothing else is touched.

"Delete script log" deletes the same files from the device. It lists what it found and
asks before deleting anything -- and nothing keeps a second copy, so copy
first if you want to keep it.

The service keeps its script log open from the moment it starts, and an emulator
that maps the device's storage onto a folder on your computer will refuse to
delete a file that is still open. So that delete stops the service first, deletes,
and starts it again if it had been running -- which means a new, empty
script log is on the device by the time it finishes. Anything the script was
doing is ended by that stop, exactly as Stop would.

If you started the service with --root=, set GAP_STORAGE_ROOT to that same
folder before running, or the tool looks in the wrong place.

Round stats (stats_*.csv) and Tsum lists: "Import round stats into Stats"
copies them into collected/ and into Tsum Tsum Stats, whose page is at
http://127.0.0.1:8090/ while the starter runs. "Delete round stats" clears
the CSVs off the device; Tsum lists are left alone.


When something goes wrong
-------------------------
"No device found"
    The emulator is not running, or the phone is not in USB debugging mode.
    Unusual emulator port? Set GAP_EXTRA_PORTS="12345" before starting.

"Only one of my emulators is listed"
    Each emulator instance listens on its own port, and this tool probes the
    first four of each family -- MuMu, LDPlayer, Nox and MEmu. A fifth
    instance, or one whose port you changed, needs GAP_EXTRA_PORTS.
    MuMu prints the port under Settings > Other, or run
    MuMuManager.exe adb -v <instance number>.

"unauthorized"
    Look at the phone's screen and tap Allow on the USB debugging prompt,
    then press Refresh.

"wrong ABI" / "The installed APK carries ... only"
    The installed app was built for a different processor than this device
    uses. Emulators cause this most often: one that advertises ARM as well as
    its real x86_64 can extract the ARM libraries out of an all-ABI APK, and
    the service cannot load those. Choose "Download latest APK" -- it fetches
    the build for the ABI shown in the list, which carries nothing else to
    pick wrong.

"not installed"
    Install the app first. See "Installing the app" above.

"the service on this device was started by the app itself"
    A rooted device: the app started the service as root, and nothing this
    tool runs over ADB can stop or replace what root started. It does not
    need to -- the app looks after that service, and everything else here
    (install, download, export, delete) works as usual. After installing a new
    version, reboot the device; the app starts the new one by itself.

"Could not download it" (adb)
    The first run needs the internet, to fetch adb from dl.google.com. No
    connection, or a network that blocks Google downloads? Either set GAP_ADB
    to the full path of an adb you have, or fetch the archive named in
    platform-tools.txt on another computer, take adb out of it (adb.exe and
    its three .dll files on Windows; the file "adb" elsewhere) and put them
    in  adb/windows,  adb/darwin  or  adb/linux  next to this README.

"did not match its checksum"
    The archive Google served is not the one this tool was built against.
    Try once more; if it keeps happening, get the newest -scripts download
    (see "Updating this tool"), whose platform-tools.txt pins a current one.

"Google publishes adb for Linux on x86_64 only"
    An ARM Linux machine, such as a Raspberry Pi. Install your distribution's
    adb (apt install adb) and set GAP_ADB to its full path.

"Refusing to download without a confirmation"
    The tool was run without a terminal to ask in -- from a script, say. Add
    --yes  (-Yes on Windows), which agrees to the download in advance.

"already running ... without the starter"
    Tsum Tsum Stats is open on its own, on the same address the starter uses.
    Stop it (Ctrl+C in its window) and run the starter again: the starter
    brings the stats site with it.

The page does not open
    Open http://127.0.0.1:8090/starter/ yourself. If the terminal shows an
    error instead, or the website's program cannot run on this computer, run
    with --menu (-Menu) for the terminal menu.

The tool replaced my ADB server
    Harmless. Android Studio, scrcpy or your emulator manager will start it
    again by themselves. To avoid it entirely, point the tool at the adb you
    already use:  set GAP_ADB to its full path.


Doing it by hand
----------------
Every menu option is also a command-line option, so nothing needs the page:

    Start-Linux.sh start             (macOS, Linux)
    Start-Windows.cmd -Action start  (Windows)

In place of "start": restart, stop, log, follow, install, update, add-source,
reconnect, copy-script, delete-script. Add  --serial <device>
(or  -Serial <device>  on Windows) to name the device; with more than one
connected and none named, the device picked last in the menu is used. Add
--yes  (-Yes on Windows) to answer the questions in advance: the first
run's adb download, and a delete confirmation. Running it with  --help  lists
them all.

If you cannot run the scripts at all, the two commands they boil down to are:

    adb push device/gap-service.sh /data/local/tmp/gap-service.sh
    adb shell sh /data/local/tmp/gap-service.sh start

using any adb you already have. That is the whole tool.


What is in here
---------------
  Start-Windows.cmd                      the thing you run, on Windows
  Start-Linux.sh                         ... on macOS and Linux
  bin/win/*.ps1                          Windows launcher and menu (PowerShell)
  bin/posix/*.sh                         macOS and Linux launcher and menu (shell)
  tsum-stats.txt                         where the website's program is
                                         downloaded from, and its checksum
  starter-version.txt                    this copy's version, and where it
                                         looks for a newer one
  device/gap-service.sh                  what actually runs on the device
  device/PROTOCOL.md                     how the two talk to each other
  platform-tools.txt                     where adb is downloaded from, and the
                                         checksum the download must match
  test/check-parity.sh                   self-test, needs no device
  server/                                appears on the first run: tsum-stats,
                                         the website's program
  adb/                                   appears on the first run: Google's adb
                                         for this computer
  collected/                             appears when you copy the log off a device
  last-device.txt                        appears once you pick a device: which one
  channel.txt                            appears once you pin a pre-release channel

No program is in this bundle as downloaded. Two binaries land here on the
first run, each checked against a checksum recorded when this tool was built:
Google's adb, unmodified, from the official Android platform-tools release,
and tsum-stats, Tsum Tsum Stats' open-source program, from its GitHub release.
