param(
  [string]$RepoPath = ".",
  [int]$DebounceSeconds = 45
)

$ErrorActionPreference = "Continue"

$repo = (Resolve-Path $RepoPath).Path

function Write-Log {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] $Message"
}

function Should-SkipPath {
  param([string]$FullPath)
  if ([string]::IsNullOrWhiteSpace($FullPath)) { return $true }
  $p = $FullPath.Replace("/", "\").ToLowerInvariant()
  return $p.Contains("\.git\") -or $p.Contains("\node_modules\")
}

function Invoke-AutoSync {
  $inside = & git -C $repo rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -ne 0 -or $inside -ne "true") {
    Write-Log "Not a git repository: $repo"
    return
  }

  $changes = & git -C $repo status --porcelain
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Could not read git status."
    return
  }
  if (-not $changes) { return }

  Write-Log "Changes detected. Auto-committing..."
  & git -C $repo add -A
  if ($LASTEXITCODE -ne 0) {
    Write-Log "git add failed."
    return
  }

  $msg = "chore(auto): checkpoint $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  & git -C $repo commit -m $msg
  if ($LASTEXITCODE -ne 0) {
    Write-Log "git commit skipped/failed (possibly no staged changes)."
    return
  }
  Write-Log "Auto-commit complete. Pushing..."

  & git -C $repo push -u origin HEAD
  if ($LASTEXITCODE -ne 0) {
    & git -C $repo push origin HEAD
  }
  if ($LASTEXITCODE -eq 0) {
    Write-Log "Auto-push complete."
  } else {
    Write-Log "Push failed. Will retry on next change."
  }
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $repo
$watcher.IncludeSubdirectories = $true
$watcher.Filter = "*.*"
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size, CreationTime'
$watcher.EnableRaisingEvents = $true

$script:syncTimer = New-Object System.Timers.Timer
$script:syncTimer.Interval = [Math]::Max(5, $DebounceSeconds) * 1000
$script:syncTimer.AutoReset = $false

$onTimer = Register-ObjectEvent -InputObject $script:syncTimer -EventName Elapsed -Action {
  Invoke-AutoSync
}

$onChange = {
  $path = ""
  try { $path = $Event.SourceEventArgs.FullPath } catch {}
  if (Should-SkipPath $path) { return }
  $script:syncTimer.Stop()
  $script:syncTimer.Start()
}

$evtChanged = Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $onChange
$evtCreated = Register-ObjectEvent -InputObject $watcher -EventName Created -Action $onChange
$evtDeleted = Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action $onChange
$evtRenamed = Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $onChange

Write-Log "Auto git sync started for: $repo"
Write-Log "Debounce: $DebounceSeconds seconds"
Write-Log "Press Ctrl+C to stop."

try {
  while ($true) { Wait-Event -Timeout 5 | Out-Null }
} finally {
  Unregister-Event -SourceIdentifier $evtChanged.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $evtCreated.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $evtDeleted.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $evtRenamed.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $onTimer.Name -ErrorAction SilentlyContinue
  $watcher.Dispose()
  $script:syncTimer.Dispose()
}
