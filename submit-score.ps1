<#
.SYNOPSIS
    Submit one scoring request to the running Panel Trainer instance and return
    the PASS/FAIL result plus the detailed findings.

.DESCRIPTION
    Does exactly three things:
      1. Submits ONE scoring request (a panel state) to the running instance.
      2. Returns a boolean (Pass) - $true for PASS, $false for FAIL.
      3. Returns a string array (Details) of the detailed scoring results.

    The only output is one object: [PSCustomObject]@{ Pass = <bool>; Details = <string[]> }

    A stable InstanceId is used, so re-running replaces the same result on the
    running instance instead of creating another record.

.PARAMETER ApiBase
    Base URL of the running instance. Defaults to the live Azure app.

.PARAMETER InstanceId
    Identifies this run. Stable by default so repeated runs do not accumulate.

.PARAMETER Miswire
    Submit an intentionally incorrect panel (undersized range conductor) so the
    result is FALSE - proves the boolean reflects actual correctness.

.EXAMPLE
    $r = .\submit-score.ps1
    $r.Pass         # True or False
    $r.Details      # string[] of findings

.EXAMPLE
    (.\submit-score.ps1 -Miswire).Pass      # False
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net",
    [string]$InstanceId = "ps-sample",
    [switch]$Miswire
)

$ErrorActionPreference = "Stop"
$apiUrl = "$($ApiBase.TrimEnd('/'))/api/scores"

# The panel state to score (correct by default; -Miswire makes the range fail).
$rangeWire = if ($Miswire) { 12 } else { 8 }
$state = @{
    instanceId  = $InstanceId
    difficulty  = "standard"
    durationSec = 0
    circuits    = @(
        @{ uid = "k1"; name = "Kitchen small-appliance #1"; v = 120; amps = 20; wire = 12; protection = "dual"; hvac = $false },
        @{ uid = "r1"; name = "Electric range";             v = 240; amps = 40; wire = 8;  protection = "gfci"; hvac = $false }
    )
    units       = @(
        @{ id = 1; slot = 1; poles = 1; amps = 20; type = "dual"; terminals = @{ A = 12 } },
        @{ id = 2; slot = 3; poles = 2; amps = 40; type = "gfci"; terminals = @{ A = $rangeWire; B = $rangeWire } }
    )
}

# 1) Submit the scoring request; the running instance scores it server-side.
$result = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
                            -Body ($state | ConvertTo-Json -Depth 6) -TimeoutSec 15

# 3) Flatten the findings into a string array.
$details = foreach ($circuit in $result.details) {
    foreach ($issue in $circuit.issues) {
        "[{0}] {1}: {2}" -f $issue.level.ToUpper(), $circuit.name, $issue.text
    }
}

# 2 + 3) Return the boolean pass flag and the detail strings.
[PSCustomObject]@{
    Pass    = [bool]$result.pass
    Details = [string[]]$details
}
