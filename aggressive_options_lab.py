"""Aggressive Options Lab — paper-only signal qualification and risk limits.

This module does not place orders or modify existing Market Desk alerts.
All quote and catalyst inputs must be supplied by the host application.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

MAX_PREMIUM = 250.0
MAX_OPEN_PREMIUM = 500.0
DAILY_LOSS_LIMIT = 250.0
WEEKLY_LOSS_LIMIT = 750.0

@dataclass(frozen=True)
class Candidate:
    symbol: str
    option_symbol: str
    strategy: str  # momentum | home_run
    premium_ask: float
    bid: float
    volume: int
    open_interest: int
    relative_stock_volume: float
    delta: float
    dte: int
    catalyst_verified: bool
    technical_confirmed: bool
    quote_time: datetime
    contract_multiplier: int = 100

@dataclass(frozen=True)
class RiskState:
    open_premium: float = 0
    realized_daily_pnl: float = 0
    realized_weekly_pnl: float = 0
    consecutive_losses: int = 0

def screen(candidate: Candidate, risk: RiskState, now: Optional[datetime] = None):
    """Return (eligible, reasons). No execution or broker calls."""
    now = now or datetime.now(timezone.utc)
    reasons = []
    c = candidate
    if c.strategy not in ("momentum", "home_run"):
        reasons.append("unknown_strategy")
        return False, reasons
    if c.quote_time.tzinfo is None or abs((now - c.quote_time).total_seconds()) > 120:
        reasons.append("stale_or_naive_quote")
    if c.bid < 0 or c.premium_ask <= 0 or c.bid > c.premium_ask:
        reasons.append("invalid_market")
    cost = c.premium_ask * c.contract_multiplier
    if cost < 100 or cost > MAX_PREMIUM:
        reasons.append("premium_outside_budget")
    if risk.open_premium + cost > MAX_OPEN_PREMIUM:
        reasons.append("aggregate_premium_limit")
    if risk.realized_daily_pnl <= -DAILY_LOSS_LIMIT:
        reasons.append("daily_loss_limit")
    if risk.realized_weekly_pnl <= -WEEKLY_LOSS_LIMIT:
        reasons.append("weekly_loss_limit")
    if risk.consecutive_losses >= 3:
        reasons.append("loss_cooldown")
    spread = (c.premium_ask - c.bid) / ((c.premium_ask + c.bid) / 2) if c.bid + c.premium_ask > 0 else float("inf")
    if c.strategy == "momentum":
        if c.relative_stock_volume < 1.5 or c.volume < 500 or c.open_interest < 1000:
            reasons.append("insufficient_liquidity_or_relative_volume")
        if spread > .08:
            reasons.append("spread_too_wide")
        if not .35 <= abs(c.delta) <= .60 or not 3 <= c.dte <= 14:
            reasons.append("contract_profile_mismatch")
        if not c.technical_confirmed:
            reasons.append("technical_confirmation_missing")
    else:
        if c.relative_stock_volume < 2 or c.volume < 200 or c.open_interest < 500:
            reasons.append("insufficient_liquidity_or_relative_volume")
        if spread > .12:
            reasons.append("spread_too_wide")
        if not .10 <= abs(c.delta) <= .35 or not 1 <= c.dte <= 10:
            reasons.append("contract_profile_mismatch")
        if not c.catalyst_verified:
            reasons.append("unverified_catalyst")
    return not reasons, reasons
