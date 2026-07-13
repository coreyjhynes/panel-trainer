# Panel Trainer — Precision Validation (NEC 2023 + Square D Homeline 200A)

Research-and-validate pass for making the simulator code-accurate. Target hardware:
**Square D Homeline 200A main-breaker load center** (HOM4080M200PC / HOM3060M200PC family).
Target code: **NEC 2023 (NFPA 70)**, as adopted by the Florida Building Code, 8th Edition
(statewide effective Dec 31, 2023).

> Sourcing note: NEC text is copyrighted; findings below come from code-education/AHJ
> sources (Mike Holt, UpCodes, electricallicenserenewal.com, JADE Learning, NYEIA) that
> reproduce NFPA 70-2023, plus one primary Schneider datasheet (SCHNDRE06571_30) and OEM
> se.com for hardware. For an authoritative training product, verify exact article wording
> against a purchased copy of NFPA 70 (2023). Each row cites its source.

---

## 1. Hardware — Square D Homeline 200A load center

| Spec | Value | Note for sim |
|------|-------|--------------|
| Models | **HOM4080M200PC** = 40 spaces / 80 circuits · **HOM3060M200PC** = 30 spaces / 60 circuits | Don't hardcode one number; "circuits" > "spaces" because of tandems |
| Main breaker | **200 A convertible**, 120/240 V AC, 1-phase | — |
| Bus | Plated aluminum, **listed for Homeline breakers only** | Reject non-Homeline breakers |
| Neutral | **Fully distributed plug-on neutral (PoN)** | Plug-on-neutral CAFCI/DF breakers work in **any** space |
| Space types | Each pole space accepts **full-size, tandem, or quad** | Tandems put 2 circuits in 1 space (this is why 40 spaces → 80 circuits) |
| Main lugs | **AWG 4 – 250 kcmil**, Cu or Al | ⚠️ 4 AWG is the lug's mechanical minimum, **NOT** a valid 200A conductor |
| Interrupt rating | 22 kA (panel) / 10 kA AIR (branch breakers) | — |
| Enclosure | NEMA 1 indoor, 14.25"W × 3.75"D × 39.37"H | — |

**Breaker catalog (Homeline):**
- Standard 1-pole: HOM115, HOM120 … · 2-pole: HOM220, HOM230, HOM240, HOM250 (240 V)
- Tandem (1 space = 2 circuits): **HOMT1515, HOMT1520, HOMT2020, HOMT3020**
- Combination AFCI (CAFCI): HOM115CAFIC/HOM120CAFIC (pigtail), **HOM115PCAFIC/HOM120PCAFIC** (plug-on), HOM215CAFIC/HOM220CAFIC (2-pole)
- Dual-function (AFCI+GFCI) plug-on variants exist and satisfy **both** 210.12 and 210.8 on one circuit

Sources: [Schneider datasheet SCHNDRE06571_30 (primary)](https://assets.gordonelectricsupply.com/datasheets/ts/SCHNDRE06571_30.pdf) · [Standard Electric (HOM4080)](https://www.standardelectricsupply.com/Square-D-HOM4080M200PC-Homeline-Main-Breaker-Loadcenter) · [Capital Electric (HOM3060)](https://www.capitalelectricsupply.com/product/detail/927137/square-d-schneider-hom3060m200pc)

---

## 2. Conductor sizing & overcurrent (NEC 2023)

**240.4(D) Small conductors** — caps the *maximum* breaker independent of ampacity table:

| Copper wire | Max OCPD (240.4(D)) | Table 310.16 ampacity (60/75/90 °C) |
|-------------|--------------------|--------------------------------------|
| 14 AWG | **15 A** | 15 / 20 / 25 |
| 12 AWG | **20 A** | 20 / 25 / 30 |
| 10 AWG | **30 A** | 30 / 35 / 40 |
| 8 AWG  | (240.4(D) n/a) | **40 / 50 / 55** |
| 6 AWG  | (240.4(D) n/a) | **55 / 65 / 75** |

**Correct residential pairings:** 15A/14AWG lighting · 20A/12AWG small-appliance ·
30A/10AWG dryer & electric water heater · 40A/8AWG or 50A/8AWG range (range uses 60°C
column at ≤ 40A, 75°C at 50A).

⚠️ **CRITICAL HVAC EXCEPTION** — For listed A/C & refrigeration equipment, **240.4(G) →
Article 440.4(B)** route the circuit to the equipment nameplate. The **Maximum Overcurrent
Protective Device (MOCP)** on the nameplate governs, and 240.4(D) does **not** apply.
Example: a **40 A breaker legally protecting 12 AWG** for a central AC — the breaker gives
only short-circuit/ground-fault protection; the unit's internal overload device handles
overload. A simulator must **not** flag a nameplate-sized HVAC breaker as a fire hazard.
(This exception does NOT extend to ordinary 12 AWG circuits, which stay at 20 A.)

Sources: [Mike Holt 240.4 (240.4(D), (G), 440.4(B))](https://www.mikeholt.com/instructor2/img/product/pdf/1678822939.pdf) · [Table 310.16](https://www.electricallicenserenewal.com/Electrical-Continuing-Education-Courses/NEC-Content.php?sectionID=1313) · [UpCodes 240.4(D)](https://up.codes/s/small-conductors)

---

## 3. GFCI — NEC 2023 §210.8(A) dwelling units

Expanded from 11 to **12 enumerated locations, 210.8(A)(1)–(12)**. Locations: bathrooms,
garages/accessory buildings, outdoors, crawl spaces, basements, **kitchens (all qualifying
receptacles)**, food/beverage-prep areas with a sink, laundry areas, within 6 ft of a sink,
boathouses, bathtubs/shower stalls, near pools/spas.

**2023 changes that break a pre-2023 sim:**
- **210.8(A)(6) Kitchens** — removed *"serving the countertop surfaces"*; now **all**
  qualifying kitchen receptacles need GFCI, not just countertop ones.
- **New 210.8(A)(7)** — any area with a sink + permanent food/beverage-prep or cooking
  provisions (butler's pantry, basement bar) needs GFCI; the old **6-ft-from-sink** rule
  moved to 210.8(A)(8).
- **Dishwasher** — GFCI required per **422.5**.

⚠️ **Open item (do not hardcode yet):** 2023 also extends GFCI toward some **240 V / 250 V
receptacles ≤ 50 A** (relevant to ranges/dryers) and **210.8(F)** covers outdoor hardwired
HVAC. The exact voltage-scope wording ("125 V through 250 V, 150 V-or-less to ground") was
**refuted** in verification (1 confirm / 2 refute) and must be confirmed against primary
NFPA 70 before the sim requires GFCI on a range/dryer.

Sources: [electricallicenserenewal 210.8(A)](https://www.electricallicenserenewal.com/Electrical-Continuing-Education-Courses/NEC-Content.php?sectionID=1424) · [JADE Learning 210.8(A)(7)](https://www.jadelearning.com/blog/2023-nec-section-210-8a7/) · [Mars Electric 210.8](https://marselectric.com/posts/2023-nec-update-210-8-a-gfci-for-personnel-dwelling-units)

---

## 4. AFCI — NEC 2023 §210.12(B) dwelling units

All **120 V single-phase 10-, 15-, and 20-A** branch circuits supplying outlets in:
**kitchens, family rooms, dining rooms, living rooms, parlors, libraries, dens, bedrooms,
sunrooms, recreation rooms, closets, hallways, laundry areas**, and similar rooms
(incl. finished basements).

- Numbering nuance: in **2023 the room list is under 210.12(B)** (and 10 A was added);
  in 2017/2020 it was 210.12(A). *(A claim citing 210.12(A) for 2023 was refuted.)*
- A **combination AFCI (CAFCI)** breaker satisfies AFCI; a **dual-function (AFCI+GFCI)**
  breaker satisfies both AFCI and GFCI on the same circuit.
- ⚠️ **Kitchens and laundry appear on BOTH the GFCI and AFCI lists** → those 120 V circuits
  need **dual-function** protection, not GFCI-only.

Sources: [NYEIA 2023 AFCI (verbatim 210.12(B))](https://www.nyeia.com/wp-content/uploads/2025/10/2023-NEC_AFCI-Requirements.pdf) · [UpCodes 210.12](https://up.codes/s/arc-fault-circuit-interrupter-protection)

---

## 5. Required branch circuits — NEC 2023 §210.11(C)

Minimum mandatory circuits (beyond general lighting):
1. **210.11(C)(1)** — **two or more** 20 A small-appliance circuits (kitchen/pantry/
   breakfast/dining, per 210.52(B)); no other outlets.
2. **210.11(C)(2)** — **one** 20 A laundry circuit (per 210.52(F)); no other outlets.
3. **210.11(C)(3)** — **one** 120 V 20 A bathroom circuit (per 210.52(D)); no other
   outlets (exception: a circuit for a single bathroom may serve other equipment in that
   same bathroom).

Sources: [UpCodes 210.11](https://up.codes/s/branch-circuits-required) · [electricallicenserenewal 210.11(C)(3)](https://www.electricallicenserenewal.com/Electrical-Continuing-Education-Courses/NEC-Content.php?sectionID=813.0) · [NYEIA residential-at-a-glance](https://www.nyeia.com/wp-content/uploads/2025/10/2023-NEC-Residential-Requirements-at-a-Glance.pdf)

---

## 6. VALIDATION TABLE — current POC rule → verdict → correct rule

| # | Current POC behavior | Verdict | Correct (NEC 2023 / Homeline) |
|---|----------------------|---------|-------------------------------|
| 1 | Panel = **20 fixed single slots** | ❌ Wrong | 40 spaces / 80 circuits (HOM4080) or 30/60 (HOM3060); support tandem & quad |
| 2 | Any breaker accepted | ⚠️ Loose | Homeline-only bus; enforce breaker family |
| 3 | 14→15, 12→20, 10→30 A wire caps | ✅ Correct | Matches 240.4(D) exactly |
| 4 | 8→40, 6→55 A ampacity | ✅ Correct | Matches Table 310.16 (60 °C column) |
| 5 | Oversized breaker on small wire = always a fault | ⚠️ Wrong for HVAC | A/C uses nameplate **MOCP** (240.4(G)/440.4(B)); 40A on 12AWG can be legal |
| 6 | HVAC modeled as fixed 30 A | ⚠️ Oversimplified | Size to nameplate MCA/MOCP, not a constant |
| 7 | Kitchen = GFCI only | ⚠️ Incomplete | 2023: kitchen 120V needs **dual-function (AFCI+GFCI)** |
| 8 | Laundry = GFCI only | ⚠️ Incomplete | On both lists → **dual-function** |
| 9 | Bath / garage / outdoor = GFCI | ✅ Correct | Matches 210.8(A) |
| 10 | Bedroom / living / lighting = AFCI | ✅ Correct | Matches 210.12(B) |
| 11 | Range / dryer / WH = standard (no GFCI) | ⚠️ Verify | 2023 may require GFCI on some 240V ≤50A — confirm vs NFPA 70 |
| 12 | No dishwasher GFCI rule | ❌ Missing | 422.5 requires GFCI |
| 13 | Work order is fully random | ⚠️ Incomplete | Enforce mandatory 210.11(C) set: 2× kitchen SA, 1 laundry, 1 bath |
| 14 | 240V breaker occupies slot n & n+2 | ✅ Reasonable | Real 2-pole spans two adjacent same-column positions; keep, label as handle-tied |
| 15 | No service/feeder conductor modeled | ❌ Missing | If added: reject 4 AWG for 200A; need ~2/0 Cu or 4/0 Al (310.12 dwelling 83% rule) |
| 16 | Undersized wire = fire hazard (critical) | ✅ Correct | Correct except where HVAC MOCP exception applies (see #5) |

Legend: ✅ keep · ⚠️ refine · ❌ fix/add

---

## 7. Priority fixes (if we proceed to implement)

**High (correctness / safety-teaching):**
- #5/#6 HVAC nameplate MOCP exception — the sim currently teaches a *wrong* rule.
- #7/#8 Dual-function required in kitchen & laundry under 2023.
- #1 Real 40/80 (or 30/60) space model with tandem support.

**Medium:**
- #13 Enforce mandatory 210.11(C) circuit set in the work order.
- #12 Dishwasher GFCI (422.5).
- #2 Homeline-only breaker enforcement.

**Lower / stretch:**
- #15 Model the service conductor + lug sizing lesson.
- #11 Range/dryer 240V GFCI — gated on confirming exact 2023 voltage scope.

---

## 8. Refuted claims (do NOT encode)
1. "2023 210.8(A) scope = 125–250 V receptacles, 150 V-or-less to ground" — failed verify
   (1-2). Use only the confirmed 11→12 location count + kitchen/food-prep changes.
2. "AFCI dwelling room list is under 210.12(A) in 2023" — refuted; correct subsection is
   **210.12(B)**.

## 9. Open questions to close before shipping as authoritative
- Exact 210.8(A) voltage-scope wording and whether 2023 GFCI applies to ranges/dryers/EVSE.
- Primary se.com mechanical spec for exact main-lug & neutral/ground-bar wire ranges.
- NEC 422.5 (2023) exact dishwasher-GFCI wording.
- Florida Building Code amendments / local AHJ deviations vs base NEC 2023.
