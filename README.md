# The Brake, Not the Engine

A live policy kernel for autonomous payment agents. The model proposes; deterministic code decides; escrow releases only when the delivered payload matches the offer.

Seven cases run against one policy: a normal metered call, an over-cap upgrade, an unknown payee, a replayed authorisation, a poisoned tool output, a delivery that never arrives, and a session that runs out of budget.

- `index.html`, `styles.css`, `app.js` — the demo, no build step
- `fonts/` — self-hosted Instrument Serif, IBM Plex Sans, IBM Plex Mono

Open `index.html`, or run `python -m http.server` in this folder.

Every amount is illustrative. The kernel logic is not: the six checks run on whichever proposal you select, in the browser, with no model in the loop.
