-- Закрытые сделки. Одна сделка = одна строка (deal_id из Битрикс24).
CREATE TABLE IF NOT EXISTS deals (
  deal_id            INTEGER PRIMARY KEY,
  title              TEXT,
  stage_id           TEXT,
  stage_semantic_id  TEXT,     -- S = успех, F = провал
  opportunity        REAL,
  currency_id        TEXT,
  assigned_by_id     INTEGER,
  contact_id         INTEGER,
  company_id         INTEGER,
  category_id        INTEGER,
  date_create        TEXT,
  date_modify        TEXT,
  close_date         TEXT,
  moved_time         TEXT,     -- момент перехода на текущую стадию
  first_closed_at    TEXT,     -- когда сервер впервые увидел закрытие (UTC)
  last_seen_at       TEXT,
  raw_json           TEXT,
  ai_summary         TEXT,     -- резюме от Claude
  ai_at              TEXT
);

-- Журнал обработки событий (для отладки)
CREATE TABLE IF NOT EXISTS events_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  TEXT,
  deal_id      INTEGER,
  result       TEXT,
  note         TEXT
);
