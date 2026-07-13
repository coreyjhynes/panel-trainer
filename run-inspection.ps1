<#
    Panel Install Trainer - remote "Run inspection".

    This script is the equivalent of clicking the app's "Run inspection" button:
    it sends a panel (breakers + wires) to the running application's API, the
    APPLICATION scores it (all scoring logic lives in api/lib/scoring.js), and
    the script hands back the result.

    NO scoring logic lives here - only the panel to inspect and the API call.

    Returns one object:
        Pass    = [bool]     TRUE = PASS, FALSE = FAIL
        Details = [string[]] detailed scoring findings

    Paste-and-run: it needs no command-line arguments (edit the values below).
#>

# ---- Configuration ----------------------------------------------------------
$ApiBase    = "https://wonderful-sea-0d849fb0f.7.azurestaticapps.net"  # the running app
$InstanceId = "ps-run"     # stable id -> re-running replaces the same result

# ---- PANEL TO INSPECT (what was built) --------------------------------------
# The required circuits (work order) and the installed breakers/wires. This is
# the same payload the "Run inspection" button sends from the app.
$Payload = @{
    instanceId  = $InstanceId
    difficulty  = "standard"
    durationSec = 0
    circuits    = @(
        @{ uid = "k1"; name = "Kitchen small-appliance #1"; v = 120; amps = 20; wire = 12; protection = "dual"; hvac = $false }
        @{ uid = "r1"; name = "Electric range";             v = 240; amps = 40; wire = 8;  protection = "gfci"; hvac = $false }
    )
    units       = @(
        @{ id = 1; slot = 1; poles = 1; amps = 20; type = "dual"; terminals = @{ A = 12 } }
        @{ id = 2; slot = 3; poles = 2; amps = 40; type = "gfci"; terminals = @{ A = 8; B = 8 } }
    )
}

# ---- Run inspection (the APPLICATION scores it) -----------------------------
$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod -Uri "$($ApiBase.TrimEnd('/'))/api/scores" -Method Post `
                            -ContentType "application/json" `
                            -Body ($Payload | ConvertTo-Json -Depth 6) -TimeoutSec 15

# ---- Shape the result -------------------------------------------------------
$Pass = [bool]$result.pass

$Details = @()
$Details += ("SCORE {0}% - {1} ({2} fault(s), {3} critical)" -f `
    $result.score, $(if ($Pass) { "PASS" } else { "FAIL" }), $result.faults, $result.critical)
foreach ($circuit in $result.details) {
    foreach ($issue in $circuit.issues) {
        $Details += ("[{0}] {1}: {2}" -f $issue.level.ToUpper(), $circuit.name, $issue.text)
    }
}
$Details = [string[]]$Details

# Output both results (change to `$Pass` alone if your engine wants a bare bool).
[PSCustomObject]@{ Pass = $Pass; Details = $Details }
