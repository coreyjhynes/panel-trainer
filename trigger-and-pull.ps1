<#
.SYNOPSIS
    Sample script that TRIGGERS scoring (POSTs a result) and then PULLS the data
    back from the Panel Trainer /api/scores endpoint. Demonstrates the full
    round-trip from PowerShell.

.PARAMETER ApiBase
    Base URL. Local dev:  http://localhost:8781
    Azure (once deployed): https://<your-app>.azurestaticapps.net

.PARAMETER Trainee
    Name to record. Default "Sample Trainee".

.PARAMETER Difficulty
    basic | standard | advanced. Default standard.

.PARAMETER Score
    0-100 score to submit. Default 88 (pass). Values < 80 record as a fail.

.PARAMETER Count
    How many sample records to submit before pulling. Default 1.

.EXAMPLE
    .\trigger-and-pull.ps1 -ApiBase http://localhost:8781

.EXAMPLE
    .\trigger-and-pull.ps1 -ApiBase https://panel-trainer-app.azurestaticapps.net -Trainee "Jordan Rivera" -Score 92

.EXAMPLE
    .\trigger-and-pull.ps1 -ApiBase http://localhost:8781 -Count 5   # seed 5 varied records
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ApiBase,
    [string]$Trainee = "Sample Trainee",
    [ValidateSet("basic", "standard", "advanced")] [string]$Difficulty = "standard",
    [int]$Score = 88,
    [int]$Count = 1
)

$base   = $ApiBase.TrimEnd('/')
$apiUrl = "$base/api/scores"
$circuitsByDiff = @{ basic = 5; standard = 7; advanced = 9 }

# ---- 1) TRIGGER: POST one or more scoring records --------------------------
Write-Host "Submitting $Count scoring record(s) to $apiUrl ..." -ForegroundColor Cyan
for ($i = 1; $i -le $Count; $i++) {

    # For Count>1, vary the data a little so the pull looks realistic
    $thisScore   = if ($Count -gt 1) { Get-Random -Minimum 55 -Maximum 101 } else { $Score }
    $thisTrainee = if ($Count -gt 1) { "$Trainee $i" } else { $Trainee }
    $isPass      = $thisScore -ge 80

    $record = [ordered]@{
        trainee     = $thisTrainee
        difficulty  = $Difficulty
        circuits    = $circuitsByDiff[$Difficulty]
        score       = $thisScore
        pass        = $isPass
        faults      = if ($isPass) { Get-Random -Minimum 0 -Maximum 2 } else { Get-Random -Minimum 2 -Maximum 6 }
        critical    = if ($isPass) { 0 } else { Get-Random -Minimum 1 -Maximum 4 }
        durationSec = Get-Random -Minimum 20 -Maximum 120
    }

    try {
        $saved = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
                                   -Body ($record | ConvertTo-Json) -TimeoutSec 15
        Write-Host ("  + {0} - {1}% ({2}) [id {3}]" -f `
            $saved.trainee, $saved.score, $(if ($saved.pass) { "PASS" } else { "FAIL" }), $saved.id) -ForegroundColor DarkGray
    }
    catch {
        Write-Error "POST failed: $($_.Exception.Message)"
        exit 1
    }
}

# ---- 2) PULL: GET all records back -----------------------------------------
Write-Host "`nPulling all records from $apiUrl ..." -ForegroundColor Cyan
try {
    $data = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15
}
catch {
    Write-Error "GET failed: $($_.Exception.Message)"
    exit 1
}

$records = @($data)
if ($records.Count -eq 0) { Write-Host "No records returned."; return }

$records |
    Select-Object ts, trainee, difficulty, score, pass, faults, critical, durationSec |
    Format-Table -AutoSize

$passCount = @($records | Where-Object { $_.pass }).Count
$avg  = [math]::Round((($records | Measure-Object -Property score -Average).Average), 1)
$rate = [math]::Round((100.0 * $passCount / $records.Count), 1)
Write-Host ("Total {0} | Passed {1} | Pass rate {2}% | Avg score {3}%" -f `
    $records.Count, $passCount, $rate, $avg) -ForegroundColor Green
