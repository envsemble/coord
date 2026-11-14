# Run by the Windows uninstaller (installer.nsh), not on an update. It disconnects Claude Code and
# Codex from the Atlas plugin in the agent folder, as Settings > Agents does (main/agent/agents.ts):
# their plugin would otherwise call a command that is gone. It takes the atlas command's folder
# (%USERPROFILE%\.atlas\agent\bin, which the app put there; main/agent/userPath.ts) off the user's
# Path, keeping every other entry and the value's type, and forgets the agent folder's state, the
# programs chosen for the agents, their activity and the finished onboarding, so that installing
# Atlas again sets them up again. The plugin's files stay.
#
# Best effort: nothing here fails the uninstall, and the agents' commands have a minute and a half in all.
# -KeepRegistry, for its test, neither reads nor writes the registry: only the PATH given is searched.
param([switch] $KeepRegistry)
$ErrorActionPreference = 'Stop'
# The app puts the command on the Path only on its default home, never on one ATLAS_HOME chooses (main/index.ts).
$agent = Join-Path $env:USERPROFILE '.atlas\agent'
# A path as Windows compares it: variables expanded, either slash, no trailing one (and -eq ignores case).
function Get-EntryKey([string] $Entry) { [Environment]::ExpandEnvironmentVariables($Entry.Trim()).Replace('/', '\').TrimEnd('\') -replace '^\\\\\?\\(?!UNC\\)', '' }
$system = Join-Path $env:SystemRoot 'System32'

$deadline = (Get-Date).AddSeconds(90)
# Run an agent's command (a .cmd shim through cmd.exe), with its output; null when it fails or runs
# past the deadline, when it is stopped with the programs it started.
function Invoke-Agent([string] $Program, [string[]] $Arguments) {
  $left = [int]($deadline - (Get-Date)).TotalMilliseconds
  if ($left -le 0) { return $null }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  if ($Program -match '\.(cmd|bat)$') {
    $start.FileName = Join-Path $system 'cmd.exe'
    $start.Arguments = '/d /s /c ""' + $Program + '" ' + ($Arguments -join ' ') + '"'
  } else {
    $start.FileName = $Program
    $start.Arguments = $Arguments -join ' '
  }
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding $false
  try {
    $process = [System.Diagnostics.Process]::Start($start)
    $output = $process.StandardOutput.ReadToEndAsync()
    [void]$process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($left)) {
      & (Join-Path $system 'taskkill.exe') /pid $process.Id /t /f 2>&1 | Out-Null
      return $null
    }
    if ($process.ExitCode -ne 0) { return $null }
    # A child the agent left running may hold its output open: wait for it no longer than the time left.
    if (-not $output.Wait([Math]::Max($left, 1000))) { return $null }
    return $output.Result
  } catch { return $null }
}

# The agents are found on the PATH as it is in the registry now: one installed since the uninstaller
# started is on it there.
if (-not $KeepRegistry) {
  $env:Path = @($env:Path, [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';'
}
$folder = Get-EntryKey $agent
# The programs chosen in Settings > Agents for agents the PATH does not have (main/agent/programs.ts).
$chosen = @{}
try { (Get-Content -LiteralPath (Join-Path $agent 'programs.json') -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $chosen[$_.Name] = [string]$_.Value } } catch { }
# Each agent's plugin list says where its Atlas plugin came from; only one from the agent folder is
# removed, never one a checkout installed (atlas setup).
$agents = @(
  @{ Id = 'claude'; Program = 'claude'; Name = '^claude\.exe$'; List = @('plugin', 'list', '--json'); Uninstall = @(@('plugin', 'uninstall', 'atlas@atlas'), @('plugin', 'marketplace', 'remove', 'atlas'))
     Source = { param($listed) $entry = @($listed | Where-Object { $_.id -eq 'atlas@atlas' })[0]; if ($entry.readFromFolder) { Split-Path -Parent $entry.readFromFolder } } },
  @{ Id = 'codex'; Program = 'codex'; Name = '^codex\.(exe|cmd)$'; List = @('plugin', 'list', '--json', '--marketplace', 'atlas'); Uninstall = @(@('plugin', 'remove', 'atlas@atlas'), @('plugin', 'marketplace', 'remove', 'atlas'))
     Source = { param($listed) $entry = @($listed.installed | Where-Object { $_.pluginId -eq 'atlas@atlas' })[0]; $entry.marketplaceSource.source } }
)
foreach ($item in $agents) {
  try {
    # The program chosen for the agent, as the app uses it (the agent's by its name, at a full path
    # that is there; anything else is ignored), else the one on the PATH.
    $program = $chosen[$item.Id]
    if (-not $program -or -not [IO.Path]::IsPathRooted($program) -or (Split-Path -Leaf $program) -notmatch $item.Name -or -not (Test-Path -LiteralPath $program -PathType Leaf)) { $program = @(Get-Command $item.Program -CommandType Application -ErrorAction SilentlyContinue)[0].Source }
    if (-not $program) { continue }
    $listed = Invoke-Agent $program $item.List
    if (-not $listed) { continue }
    $source = & $item.Source ($listed | ConvertFrom-Json)
    if (-not $source -or (Get-EntryKey $source) -ne $folder) { continue }
    foreach ($command in $item.Uninstall) { [void](Invoke-Agent $program $command) }
  } catch { }
}

if (-not $KeepRegistry) {
  try {
    $entry = Get-EntryKey (Join-Path $agent 'bin')
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($key) {
      $value = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
      if ($value) {
        $entries = $value -split ';'
        $kept = @($entries | Where-Object { -not $_.Trim() -or (Get-EntryKey $_) -ne $entry })
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
  } catch { }
}
Remove-Item -LiteralPath (Join-Path $agent 'state.json'), (Join-Path $agent 'programs.json'), (Join-Path $agent 'onboarding.json'), (Join-Path $agent 'activity') -Recurse -Force -ErrorAction SilentlyContinue
exit 0
