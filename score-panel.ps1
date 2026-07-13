# =============================================================================
#  Panel Install Trainer - self-contained scoring script
#  Paste this whole script into your engine. No parameters, no console
#  commands, no external files or network calls required.
#
#  It produces two results:
#     $Pass    = [bool]     TRUE = PASS, FALSE = FAIL
#     $Details = [string[]] detailed scoring findings
#  and outputs them as one object: @{ Pass = <bool>; Details = <string[]> }
#
#  Edit the "PANEL UNDER TEST" section to the circuits (work order) and the
#  installed breakers/wires you want scored.
# =============================================================================

# ---- Reference data (NEC 2023, conservative) --------------------------------
$WIRE_AMPACITY  = @{ 14 = 15; 12 = 20; 10 = 30; 8 = 40; 6 = 55 }        # T310.16 60C Cu
$SMALL_COND_CAP = @{ 14 = 15; 12 = 20; 10 = 30; 8 = $null; 6 = $null }  # 240.4(D)
$AMP_OPTIONS    = @(15, 20, 30, 40, 50)
$TYPE_LABELS    = @{ standard = "Standard"; gfci = "GFCI"; afci = "AFCI"; dual = "Dual GFCI/AFCI" }
$PROT_LABELS    = @{ standard = "Standard"; gfci = "GFCI"; afci = "AFCI"; dual = "AFCI+GFCI (dual-function)" }
$PASS_THRESHOLD = 80

# ---- Helpers ----------------------------------------------------------------
function MinStdAmp([double]$a) { foreach ($x in $AMP_OPTIONS) { if ($x -ge $a) { return $x } }; return $null }
function NeedPolesOf($c) { if ($c.v -eq 240) { 2 } else { 1 } }
function ReqBreakerLabel($c) { if ($c.hvac) { "<= $($c.mocp)A (nameplate MOCP)" } else { "$($c.amps)A" } }

function ProtSatisfied($type, $protection) {
    ($protection -eq "gfci" -and ($type -eq "gfci" -or $type -eq "dual")) -or
    ($protection -eq "afci" -and ($type -eq "afci" -or $type -eq "dual")) -or
    ($protection -eq "dual" -and $type -eq "dual") -or
    ($protection -eq "standard" -and $type -eq "standard")
}

function WireOf($u) {
    $keys = @($u.terminals.Keys)
    $vals = @()
    foreach ($k in $keys) { $v = $u.terminals[$k]; if ($null -ne $v) { $vals += [int]$v } }
    if ($vals.Count -eq 0) { return @{ status = "none"; total = $keys.Count } }
    if ($vals.Count -lt $keys.Count) { return @{ status = "partial"; filled = $vals.Count; total = $keys.Count } }
    $uniq = @($vals | Select-Object -Unique)
    if ($uniq.Count -gt 1) { return @{ status = "mixed"; gauges = $uniq } }
    return @{ status = "ok"; gauge = $uniq[0] }
}

function MatchScore($u, $c) {
    $s = 0.0
    if ($u.poles -eq (NeedPolesOf $c)) { $s += 4 }
    if ($c.hvac) {
        if ($u.amps -ge (MinStdAmp $c.mca) -and $u.amps -le $c.mocp) { if ($u.amps -eq $c.mocp) { $s += 2 } else { $s += 1.5 } }
    } elseif ($u.amps -eq $c.amps) { $s += 2 }
    if (ProtSatisfied $u.type $c.protection) { $s += 1 }
    $w = WireOf $u
    if ($w.status -eq "ok" -and $w.gauge -eq $c.wire) { $s += 1 }
    return $s
}

function SpecificityOf($c) {
    $v = 0
    if ($c.v -eq 240) { $v += 2 }
    if ($c.protection -eq "dual") { $v += 2 } elseif ($c.protection -ne "standard") { $v += 1 }
    if ($c.hvac) { $v += 1 }
    return $v
}

# =========================== PANEL UNDER TEST ================================
# 1) Required circuits (the work order / answer key).
$Circuits = @(
    @{ uid = "k1"; name = "Kitchen small-appliance #1"; v = 120; amps = 20; wire = 12; protection = "dual";  hvac = $false }
    @{ uid = "r1"; name = "Electric range";             v = 240; amps = 40; wire = 8;  protection = "gfci";  hvac = $false }
    # HVAC example (breaker sized to nameplate, not 240.4(D)):
    # @{ uid = "h1"; name = "A/C condenser"; v = 240; wire = 10; protection = "gfci"; hvac = $true; mca = 24.5; mocp = 40 }
)

# 2) Installed breakers + landed conductors (what was built).
$Units = @(
    @{ id = 1; slot = 1; poles = 1; amps = 20; type = "dual"; terminals = @{ A = 12 } }
    @{ id = 2; slot = 3; poles = 2; amps = 40; type = "gfci"; terminals = @{ A = 8; B = 8 } }
)
# ============================================================================

# ---- Attribute installed units to required circuits (most specific first) ---
$order    = $Circuits | Sort-Object -Property @{ Expression = { SpecificityOf $_ } } -Descending
$consumed = @{}
$map      = @{}
foreach ($c in $order) {
    $best = -1; $bestScore = 0.0
    for ($i = 0; $i -lt $Units.Count; $i++) {
        if ($consumed.ContainsKey($i)) { continue }
        $s = MatchScore $Units[$i] $c
        if ($s -ge 2 -and $s -gt $bestScore) { $bestScore = $s; $best = $i }
    }
    if ($best -ge 0) { $map[$c.uid] = $Units[$best]; $consumed[$best] = $true }
}
$extras = @()
for ($i = 0; $i -lt $Units.Count; $i++) { if (-not $consumed.ContainsKey($i)) { $extras += $Units[$i] } }

# ---- Score each required circuit --------------------------------------------
$detail  = @()
$earned  = 0.0; $max = 0; $faults = 0; $critical = 0

foreach ($c in $Circuits) {
    $issues = @()
    $max += 3
    $u = $map[$c.uid]

    if ($null -eq $u) {
        $issues += @{ level = "fail"; text = "No matching breaker installed for this circuit (need $(ReqBreakerLabel $c), $(NeedPolesOf $c)-pole, $($PROT_LABELS[$c.protection]))." }
        $faults++; $critical++
        $detail += @{ name = $c.name; issues = $issues }
        continue
    }

    $amps = $u.amps; $type = $u.type; $poles = $u.poles
    $needPoles = NeedPolesOf $c

    # 1) Breaker: poles + sizing
    $pBreaker = 0.0
    if ($poles -ne $needPoles) {
        $faults++; $critical++
        if ($needPoles -eq 2) { $issues += @{ level = "fail"; text = "240V load requires a 2-pole breaker - a 1-pole cannot supply 240V." } }
        else { $issues += @{ level = "fail"; text = "120V load should use a 1-pole breaker, not 2-pole." } }
    } elseif ($c.hvac) {
        $floor = MinStdAmp $c.mca
        if ($amps -gt $c.mocp) { $faults++; $critical++; $issues += @{ level = "fail"; text = "Breaker ${amps}A exceeds nameplate Max OCPD ($($c.mocp)A) - NEC 440.4(B)." } }
        elseif ($amps -lt $floor) { $faults++; $issues += @{ level = "warn"; text = "Breaker ${amps}A is below the circuit MCA ($($c.mca)A) - undersized." } }
        else { $pBreaker = 1 }
    } elseif ($amps -eq $c.amps) { $pBreaker = 1 }
    else {
        $faults++
        if ($amps -gt $c.amps) { $critical++; $issues += @{ level = "fail"; text = "Breaker oversized: ${amps}A on a $($c.amps)A circuit - overcurrent/fire risk (240.4(D))." } }
        else { $issues += @{ level = "warn"; text = "Breaker undersized: ${amps}A where $($c.amps)A is required - nuisance tripping." } }
    }

    # 2) Conductor (per-terminal wiring)
    $pWire = 0.0
    $w = WireOf $u
    if ($w.status -eq "none") { $faults++; $critical++; $issues += @{ level = "fail"; text = "No conductor landed on the breaker terminal(s)." } }
    elseif ($w.status -eq "partial") { $faults++; $critical++; $issues += @{ level = "fail"; text = "Only $($w.filled) of $($w.total) pole terminals wired - both legs of a 2-pole breaker must be landed." } }
    elseif ($w.status -eq "mixed") { $faults++; $critical++; $g = (($w.gauges | ForEach-Object { "$_ AWG" }) -join " & "); $issues += @{ level = "fail"; text = "Different gauge conductors on the poles ($g) - both legs must match." } }
    else {
        $wire = $w.gauge
        $ampacity = $WIRE_AMPACITY[$wire]; if ($null -eq $ampacity) { $ampacity = 0 }
        if ($c.hvac) { $floor = $c.mca; $cap = $null } else { $floor = $amps; $cap = $SMALL_COND_CAP[$wire] }
        if ($ampacity -lt $floor) {
            $faults++; $critical++
            if ($c.hvac) { $forWhat = "MCA $($c.mca)A" } else { $forWhat = "${amps}A breaker" }
            $issues += @{ level = "fail"; text = "Wire ${wire} AWG (${ampacity}A) undersized for $forWhat - FIRE HAZARD." }
        } elseif ((-not $c.hvac) -and ($null -ne $cap) -and ($amps -gt $cap)) {
            $faults++; $critical++; $issues += @{ level = "fail"; text = "${wire} AWG limited to ${cap}A by NEC 240.4(D); ${amps}A breaker violates the small-conductor rule." }
        } elseif ($wire -ne $c.wire) {
            $pWire = 0.5; $faults++; $issues += @{ level = "warn"; text = "Wire ${wire} AWG is adequate but spec calls for $($c.wire) AWG for this load." }
        } else { $pWire = 1 }
    }

    # 3) Protection
    $pProt = 0.0
    if (ProtSatisfied $type $c.protection) { $pProt = 1 }
    elseif ($c.protection -eq "dual") { $faults++; $critical++; $issues += @{ level = "fail"; text = "Requires dual-function (AFCI+GFCI); $($TYPE_LABELS[$type]) provides only part - 210.8 & 210.12(B)." } }
    elseif ($c.protection -eq "standard") { $pProt = 0.5; $faults++; $issues += @{ level = "warn"; text = "$($TYPE_LABELS[$type]) breaker where a standard breaker is sufficient." } }
    else { $faults++; $critical++; if ($c.protection -eq "gfci") { $need = "GFCI" } else { $need = "AFCI" }; $issues += @{ level = "fail"; text = "Missing $need protection required here - code violation / shock or arc-fault risk." } }

    $earned += $pBreaker + $pWire + $pProt
    if ($issues.Count -eq 0) { $issues += @{ level = "ok"; text = "Installed to spec (slot $($u.slot))." } }
    $detail += @{ name = $c.name; issues = $issues }
}

# Extra breakers not in the work order
foreach ($u in $extras) {
    $faults++
    $detail += @{ name = "Extra breaker (slot $($u.slot))"; issues = @(@{ level = "warn"; text = "$($u.amps)A $($u.poles)-pole $($TYPE_LABELS[$u.type]) breaker not part of the work order." }) }
}

# ---- Final result -----------------------------------------------------------
if ($max -gt 0) { $score = [int][math]::Round((($earned / $max) * 100), 0, [System.MidpointRounding]::AwayFromZero) } else { $score = 0 }

# $Pass    : [bool]     TRUE = PASS, FALSE = FAIL
# $Details : [string[]] detailed scoring findings
$Pass = ($score -ge $PASS_THRESHOLD) -and ($critical -eq 0)

$Details = @()
$Details += ("SCORE {0}% - {1} ({2} fault(s), {3} critical)" -f $score, $(if ($Pass) { "PASS" } else { "FAIL" }), $faults, $critical)
foreach ($d in $detail) {
    foreach ($iss in $d.issues) {
        $Details += ("[{0}] {1}: {2}" -f $iss.level.ToUpper(), $d.name, $iss.text)
    }
}
$Details = [string[]]$Details

# Output both results (change to `$Pass` alone if your engine wants a bare bool).
[PSCustomObject]@{ Pass = [bool]$Pass; Details = [string[]]$Details }
