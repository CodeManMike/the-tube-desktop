# Samples total CPU and private memory across every process with the given name.
# Usage: pwsh scripts/measure.ps1 -ProcessName electron -Seconds 60
# For Edge, close every other Edge window first: all msedge processes are summed.
param(
  [Parameter(Mandatory)] [string] $ProcessName,
  [int] $Seconds = 60
)

$cores = [Environment]::ProcessorCount
$paths = "\Process($ProcessName*)\% Processor Time", "\Process($ProcessName*)\Private Bytes"
$cpu = @(); $mem = @()

# Exact name only: "msedge*" would also match msedgewebview2 (Widgets, Teams, Outlook...).
$exact = "^$([regex]::Escape($ProcessName.ToLower()))(#\d+)?$"
Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples $Seconds -ErrorAction SilentlyContinue | ForEach-Object {
  # Processes starting/exiting mid-sample yield invalid entries (Status != 0); skip them.
  $samples = $_.CounterSamples | Where-Object { $_.InstanceName -match $exact -and $_.Status -eq 0 }
  $cpu += ($samples | Where-Object Path -like '*% processor time' | Measure-Object CookedValue -Sum).Sum / $cores
  $mem += ($samples | Where-Object Path -like '*private bytes' | Measure-Object CookedValue -Sum).Sum / 1MB
}

$c = $cpu | Measure-Object -Average -Maximum
$m = $mem | Measure-Object -Average -Maximum
'{0}: CPU avg {1:N1}% peak {2:N1}% | RAM avg {3:N0} MB peak {4:N0} MB ({5} samples, {6} cores)' -f `
  $ProcessName, $c.Average, $c.Maximum, $m.Average, $m.Maximum, $cpu.Count, $cores
