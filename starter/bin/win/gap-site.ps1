# The starter's website -- the twin of bin/posix/gap-site.sh. Dot-sourced by
# gap.ps1, after gap-device.ps1.
#
# tsum-stats (Tsum Tsum Stats' program) serves it, started with --starter
# pointing at this folder: the starter at /starter/, the stats site at /. It is
# downloaded once into server\windows-amd64\ and checked against the pin in
# tsum-stats.txt. GAP_STARTER_SERVER names a local build instead. Windows on
# ARM runs the amd64 build under emulation.
#
# The pin is a floor, not an exact version: tsum-stats updates itself on each
# launch and from the page's Update button, and must not be rolled back.

$global:SitePinFile = Join-Path $Bundle 'tsum-stats.txt'
$global:SiteDir     = Join-Path $Bundle 'server\windows-amd64'
$global:SiteBin     = Join-Path $global:SiteDir 'tsum-stats.exe'
$global:SiteVerFile = Join-Path $global:SiteDir 'VERSION'
# The exit statuses tsum-stats leaves with after the page installed an update:
# a new tsum-stats, which Start-Site starts again, or new starter scripts, for
# which gap.ps1 runs itself again.
$global:SiteRestartCode = 75
$global:SiteReloadCode  = 76

function Get-SitePin {
  param([string]$Key)
  if (-not (Test-Path -LiteralPath $global:SitePinFile)) { return '' }
  return Get-Kv -Text (Get-Content -LiteralPath $global:SitePinFile -Raw) -Key $Key
}

# Dotted version $A is $B or newer.
function Test-VersionAtLeast {
  param([string]$A, [string]$B)
  $as = $A.Split('.'); $bs = $B.Split('.')
  for ($i = 0; $i -lt [math]::Max($as.Count, $bs.Count); $i++) {
    $x = 0; $y = 0
    if ($i -lt $as.Count) { [void][int]::TryParse($as[$i], [ref]$x) }
    if ($i -lt $bs.Count) { [void][int]::TryParse($bs[$i], [ref]$y) }
    if ($x -ne $y) { return $x -gt $y }
  }
  return $true
}

function Get-SiteVersion {
  if (-not (Test-Path -LiteralPath $global:SiteVerFile)) { return '' }
  return "$(Get-Content -LiteralPath $global:SiteVerFile -TotalCount 1)".Trim()
}

# Records the installed program's own version, after it may have changed.
function Save-SiteVersion {
  $ErrorActionPreference = 'Continue'  # this scope only: redirected stderr must not throw
  $v = "$(& $global:SiteBin --version 2>$null)".Trim().Split(' ')[-1]
  if ($v) { [IO.File]::WriteAllText($global:SiteVerFile, "$v`n") }
}

# Fetches the pinned program when it is missing or older than the pin. Asks
# first; -Yes answers for a caller with no console.
function Get-SiteProgram {
  $url     = Get-SitePin 'url_windows_amd64'
  $want    = Get-SitePin 'sha256_windows_amd64'
  $size    = Get-SitePin 'size_windows_amd64'
  $version = Get-SitePin 'version'
  if (-not $url -or -not $want) {
    Write-Log "error: tsum-stats.txt is missing or names no Windows build, so the website's"
    Write-Log "  program cannot be fetched. Extract the bundle again, set GAP_STARTER_SERVER,"
    Write-Log "  or run with -Menu for the terminal menu."
    return $false
  }
  $have = Get-SiteVersion
  if ((Test-Path -LiteralPath $global:SiteBin) -and $have -and (Test-VersionAtLeast $have $version)) {
    return $true
  }

  $mb = [math]::Round(([double]$size) / 1MB)
  Write-Log "The starter's website needs its program, tsum-stats $version, and it is not here yet."
  Write-Log "  fetch : $url"
  if ($mb -gt 0) { Write-Log "  size  : about $mb MB" }
  Write-Log "  into  : server\windows-amd64"
  Write-Log "  check : sha256 from tsum-stats.txt, recorded when this tool was built"
  if (-not $global:AssumeYes) {
    $ans = Read-Host "`n  download it now? [Y/n]"
    if ($ans -and $ans -notmatch '^(y|yes)$') {
      Write-Log "Nothing was downloaded. Run with -Menu for the terminal menu."
      return $false
    }
  }

  New-Item -ItemType Directory -Force -Path $global:SiteDir | Out-Null
  $tmp = "$global:SiteBin.download"
  Write-Log "downloading tsum-stats $version ..."
  if (-not (Get-UrlToFile -Url $url -Dest $tmp)) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Write-Log "Could not download it. Check the internet connection and try again."
    return $false
  }
  if ((Get-Sha256 -Path $tmp) -ne $want.ToLower()) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Write-Log "The download did not match its checksum and was deleted. Nothing was kept."
    return $false
  }
  Write-Log "  sha256 ok"
  Move-Item -LiteralPath $tmp -Destination $global:SiteBin -Force
  [IO.File]::WriteAllText($global:SiteVerFile, "$version`n")
  return $true
}

# Updates the downloaded program when a newer one is published. Quiet unless
# it did; offline it just keeps the one it has. TSUM_STATS_NO_UPDATE skips it.
function Update-SiteProgram {
  if ($env:TSUM_STATS_NO_UPDATE) { return }
  $ErrorActionPreference = 'Continue'  # this scope only: its stderr must not throw
  $before = Get-SiteVersion
  # Shows only its "Updating ..." line; a failed check says nothing.
  & $global:SiteBin update 2>&1 | ForEach-Object {
    if ("$_" -match '(Updating Tsum Tsum Stats .*)$') { Write-Log $Matches[1] }
  }
  Save-SiteVersion
  $after = Get-SiteVersion
  if ($after -ne $before) { Write-Log "Updated tsum-stats $(if ($before) { $before } else { '?' }) -> $after." }
}

# Runs the website in this console and opens it; closing the console stops it.
# Returns SiteReloadCode when the page installed new starter scripts.
function Start-Site {
  $bin = $env:GAP_STARTER_SERVER
  if (-not $bin) {
    # Update first, so a newer floor from a starter update never asks to download.
    $had = Test-Path -LiteralPath $global:SiteBin
    if ($had) { Update-SiteProgram }
    if (-not (Get-SiteProgram)) { return 1 }
    # A fresh download is only the pinned floor; bring it to the newest release.
    if (-not $had) { Update-SiteProgram }
    $bin = $global:SiteBin
  }
  $open = @('--open')
  if ($env:GAP_STARTER_RELOADED) {
    $open = @()  # the page is already open, and reloads itself
  } else {
    Write-Log ""
    Write-Log "Opening the starter in your browser: http://127.0.0.1:8090/starter/"
    Write-Log "Keep this window open while you use it. Ctrl+C here (or closing the window) stops it."
    Write-Log ""
  }
  $env:TSUM_STATS_RESTART_CODE = "$global:SiteRestartCode"
  $env:GAP_STARTER_RELOAD_CODE = "$global:SiteReloadCode"
  while ($true) {
    # Out-Host: its output to the console, not into this function's return value.
    & $bin serve --starter $Bundle @open | Out-Host
    $rc = $LASTEXITCODE
    $open = @()
    if ($rc -eq $global:SiteReloadCode) {
      Write-Log ""
      Write-Log "Restarting the starter with its new scripts ..."
      return $rc
    }
    if ($rc -ne $global:SiteRestartCode) { return $rc }
    if (-not $env:GAP_STARTER_SERVER) { Save-SiteVersion }
    Write-Log ""
    Write-Log "Restarting the starter with the new tsum-stats ..."
  }
}
