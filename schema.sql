-- Закрытые сделки. Одна сделка = одна строка (deal_id из Битрикс24).
CREATE TABLE IF NOT EXISTS deals (
  deal_id            INTEGER PRIMARY KEY,
  title              TEXT,
  stage_id           TEXT,     -- например WON или C1:LOSE
  stage_semantic_id  TEXT,     -- S = успех, F = провал
  opportunity        REAL,     -- сумма сделки
  currency_id        TEXT,
  assigned_by_id     INTEGER,  -- ответственный
  contact_id         INTEGER,
  company_id         INTEGER,
  category_id        INTEGER,  -- воронка
  date_create        TEXT,
  date_modify        TEXT,
  close_date         TEXT,     -- поле CLOSEDATE (только дата)
  moved_time         TEXT,     -- момент перехода на текущую стадию
  first_closed_at    TEXT,     -- когда сервер впервые увидел закрытие (UTC)
  last_seen_at       TEXT,
  raw_json           TEXT,     -- вся сделка из Битрикса, включая UF_ поля
  ai_summary         TEXT,     -- резюме от Claude
  ai_at              TEXT      -- когда получено резюме (UTC)
);

-- Журнал обработки событий (для отладки)
CREATE TABLE IF NOT EXISTS events_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  TEXT,
  deal_id      INTEGER,
  result       TEXT,   -- saved / ignored / error / ai_saved / ai_comment ...
  note         TEXT
);