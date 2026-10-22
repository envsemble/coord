# Run by the Windows uninstaller (installer.nsh), not on an update: takes the atlas command's folder
# (<Atlas home>\agent\bin, which the app put there; main/agent/userPath.ts) off the user's Path,
# keeping every other entry and the value's type, and forgets the agent folder's state and the
# finished onboarding, so that installing Atlas again sets them up again. The plugin's files stay.
$ErrorActionPreference = 'Stop'
$atlasHome = if ($env:ATLAS_HOME) { $env:ATLAS_HOME -replace '^~(?=$|[\\/])', $env:USERPROFILE } else { Join-Path $env:USERPROFILE '.atlas' }
$agent = Join-Path $atlasHome 'agent'
$entry = (Join-Path $agent 'bin').TrimEnd('\')

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($key) {
  $value = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
  if ($value) {
    $entries = $value -split ';'
    # Compared as Windows does: variables expanded, any case, either slash, no trailing one.
    $kept = @($entries | Where-Object { -not $_.Trim() -or ([Environment]::ExpandEnvironmentVariables($_.Trim()).Replace('/', '\').TrimEnd('\') -ne $entry) })
    if ($kept.Count -ne $entries.Count) {
      $key.SetValue('Path', ($kept -join ';'), $key.GetValueKind('Path'))
      try {
        Add-Type -Namespace Atlas -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
        $result = [UIntPtr]::Zero
        [void][Atlas.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
      } catch { }
    }
  }
  $key.Close()
}
Remove-Item -LiteralPath (Join-Path $agent 'state.json'), (Join-Path $agent 'onboarding.json') -Force -ErrorAction SilentlyContinue
