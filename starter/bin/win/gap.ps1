# Tsum Tsum Script service starter -- Windows entry point.
#
# The twin of bin/posix/gap.sh, and deliberately as small: unblock the bundle,
# load the shared layers, then open the starter website (gap-site.ps1). -Menu
# shows the terminal menu instead, and -Action runs just that one action.

param(
  [string]$Serial,
  [string]$Action,
  # A pre-release folder URL for `update`, remembered in channel.txt; 'off'
  # returns to the published releases.
  [string]$Channel,
  # Answers the questions in advance -- the delete confirmation, and the
  # first run's adb download -- for a caller with no console to answer in.
  [switch]$Yes,
  # The terminal menu instead of the website.
  [switch]$Menu,
  # Accepted and ignored: the menu is the only front-end, and older
  # instructions in the wild still pass this.
  [switch]$Console
)

$ErrorActionPreference = 'Stop'
$Bundle = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Everything this console shows also goes to starter-log.txt, so a window that
# closes too fast to read still leaves a record. A reload runs this file again
# inside the same transcript; an -Action caller is not logged.
$ownLog = $false
if (-not $Action -and -not $global:GapStarterLogging) {
  $log = if ($env:GAP_STARTER_LOG) { $env:GAP_STARTER_LOG } else { Join-Path $Bundle 'starter-log.txt' }
  try {
    Start-Transcript -LiteralPath $log -Force | Out-Null
    $global:GapStarterLogging = $ownLog = $true
  } catch {}
}

# Every exit goes through here, so the log ends with how the run ended.
function Exit-Starter {
  param([int]$Code)
  if ($ownLog) {
    if ($Code -ne 0) { Write-Host "Starter exited with code $Code." }
    try { Stop-Transcript | Out-Null } catch {}
  }
  exit $Code
}

# An unhandled error: record where it came from, not just the message.
trap {
  Write-Host "error: $_" -ForegroundColor Red
  Write-Host $_.ScriptStackTrace
  Exit-Starter 1
}
# Before Resolve-Adb, which may ask; gap-menu.ps1 sets it again for itself.
if ($Yes) { $global:AssumeYes = $true }

# Files extracted from a downloaded zip carry Mark-of-the-Web, which can make
# PowerShell refuse to dot-source them. Cheap insurance.
Get-ChildItem -LiteralPath $Bundle -Recurse -Include *.ps1, *.cmd -ErrorAction SilentlyContinue |
  Unblock-File -ErrorAction SilentlyContinue

. "$Bundle\bin\win\gap-device.ps1"
. "$Bundle\bin\win\gap-actions.ps1"
. "$Bundle\bin\win\gap-site.ps1"

if ($Channel) {
  if (-not (Set-Channel -Url $Channel)) { Exit-Starter 2 }
} elseif (Test-ChannelActive) {
  Write-Host "release channel: $global:ReleaseBase"
}

# The website finds its own adb, so it starts before any of that.
if (-not $Action -and -not $Menu) {
  $rc = Start-Site
  if ($rc -eq $global:SiteReloadCode) {
    # The page installed new scripts: run the new gap.ps1 in this same process,
    # so Start-Windows.cmd is not read again until the very end.
    $env:GAP_STARTER_RELOADED = '1'
    & "$Bundle\bin\win\gap.ps1" @PSBoundParameters
    Exit-Starter $LASTEXITCODE
  }
  Exit-Starter $rc
}

if (-not (Resolve-Adb -Bundle $Bundle)) { Exit-Starter 1 }
Start-AdbServer

& "$Bundle\bin\win\gap-menu.ps1" -Bundle $Bundle -Serial $Serial -Action $Action -Yes:$Yes
Exit-Starter $LASTEXITCODE
