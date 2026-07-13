# Service Panel Install Trainer — POC

A static, client-side training simulator for installing a US residential electrical
service panel (load center). Trainees are given a randomized work order, then assign
each required circuit to a panel slot and configure the breaker size, breaker type,
and wire gauge to meet code. An **inspection** scores the work and saves a record.

No build step, no backend. Just static files (`index.html`, `styles.css`, `app.js`) —
drop it on GitHub Pages or open it via any static server.

## Run locally
```
python -m http.server 8770 --directory panel-trainer
# open http://localhost:8770
```

## How it works
1. Enter a trainee name, pick difficulty (5 / 7 / 9 circuits), **Start job**.
2. A work order is generated, guaranteed to include 240V loads plus GFCI- and
   AFCI-required circuits.
3. For each circuit choose: **Slot**, **Breaker A**, **Type**, **Wire**.
   240V loads consume two same-column spaces (a 2-pole breaker).
4. **Run inspection** → score + itemized findings, saved to the Records tab.

## Scoring rules (POC — simplified NEC)
Each circuit is graded on three checks (breaker sizing, wire, protection):

| Check | Pass condition | Failure |
|-------|----------------|---------|
| Breaker size | breaker amps == circuit rating | oversized = overcurrent hazard (critical); undersized = nuisance trip (warn) |
| Wire gauge | wire ampacity ≥ breaker amps **and** matches spec | ampacity < breaker = **fire hazard** (critical); adequate-but-off-spec = warn (half credit) |
| Protection | GFCI where required (kitchen/bath/laundry/garage/outdoor), AFCI in living areas, standard on 240V appliances (Dual counts for GFCI or AFCI) | missing GFCI/AFCI = code violation (critical); extra protection on appliance = warn |

Wire ampacity used: 14 AWG→15A, 12→20A, 10→30A, 8→40A, 6→55A.

**Pass** = score ≥ 80% **and** zero critical hazards. An untouched panel scores ~5%.

## Records / querying
Records persist in the browser (`localStorage`, key `panelTrainer.records.v1`).
The Records tab supports filtering (name, pass/fail, min score), live stats
(attempts, pass rate, average), delete, and **CSV / JSON export**.

Exported record fields:
`id, ts (ISO), trainee, difficulty, circuits, score, pass, faults, critical, durationSec`

Load the CSV into Excel, a database, or a notebook to query trainee performance.

## POC limitations / next steps
- Slot adjacency for 2-pole breakers is simplified (n & n+2, same column).
- Rules are a teaching subset of the NEC, not a code-compliance authority.
- Scoring is per-browser; a shared backend would be needed for multi-station reporting.
- Could add: neutral/ground bar wiring, panel amperage load calc, tandem breakers,
  timed exams, and instructor-defined work orders.
