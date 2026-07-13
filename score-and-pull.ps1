<#
.SYNOPSIS
    Panel Install Trainer - submit a score to the API, then pull all results back.

.DESCRIPTION
    One self-contained script that does the full round-trip against the
    unauthenticated /api/scores endpoint:
       1) POST one (or more) scoring record(s)  -> "request scoring"
       2) GET all records back with summary stats -> "pull the results"
    Defaults to the live Azure Static Web App; override -ApiBase for local dev.

.PARAMETER ApiBase
    Base URL of the app. Defaults to the live Azure deployment.

.PARAMETER Difficulty
    basic | standard | advanced (sets the circuit count). Default standard.

.PARAMETER Score
    0-100 score to submit. Default 88. Scores < 80 are recorded as a fail.

.PARAMETER Count
    How many sample records to submit before pulling. Default 1.

.PARAMETER CsvPath
    Optional. Also export the pulled results to this CSV file.

.EXAMPLE
    .\score-and-pull.ps1
    # submits one standard-difficulty score of 88, then lists everything

.EXAMPLE
    .\score-and-pull.ps1 -Score 94 -Difficulty advanced

.EXAMPLE
    .\score-and-pull.ps1 -Count 5 -CsvPath .\scores.csv

.EXAMPLE
    .\score-and-pull.ps1 -ApiBase http://localhost:8781   # local dev-server
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net",
    [ValidateSet("basic", "standard", "advanced")] [string]$Difficulty = "standard",
    [ValidateRange(0, 100)] [int]$Score = 88,
    [int]$Count = 1,
    [string]$CsvPath
)

$ErrorActionPreference = "Stop"
$apiUrl = "$($ApiBase.TrimEnd('/'))/api/scores"
$circuitsByDiff = @{ basic = 5; standard = 7; advanced = 9 }

# ---------------------------------------------------------------------------
# 1) REQUEST SCORING  -  POST one or more records
# ---------------------------------------------------------------------------
Write-Host "Submitting $Count scoring record(s) to $apiUrl" -ForegroundColor Cyan
for ($i = 1; $i -le $Count; $i++) {

    # For a single record use the given score; for many, vary it to look realistic
    $thisScore = if ($Count -gt 1) { Get-Random -Minimum 55 -Maximum 101 } else { $Score }
    $isPass    = $thisScore -ge 80

    $record = [ordered]@{
        difficulty  = $Difficulty
        circuits    = $circuitsByDiff[$Difficulty]
        score       = $thisScore
        pass        = $isPass
        faults      = if ($isPass) { Get-Random -Minimum 0 -Maximum 2 } else { Get-Random -Minimum 2 -Maximum 6 }
        critical    = if ($isPass) { 0 } else { Get-Random -Minimum 1 -Maximum 4 }
        durationSec = Get-Random -Minimum 20 -Maximum 120
    }

    $saved = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
                               -Body ($record | ConvertTo-Json) -TimeoutSec 15
    Write-Host ("  + {0} difficulty, {1}% ({2}) [id {3}]" -f `
        $saved.difficulty, $saved.score, $(if ($saved.pass) { "PASS" } else { "FAIL" }), $saved.id) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 2) PULL RESULTS  -  GET all records back
# ---------------------------------------------------------------------------
Write-Host "`nPulling all records from $apiUrl" -ForegroundColor Cyan
$data = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15
# Flatten: Windows PowerShell 5.1 wraps a single-element JSON array oddly,
# so normalize to a flat object array before Select/Measure-Object.
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
