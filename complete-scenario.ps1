<#
    COMPLETE A SCENARIO
    Build the scenario's 100%-correct panel into the live panel for a given lab
    session. A panel page opened for that session (…/?session=<id>) refreshes to
    show the completed build, and a subsequent score returns 100%. The
    application computes the solution; this script only calls the API.

    Edit the three values below (no command-line arguments needed).

    Returns one object:
        Ok         = [bool]   the completion succeeded
        ScenarioId / SessionId
        Units      = [int]    breakers placed
#>

$ApiBase    = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net"  # the running app
$ScenarioId = "residential-standard"                                   # scenario to build
$SessionId  = "default"                                                # lab session (Skillable's ?session=<id>)

$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod -Uri "$($ApiBase.TrimEnd('/'))/api/complete" -Method Post `
    -ContentType "application/json" `
    -Body (@{ scenarioId = $ScenarioId; sessionId = $SessionId } | ConvertTo-Json) -TimeoutSec 15

[PSCustomObject]@{
    Ok         = [bool]$result.ok
    ScenarioId = $result.scenarioId
    SessionId  = $result.sessionId
    Units      = @($result.units).Count
}
