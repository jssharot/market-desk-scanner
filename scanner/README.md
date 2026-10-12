# Market Desk paper scanner

This is a read-only market-data service with an internal simulation journal. It never submits an order, reads holdings, or connects to Robinhood.

## Activation still required

1. Obtain an Alpaca account with SIP stock and OPRA options entitlements (currently Algo Trader Plus, $99/month). Confirm personal-use eligibility and provider terms. Create paper-environment API credentials. The service uses only market-data endpoints and the exchange calendar.
2. Publish this scanner directory in a GitHub/GitLab repository accessible to Render. The Sites Git repository is not a Render-supported source provider. Use `render.yaml` from the repository root via Render's Blueprint file path setting. Estimate $7/month Starter compute + $0.25/month 1 GB disk, excluding excess bandwidth/build charges.
3. Set Alpaca keys through Render secret environment variables. Set VAPID keys to the existing Market Desk keys through secure runtime configuration so the same device subscriptions work. Never put secrets in Git, chat, command arguments, or files.
4. Configure Market Desk runtime secrets `SCANNER_SERVICE_URL` (HTTPS onrender.com origin) and `SCANNER_SHARED_SECRET` (matching the Render secret). Existing app hosting remains owner-private.
5. POST `/api/scanner/sync` using supported Sites service access to copy existing opted-in device subscriptions to the scanner. Subscription changes are subsequently forwarded. Verify scanner `/state` through the private Site proxy and send a paper-only notification test before enabling entries.
6. Use the Scanner page to start paper entries; default is paused. Open simulations are monitored while entries are paused. Runtime polls every 15 seconds and evaluates complete one-minute bars. This is faster polling, not a tick-by-tick streaming scanner.

## Rules and data

`engine.mjs` exports versioned rules, signal selection, contract filters, fill assumptions, exit triggers, and journal metrics. `service.mjs` runs one sequential polling loop with authenticated API access and an atomic disk-backed journal. The fixed universe is SPY, QQQ, AAPL, MSFT, NVDA, META and TSLA. Rules appear in the app.

SIP bars provide volume and bar VWAP. Session VWAP weights these bar VWAPs by bar volume. EMAs initialize with the first session close, so they are intraday EMAs, not overnight continuous indicators. Trigger volume compares the prior 20 bars rather than historical time-normalized relative volume. Opening range requires all first 15 minutes, and signals require contiguous recent data. Chain selection requires finite Greeks and IV, but does not compute IV rank, use open interest, filter news/earnings, or claim an optimized strategy.

This initial version simulates one contract with premium capped at $3 including slippage. It will intentionally reject many otherwise valid expensive contracts. Exits are evaluated on polling quotes; thresholds cannot guarantee fills, cap losses, or recover intrapoll excursions. Missing fresh exit quotes create pending exits. Recovered prior-session trades exit at the next valid bid and are marked as monitoring-gap recoveries, not reconstructed historic exits.

Buy simulation: ask + $0.01. Sell simulation: bid − $0.01, floored at zero. Fees: $0.65 each side (model assumption, not Robinhood fee schedule). Metrics are realized net dollars with chronological closed-trade drawdown. Retain at least a month of testing; extend if the sample is insufficient. Hourly discretionary alerts remain separate and unchanged.

## Operation

Requires Node 22 or newer. No third-party runtime dependencies. Run `node --test scanner/engine.test.mjs`, then `node scanner/service.mjs`. Public `/health` reveals only process health; every other service route requires a 32+ character shared secret. Keep a single instance attached to its disk. SIGTERM stops new scans and saves in-flight work. Startup refuses corrupt state instead of discarding the journal.

No credentials or paid services have been activated as part of preparing this code. End-to-end live-data, remote hosting, and device notification verification remain required.
