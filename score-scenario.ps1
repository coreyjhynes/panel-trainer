<#
    SCORE A SCENARIO
    Ask the running app to grade its live panel (for a given lab session) against
    a scenario. The application does the scoring; this script only calls the API.

    Edit the three values below (no command-line arguments needed).

    Returns one object:
        Pass    = [bool]     TRUE = PASS, FALSE = FAIL
        Details = [string[]] detailed scoring findings
#>

$ApiBase    = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net"  # the running app
$ScenarioId = "residential-standard"                                   # scenario to grade against
$SessionId  = "default"                                                # lab session (Skillable's ?session=<id>)

$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod -Uri "$($ApiBase.TrimEnd('/'))/api/inspect" -Method Post `
    -ContentType "application/json" `
    -Body (@{ scenarioId = $ScenarioId; sessionId = $SessionId } | ConvertTo-Json) -TimeoutSec 15

$Pass = [bool]$result.pass

$Details = @()
$Details += ("SCENARIO {0} - {1} {2}% ({3} fault(s), {4} critical)" -f `
    $result.scenarioId, $(if ($Pass) { "PASS" } else { "FAIL" }), $result.score, $result.faults, $result.critical)
foreach ($circuit in $result.details) {
    foreach ($issue in $circuit.issues) {
        $Details += ("[{0}] {1}: {2}" -f $issue.level.ToUpper(), $circuit.name, $issue.text)
    }
}
$Details = [string[]]$Details

# Output both results (change to `$Pass` alone if your engine wants a bare bool).
[PSCustomObject]@{ Pass = $Pass; Details = $Details }
