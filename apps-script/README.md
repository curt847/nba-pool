# apps-script/

Google Apps Script source for the NBA Moneyline Pool 2026 backend. Synced via [clasp](https://github.com/google/clasp).

## What's connected

- **Script (container-bound)**: `1xAmbl9ZHQx7YE790MaIOczoZc4vG4laiuDoOJaheGSOm66dCB-L2QSs9`
- **Container sheet** (`NBA Pool Odds`): https://docs.google.com/spreadsheets/d/1ebwaFEi3du1YOhF6X9R1ZaEOAr2YJopApeeU2kSXnug/edit
- **Live deployment** (used by `index.html` `CONFIG.PROXY_URL`): `AKfycbzO3naVBGuiLPY6rKXjT2cGvwMEpCekfJXDdEP8AAoAPiWQfKT9kvqnfX2Q2LKyoYkUPw`

## Workflow

```bash
cd apps-script

clasp pull                 # sync editor → local
clasp push                 # sync local → editor (head only, not deployment)
clasp deployments          # list active deployments
clasp deploy --description "msg" --deploymentId <id>   # update existing deployment in place
clasp open-script          # open the project in the browser
```

`clasp push` updates the editor's "head" version. The live `PROXY_URL` keeps serving whatever was last *deployed*, not the head — to roll out backend changes, follow the push with a `clasp deploy --deploymentId <existing>` (or use the editor's Deploy menu) so the existing deployment URL gets updated. Creating a new deployment instead would change the URL and break the frontend.

## Re-cloning from scratch

If this directory is ever wiped:

```bash
mkdir -p apps-script && cd apps-script
clasp clone 1xAmbl9ZHQx7YE790MaIOczoZc4vG4laiuDoOJaheGSOm66dCB-L2QSs9
```

The script is container-bound, so it doesn't appear in `clasp list-scripts` directly — that listing only shows standalone projects. The scriptId above is the canonical reference.

## First-time auth

`clasp login` from a real terminal (not Claude Code's bash — no TTY for the OAuth code paste). Use the account that owns the script (`curt847@gmail.com`).
