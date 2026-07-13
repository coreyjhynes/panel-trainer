# Deploy to Azure Static Web Apps

A static frontend (panel + scenario authoring) **plus** an unauthenticated API
(Azure Functions) backed by **Azure Table Storage**. One origin, free SWA tier.

```
panel-trainer/
├── index.html / app.js          # the panel workbench (only the panel + hardware)
├── scenarios.html / scenarios.js # scenario library + authoring (dedicated URL)
├── styles.css
├── staticwebapp.config.json     # routing (anonymous /api/*)
├── api/                         # managed Azure Functions
│   ├── host.json  package.json
│   ├── lib/scoring.js           # NEC 2023 scoring
│   ├── lib/scenarios.js         # catalog, 100% solution, requirements Markdown
│   ├── lib/handler.js  lib/store.js   # router + Table Storage (in-memory fallback)
│   └── scores/ function.json  index.js  # single Function, route {*rest}
├── dev-server.js                # LOCAL testing only (Node, in-memory store)
├── score-scenario.ps1          # grade the live panel vs a scenario -> Pass + Details
└── complete-scenario.ps1       # build a scenario's 100% solution into the live panel
```

## API (all anonymous)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/catalog` | circuit palette for authoring |
| GET | `/api/scenarios` | list scenarios |
| POST | `/api/scenarios` | create/update a scenario `{id?,title,description,circuits}` |
| GET | `/api/scenarios/{id}` | one scenario + its requirements Markdown |
| DELETE | `/api/scenarios/{id}` | delete a scenario |
| POST | `/api/state` | the panel app publishes its live panel `{units, clientId}` |
| GET | `/api/state` | read the live panel (`units, rev, setBy`) |
| POST | `/api/inspect` | score the live panel against a scenario `{scenarioId}` → `{pass, score, details}` |
| POST | `/api/complete` | build the scenario's 100% solution into the live panel `{scenarioId}` |

**Flow:** author scenarios at `scenarios.html` (each gets an id + Markdown for
lab instructions). The panel app publishes its build to `/api/state` and polls
it. A grader calls `/api/inspect {scenarioId}`; `/api/complete {scenarioId}`
sets the panel to the solution and the panel page refreshes to it.

## Storage
Scenarios and the live panel persist in **Azure Table Storage** (tables
`scenarios`, `runtime`). The Static Web App reads the connection string from the
app setting `AZURE_STORAGE_CONNECTION_STRING`. Provisioned:
`az storage account create -n <name> -g <rg> --sku Standard_LRS` then
`az staticwebapp appsettings set -n <swa> -g <rg> --setting-names AZURE_STORAGE_CONNECTION_STRING=<conn>`.
Without the setting the API falls back to in-memory (local dev).

> Note: the live panel is a single shared record — fine for one active
> session/lab instance. Multi-tenant (many concurrent students) would need a
> per-session key; not yet implemented.

## Test locally first (no Azure needed)
```bash
node dev-server.js            # http://localhost:8781  (serves app + API)
```
The dev server uses the same `handler.js` as the Function, with an in-memory
store (data resets when it stops).

`score-scenario.ps1` grades the live panel against a scenario (returns `$Pass` +
`$Details`); `complete-scenario.ps1` builds the scenario's 100% solution into the
live panel. Both take `$ApiBase`, `$ScenarioId`, `$SessionId`. The application
does the scoring/solving; the scripts only call the API.

## Deploy

### Option A — Azure Portal (easiest)
1. Portal → **Create a resource → Static Web App**.
2. Plan: **Free**. Source: **GitHub** → authorize → repo `coreyjhynes/panel-trainer`, branch `main`.
3. Build details:
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** *(leave blank)*
4. Create. Azure adds a GitHub Actions workflow + the `AZURE_STATIC_WEB_APPS_API_TOKEN`
   secret and deploys. (This repo already includes an equivalent workflow at
   `.github/workflows/azure-static-web-apps.yml` — if Azure adds its own, delete
   one to avoid duplicate runs.)
5. App is live at `https://<name>.azurestaticapps.net`.

### Option B — Azure CLI
```bash
az staticwebapp create \
  --name panel-trainer \
  --resource-group <your-rg> \
  --source https://github.com/coreyjhynes/panel-trainer \
  --branch main \
  --app-location "/" --api-location "api" --output-location "" \
  --login-with-github
```

## Notes
- The **GitHub Pages** copy is static-only (no Functions/storage). Use the
  **Azure** URL for the full app + API.
- Endpoints are unauthenticated by request — fine on a trusted/POC setup. If
  needed, add a shared-secret header check in `api/lib/handler.js`.
- Table Storage cost for training volumes is effectively pennies; the API
  auto-creates the tables on first write.
