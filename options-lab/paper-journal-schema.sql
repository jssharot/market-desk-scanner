-- Options Lab paper-trade journal schema (PostgreSQL 18)
-- Apply only to the dedicated Options Lab database.
CREATE TABLE IF NOT EXISTS paper_trades (
  trade_id text PRIMARY KEY CHECK (length(trade_id) BETWEEN 1 AND 160),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_trades_updated_at_idx ON paper_trades (updated_at DESC);
CREATE TABLE IF NOT EXISTS paper_trade_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id text NOT NULL REFERENCES paper_trades(trade_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('import','entry','mark','exit','manual_edit')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_trade_events_trade_id_idx ON paper_trade_events(trade_id, recorded_at DESC);
