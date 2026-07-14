<#
    SCORE A SCENARIO
    Ask the running app to grade its live panel (for a given lab session) against
    a scenario. The application does the scoring; this script only calls the API.

    Edit the three values below (no command-line arguments needed).

    Returns one object:
        Pass    = [bool]   TRUE = PASS, FALSE = FAIL
        Details = [string] readable, multi-line scoring report (one finding per line)
#>

$ApiBase    = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net"  # the running app
$ScenarioId = "residential-standard"                                   # scenario to grade against
$SessionId  = "default"                                                # lab session (Skillable's ?session=<id>)

$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod -Uri "$($ApiBase.TrimEnd('/'))/api/inspect" -Method Post `
    -ContentType "application/json" `
    -Body (@{ scenarioId = $ScenarioId; sessionId = $SessionId } | ConvertTo-Json) -TimeoutSec 15

$Pass = [bool]$result.pass

# Build a readable, multi-line report (one line per finding).
$lines = @()
$lines += ("Scenario : {0}" -f $result.scenarioId)
$lines += ("Result   : {0}  ({1}%, {2} fault(s), {3} critical)" -f `
    $(if ($Pass) { "PASS" } else { "FAIL" }), $result.score, $result.faults, $result.critical)
$lines += "Findings :"
foreach ($circuit in $result.details) {
    foreach ($issue in $circuit.issues) {
        $lines += ("  [{0,-4}] {1}: {2}" -f $issue.level.ToUpper(), $circuit.name, $issue.text)
    }
}
$Details = $lines -join [Environment]::NewLine

# Return the boolean plus the multi-line detail report.
[PSCustomObject]@{ Pass = $Pass; Details = $Details }

