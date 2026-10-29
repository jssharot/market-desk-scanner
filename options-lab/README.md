# Options Lab (development branch only)

A separate short-term options interface will share the existing Market Desk Alpaca data service, but **must not** alter the running paper-v1/paper-v2 engine or write to live trading records.

## Initial milestone
- Read-only contract qualification and risk-budget checks (see risk.mjs)
- 0–10 calendar days to expiration, configurable
- Default $1,000 maximum premium per one-contract long-option trade
- Reject stale quotes, wide spreads and invalid bid/ask sizes
- Never treat a qualifying contract as an actionable trade without a validated underlying setup and a fresh quote recheck
- All trade alerts must carry the contract, timestamp, entry, stop/invalidation, target, and expiration; no auto-execution

## Planned integrations (not yet deployed)
- Authenticated read-only backend endpoints for contract discovery, quote lookup, scanner decisions and journal history
- Dedicated mobile-first Options Lab web UI
- Scheduled server-side scans, deduplicated push notifications and alert preferences
- OpenAI-powered assistant with strictly scoped, authenticated read-only tools and shared ChatGPT-accessible endpoints
- Distinguish paper trades, manually entered positions, and brokerage-verified holdings; never imply Robinhood sync

## Security
Keep Alpaca/OpenAI secrets server-side. Require authentication for portfolio/journal data and rate-limit AI calls. Push subscription data must remain private. Do not deploy from this branch before integration tests and review.
