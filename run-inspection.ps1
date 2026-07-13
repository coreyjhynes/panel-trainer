<#
    Panel Install Trainer - grade the live panel against a scenario.

    Asks the running app to score its current panel against a specific scenario
    (the panel lives in the app; the app/API do the scoring). No panel and no
    scoring logic live here.

    Returns one object:
        Pass    = [bool]     TRUE = PASS, FALSE = FAIL
        Details = [string[]] detailed scoring findings
#>

$ApiBase    = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net"   # the running app
$ScenarioId = "REPLACE-WITH-SCENARIO-ID"                                # the scenario to grade against
$SessionId  = "default"                                                 # the lab session (Skillable's ?session=<id>)

# ---- Ask the app to inspect its live panel against the scenario -------------
$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod -Uri "$($ApiBase.TrimEnd('/'))/api/inspect" -Method Post `
                            -ContentType "application/json" `
                            -Body (@{ scenarioId = $ScenarioId; sessionId = $SessionId } | ConvertTo-Json) -TimeoutSec 15

# ---- Shape the result -------------------------------------------------------
$Pass = [bool]$result.pass

$Details = @()
$Details += ("SCENARIO {0} - SCORE {1}% - {2} ({3} fault(s), {4} critical)" -f `
    $result.scenarioId, $result.score, $(if ($Pass) { "PASS" } else { "FAIL" }), $result.faults, $result.critical)
foreach ($circuit in $result.details) {
    foreach ($issue in $circuit.issues) {
        $Details += ("[{0}] {1}: {2}" -f $issue.level.ToUpper(), $circuit.name, $issue.text)
    }
}
$Details = [string[]]$Details

# Output both results (change to `$Pass` alone if your engine wants a bare bool).
[PSCustomObject]@{ Pass = $Pass; Details = $Details }
