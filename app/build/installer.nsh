; Atlas installs for the current user only: no install-for-all-users choice and no elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Uninstalling (not the uninstall an update runs first) takes the atlas command off the user's Path
; and forgets the agent folder's state (remove-agent.ps1), so that installing again sets it up again.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\remove-agent.ps1" "${BUILD_RESOURCES_DIR}\remove-agent.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-agent.ps1"'
    Pop $0
  ${endIf}
!macroend
