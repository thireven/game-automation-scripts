@echo off
rem Tsum Tsum Script service starter -- Windows.
rem
rem No executable of our own: this hands straight to Windows PowerShell, which
rem every supported Windows already has. -ExecutionPolicy Bypass applies to
rem this invocation only and changes nothing on the machine.
rem
rem gap.ps1 logs each run to starter-log.txt; the run before is kept as
rem starter-log.prev.txt. Self-updates never replace this file, so the label
rem below is safe to call after PowerShell returns.
setlocal
set "GAP_STARTER_LOG=%~dp0starter-log.txt"
if exist "%GAP_STARTER_LOG%" move /y "%GAP_STARTER_LOG%" "%~dp0starter-log.prev.txt" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bin\win\gap.ps1" %* || call :failed %%errorlevel%%
exit /b

:failed
rem Ctrl+C: closed on purpose, nothing to report.
if "%1"=="-1073741510" exit /b
rem No log means PowerShell never reached gap.ps1, so record what we can here.
if exist "%GAP_STARTER_LOG%" goto failed_show
>"%GAP_STARTER_LOG%" echo Start-Windows.cmd: PowerShell exited with code %1 before gap.ps1 started its log.
>>"%GAP_STARTER_LOG%" echo time: %date% %time%
>>"%GAP_STARTER_LOG%" echo folder: "%~dp0"
>>"%GAP_STARTER_LOG%" ver
>>"%GAP_STARTER_LOG%" 2>&1 where powershell.exe
>>"%GAP_STARTER_LOG%" 2>&1 powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion.ToString(); Get-ExecutionPolicy -List | Out-String"
:failed_show
echo.
echo The starter stopped with an error (exit code %1).
echo A log of this run is in "%GAP_STARTER_LOG%"
echo Please send that file along when asking for help.
pause
exit /b %1
