# Deploy to Azure Static Web Apps (with the scores API)

The app is a static frontend **plus** an unauthenticated `/api/scores` API
(Azure Functions). Azure Static Web Apps hosts both together, on one origin,
on a free tier.

```
panel-trainer/
├── index.html / styles.css / app.js     # static frontend
├── staticwebapp.config.json             # routing (anonymous /api/scores)
├── api/                                 # managed Azure Functions
│   ├── host.json  package.json
│   ├── lib/scoring.js                   # server-side NEC 2023 scoring
│   ├── lib/handler.js  lib/store.js     # request logic + storage
│   └── scores/ function.json  index.js  # GET/POST/DELETE /api/scores
├── dev-server.js                        # LOCAL testing only (Node)
└── submit-score.ps1                     # PowerShell: submit one state, return Pass + Details
```

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET  | `/api/scores` | list records (newest first). Filters: `?trainee=`, `?min_score=`, `?pass=true|false` |
| POST | `/api/scores` | submit a panel STATE `{circuits, units, instanceId, difficulty, durationSec}`; the API scores it server-side, upserts one record per `instanceId`, and returns the result with findings |
| DELETE | `/api/scores` | clear all records |

All routes are **anonymous** (unauthenticated), per requirement.

## Test locally first (no Azure needed)
```bash
node dev-server.js            # http://localhost:8781  (serves app + API)
```
Then in another terminal:
```powershell
.\submit-score.ps1 -ApiBase http://localhost:8781
```
The dev server uses the same `handler.js` as the Function, with an in-memory
store (data resets when it stops).

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

## Make scores durable (recommended)
Without storage config the API keeps records **in memory** (they reset when the
Function instance recycles). To persist, add an Azure **Storage Account** and set
these in the Static Web App → **Configuration → Application settings**:

| Name | Value |
|------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | your storage account connection string |
| `SCORES_TABLE` | `scores` *(optional; default is `scores`)* |

The API auto-creates the Table on first write. Table Storage cost for training
volumes is effectively pennies. (Swap in Cosmos DB / Azure SQL later if you want
richer querying — only `api/lib/store.js` changes.)

## Score from PowerShell
```powershell
$r = .\submit-score.ps1 -ApiBase https://<name>.azurestaticapps.net
$r.Pass          # $true / $false  (PASS / FAIL)
$r.Details       # string[] of findings
(.\submit-score.ps1 -Miswire).Pass   # $false
```

## Notes
- The **GitHub Pages** copy stays static/localStorage-only (Pages can't run the
  Functions). Use the **Azure** URL for the live API.
- The write endpoint is unauthenticated by request — fine on a trusted/POC setup.
  If public spam becomes a concern, add a shared-secret header check in
  `api/lib/handler.js` (and send it from `app.js` + `submit-score.ps1`).
