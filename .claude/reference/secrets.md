# Secrets & environment variables

> Env var names, what they key, and where they're consumed. Never store actual secret VALUES here: names and purposes only.

None for the game or its build: neither reads environment variables, and the game calls no keyed service. Add a row when that changes.

Tooling only, no secrets: `CHROME_PLACE` (where `scripts/lib/launch-chrome.mjs` puts Chrome; the browser and perf checks default it to `offscreen` when unset) and `BRAIN_MODULE_URL` (points `scripts/check-brain.mjs` at another brain module, used to prove the check can fail).

| Env var | Keys what | Consumed in |
|---|---|---|
