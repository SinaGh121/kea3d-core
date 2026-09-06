param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$RootProcessId,

  [Parameter(Mandatory = $true)]
  [string]$StopFile,

  [ValidateRange(50, 5000)]
  [int]$IntervalMilliseconds = 200
)

$ErrorActionPreference = 'Stop'
$peakWorkingSetBytes = 0L
$peakPrivateBytes = 0L
$peakRendererWorkingSetBytes = 0L
$peakGpuProcessWorkingSetBytes = 0L
$peakGpuDedicatedBytes = $null
$peakGpuSharedBytes = $null
$samples = 0
$cpuStartByProcess = @{}
$cpuLatestByProcess = @{}
$gpuCountersAvailable = $true
$gpuCounterMatches = 0

function Get-ProcessTreeSnapshot {
  # Capture the root before the slower CIM traversal so short-lived workers still
  # contribute at least one real memory sample.
  $rootProcess = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
  $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CommandLine -ErrorAction SilentlyContinue)
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($row in $rows) {
      if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) {
        $changed = $true
      }
    }
  }

  $commandLines = @{}
  foreach ($row in $rows) {
    if ($ids.Contains([int]$row.ProcessId)) {
      $commandLines[[int]$row.ProcessId] = [string]$row.CommandLine
    }
  }

  $workingSetBytes = 0L
  $privateBytes = 0L
  $rendererWorkingSetBytes = 0L
  $gpuProcessWorkingSetBytes = 0L
  foreach ($processId in $ids) {
    $process = if ($processId -eq $RootProcessId -and $rootProcess) {
      $rootProcess
    } else {
      Get-Process -Id $processId -ErrorAction SilentlyContinue
    }
    if (-not $process) { continue }
    $workingSetBytes += [long]$process.WorkingSet64
    $privateBytes += [long]$process.PrivateMemorySize64
    if ($null -ne $process.CPU) {
      if (-not $cpuStartByProcess.ContainsKey($processId)) { $cpuStartByProcess[$processId] = [double]$process.CPU }
      $cpuLatestByProcess[$processId] = [double]$process.CPU
    }
    $commandLine = $commandLines[$processId]
    if ($commandLine -match '--type=renderer') { $rendererWorkingSetBytes += [long]$process.WorkingSet64 }
    if ($commandLine -match '--type=gpu-process') { $gpuProcessWorkingSetBytes += [long]$process.WorkingSet64 }
  }

  $gpuDedicatedBytes = $null
  $gpuSharedBytes = $null
  if ($gpuCountersAvailable) {
    try {
      $counter = Get-Counter -Counter '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage' -ErrorAction Stop
      $matchedGpuCounters = 0
      $matchedGpuDedicatedBytes = 0L
      $matchedGpuSharedBytes = 0L
      foreach ($sample in $counter.CounterSamples) {
        if ($sample.InstanceName -notmatch 'pid_(\d+)_') { continue }
        if (-not $ids.Contains([int]$Matches[1])) { continue }
        $matchedGpuCounters += 1
        $script:gpuCounterMatches += 1
        if ($sample.Path -match 'Dedicated Usage$') { $matchedGpuDedicatedBytes += [long]$sample.CookedValue }
        if ($sample.Path -match 'Shared Usage$') { $matchedGpuSharedBytes += [long]$sample.CookedValue }
      }
      if ($matchedGpuCounters -gt 0) {
        $gpuDedicatedBytes = $matchedGpuDedicatedBytes
        $gpuSharedBytes = $matchedGpuSharedBytes
      }
    } catch {
      $script:gpuCountersAvailable = $false
    }
  }

  return [pscustomobject]@{
    WorkingSetBytes = $workingSetBytes
    PrivateBytes = $privateBytes
    RendererWorkingSetBytes = $rendererWorkingSetBytes
    GpuProcessWorkingSetBytes = $gpuProcessWorkingSetBytes
    GpuDedicatedBytes = $gpuDedicatedBytes
    GpuSharedBytes = $gpuSharedBytes
  }
}

Write-Output 'READY'
while (-not (Test-Path -LiteralPath $StopFile)) {
  $snapshot = Get-ProcessTreeSnapshot
  $samples += 1
  $peakWorkingSetBytes = [Math]::Max($peakWorkingSetBytes, $snapshot.WorkingSetBytes)
  $peakPrivateBytes = [Math]::Max($peakPrivateBytes, $snapshot.PrivateBytes)
  $peakRendererWorkingSetBytes = [Math]::Max($peakRendererWorkingSetBytes, $snapshot.RendererWorkingSetBytes)
  $peakGpuProcessWorkingSetBytes = [Math]::Max($peakGpuProcessWorkingSetBytes, $snapshot.GpuProcessWorkingSetBytes)
  if ($null -ne $snapshot.GpuDedicatedBytes) {
    $peakGpuDedicatedBytes = if ($null -eq $peakGpuDedicatedBytes) { $snapshot.GpuDedicatedBytes } else { [Math]::Max($peakGpuDedicatedBytes, $snapshot.GpuDedicatedBytes) }
    $peakGpuSharedBytes = if ($null -eq $peakGpuSharedBytes) { $snapshot.GpuSharedBytes } else { [Math]::Max($peakGpuSharedBytes, $snapshot.GpuSharedBytes) }
  }
  Start-Sleep -Milliseconds $IntervalMilliseconds
}

$mebibyte = 1024 * 1024
$observedCpuSeconds = 0.0
foreach ($processId in $cpuLatestByProcess.Keys) {
  $observedCpuSeconds += [Math]::Max(0, $cpuLatestByProcess[$processId] - $cpuStartByProcess[$processId])
}
[pscustomobject]@{
  available = $samples -gt 0
  intervalMs = $IntervalMilliseconds
  samples = $samples
  peakWorkingSetMiB = [Math]::Round($peakWorkingSetBytes / $mebibyte, 3)
  peakPrivateMemoryMiB = [Math]::Round($peakPrivateBytes / $mebibyte, 3)
  peakRendererWorkingSetMiB = [Math]::Round($peakRendererWorkingSetBytes / $mebibyte, 3)
  peakGpuProcessWorkingSetMiB = [Math]::Round($peakGpuProcessWorkingSetBytes / $mebibyte, 3)
  peakGpuDedicatedMiB = if ($null -eq $peakGpuDedicatedBytes) { $null } else { [Math]::Round($peakGpuDedicatedBytes / $mebibyte, 3) }
  peakGpuSharedMiB = if ($null -eq $peakGpuSharedBytes) { $null } else { [Math]::Round($peakGpuSharedBytes / $mebibyte, 3) }
  gpuCountersAvailable = $gpuCountersAvailable
  gpuCounterMatches = $gpuCounterMatches
  observedCpuSeconds = [Math]::Round($observedCpuSeconds, 3)
} | ConvertTo-Json -Compress
