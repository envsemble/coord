; Coord installs for the current user only: no install-for-all-users choice and no elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Uninstalling (not the uninstall an update runs first) disconnects Claude Code and Codex from the
; agent folder's plugin, takes the coord command off the user's Path and forgets the agent folder's
; state (remove-agent.ps1), so that installing again sets it up again.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\remove-agent.ps1" "${BUILD_RESOURCES_DIR}\remove-agent.ps1"
    ; Run as a script block read from the file, which no execution policy applies to (it would to
    ; -File, even with -ExecutionPolicy Bypass when a group policy sets one); its path comes in the
    ; environment, so nothing in it is quoted for the command line.
    System::Call 'Kernel32::SetEnvironmentVariable(t "COORD_REMOVE_AGENT", t "$PLUGINSDIR\remove-agent.ps1")'
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($$env:COORD_REMOVE_AGENT)))"'
    Pop $0
  ${endIf}
!macroend
