<#
.SYNOPSIS
    Pull Panel Install Trainer scoring data from the unauthenticated /api/scores endpoint.

.DESCRIPTION
    Works against the Azure Static Web Apps deployment or the local dev server.
    Prints a summary table + stats, and optionally exports to CSV.

.PARAMETER ApiBase
    Base URL of the app, e.g. https://your-app.azurestaticapps.net  or  http://localhost:8781

.PARAMETER Trainee
    Optional. Filter to trainees whose name contains this text.

.PARAMETER MinScore
    Optional. Only records with score >= this value.

.PARAMETER Result
    Optional. 'pass' or 'fail'.

.PARAMETER CsvPath
    Optional. Also export the results to this CSV file.

.EXAMPLE
    .\pull-scores.ps1 -ApiBase https://panel-trainer.azurestaticapps.net

.EXAMPLE
    .\pull-scores.ps1 -ApiBase http://localhost:8781 -Trainee Jordan -MinScore 80 -CsvPath .\scores.csv
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ApiBase,
    [string]$Trainee,
    [int]$MinScore = -1,
    [ValidateSet("pass", "fail")] [string]$Result,
    [string]$CsvPath
)

# --- Build the query string -------------------------------------------------
$parts = New-Object System.Collections.Generic.List[string]
if ($Trainee)        { $parts.Add("trainee=$([uri]::EscapeDataString($Trainee))") }
if ($MinScore -ge 0) { $parts.Add("min_score=$MinScore") }
if ($Result)         { $parts.Add("pass=" + (($Result -eq 'pass').ToString().ToLower())) }
$query = if ($parts.Count -gt 0) { "?" + ($parts -join "&") } else { "" }
$url = "$($ApiBase.TrimEnd('/'))/api/scores$query"

Write-Host "GET $url" -ForegroundColor Cyan

# --- Call the API -----------------------------------------------------------
try {
    $data = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15
}
catch {
    Write-Error "Request failed: $($_.Exception.Message)"
    exit 1
}

$records = @($data)
if ($records.Count -eq 0) {
    Write-Host "No scoring records returned."
    return
}

# --- Display ----------------------------------------------------------------
$records |
    Select-Object ts, trainee, difficulty, score, pass, faults, critical, durationSec |
    Format-Table -AutoSize

$passCount = @($records | Where-Object { $_.pass }).Count
$avg  = [math]::Round((($records | Measure-Object -Property score -Average).Average), 1)
$rate = [math]::Round((100.0 * $passCount / $records.Count), 1)

Write-Host ""
Write-Host ("Total {0} | Passed {1} | Pass rate {2}% | Avg score {3}%" -f `
    $records.Count, $passCount, $rate, $avg) -ForegroundColor Green

# --- Optional CSV export ----------------------------------------------------
if ($CsvPath) {
    $records | Export-Csv -Path $CsvPath -NoTypeInformation -Encoding UTF8
    Write-Host "Exported $($records.Count) records to $CsvPath" -ForegroundColor Green
}
