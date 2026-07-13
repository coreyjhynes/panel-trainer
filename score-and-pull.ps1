<#
.SYNOPSIS
    Panel Install Trainer - submit a panel STATE for scoring, then pull results.

.DESCRIPTION
    One self-contained script that exercises the external scoring API:
       1) POST a panel state (circuits + installed breakers/wires) -> the API
          SCORES it server-side and returns one result  ("request scoring")
       2) GET all recorded results back with a summary       ("pull the results")
    Scoring and storage are fully external - the app/script never computes a
    score. Each submission is one record per instanceId (re-posting the same
    instanceId replaces its result).

.PARAMETER ApiBase
    Base URL. Defaults to the live Azure Static Web App.

.PARAMETER Difficulty
    Label stored with the record (basic | standard | advanced). Default standard.

.PARAMETER Count
    How many independent runs to submit. Default 1. With Count > 1 the script
    alternates correct/miswired states so the pulled list shows a mix.

.PARAMETER Miswire
    Submit an intentionally miswired state (undersized range conductor) to show
    a failing score.

.PARAMETER CsvPath
    Optional. Also export the pulled results to this CSV file.

.EXAMPLE
    .\score-and-pull.ps1
.EXAMPLE
    .\score-and-pull.ps1 -Miswire
.EXAMPLE
    .\score-and-pull.ps1 -Count 5 -CsvPath .\scores.csv
.EXAMPLE
    .\score-and-pull.ps1 -ApiBase http://localhost:8781
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net",
    [ValidateSet("basic", "standard", "advanced")] [string]$Difficulty = "standard",
    [int]$Count = 1,
    [switch]$Miswire,
    [string]$CsvPath
)

$ErrorActionPreference = "Stop"
$apiUrl = "$($ApiBase.TrimEnd('/'))/api/scores"

# Build a small panel state: a kitchen small-appliance circuit + a 240V range.
# Correct wiring scores 100; a miswired range (12 AWG on a 40A breaker) fails.
function New-PanelState([bool]$bad, [string]$instanceId) {
    $rangeWire = if ($bad) { 12 } else { 8 }
    return @{
        instanceId  = $instanceId
        difficulty  = $Difficulty
        durationSec = Get-Random -Minimum 20 -Maximum 120
        circuits    = @(
            @{ uid = "k1"; name = "Kitchen small-appliance #1"; v = 120; amps = 20; wire = 12; protection = "dual"; hvac = $false },
            @{ uid = "r1"; name = "Electric range";             v = 240; amps = 40; wire = 8;  protection = "gfci"; hvac = $false }
        )
        units       = @(
            @{ id = 1; slot = 1; poles = 1; amps = 20; type = "dual"; terminals = @{ A = 12 } },
            @{ id = 2; slot = 3; poles = 2; amps = 40; type = "gfci"; terminals = @{ A = $rangeWire; B = $rangeWire } }
        )
    }
}

# ---------------------------------------------------------------------------
# 1) REQUEST SCORING  -  POST panel state(s); the API scores each server-side
# ---------------------------------------------------------------------------
Write-Host "Submitting $Count panel state(s) to $apiUrl for scoring" -ForegroundColor Cyan
for ($i = 1; $i -le $Count; $i++) {
    $bad = if ($Count -gt 1) { ($i % 2) -eq 0 } else { [bool]$Miswire }
    $state = New-PanelState $bad ("ps-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

    $result = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
                                -Body ($state | ConvertTo-Json -Depth 6) -TimeoutSec 15
    Write-Host ("  scored {0}% ({1}) - {2} fault(s), {3} critical [id {4}]" -f `
        $result.score, $(if ($result.pass) { "PASS" } else { "FAIL" }), $result.faults, $result.critical, $result.id) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 2) PULL RESULTS  -  GET all records back
# ---------------------------------------------------------------------------
Write-Host "`nPulling all records from $apiUrl" -ForegroundColor Cyan
$data = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15
# Flatten: Windows PowerShell 5.1 wraps a single-element JSON array oddly.
$records = @($data | ForEach-Object { $_ })

if ($records.Count -eq 0) { Write-Host "No records returned."; return }

$records |
    Select-Object ts, difficulty, score, pass, faults, critical, durationSec |
    Format-Table -AutoSize

$passCount = @($records | Where-Object { $_.pass }).Count
$avg  = [math]::Round((($records | Measure-Object -Property score -Average).Average), 1)
$rate = [math]::Round((100.0 * $passCount / $records.Count), 1)
Write-Host ("Total {0} | Passed {1} | Pass rate {2}% | Avg score {3}%" -f `
    $records.Count, $passCount, $rate, $avg) -ForegroundColor Green

if ($CsvPath) {
    $records | Export-Csv -Path $CsvPath -NoTypeInformation -Encoding UTF8
    Write-Host "Exported $($records.Count) records to $CsvPath" -ForegroundColor Green
}
