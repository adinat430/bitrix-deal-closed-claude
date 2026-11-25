// Cloudflare Worker: принимает событие Битрикс24 «сделка обновлена»,
// проверяет, что сделка ЗАКРЫТА, и сохраняет её в базу D1.
//
// Секреты (задаются через `wrangler secret put`):
//   BITRIX_WEBHOOK_URL — адрес ВХОДЯЩЕГО вебхука (чтобы читать сделку)
//   BITRIX_APP_TOKEN   — токен ИСХОДЯЩЕГО вебхука (чтобы проверять, что стучится именно Битрикс)
//   VIEW_TOKEN         — пароль для просмотра /deals

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Проверка «сервер жив» — просто открыть адрес в браузере
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ok: bitrix-deal-closed is running');
    }

    // 2) Сюда стучится Битрикс24
    if (request.method === 'POST' && url.pathname === '/bitrix/deal') {
      return handleBitrixEvent(request, env, ctx);
    }

    // 3) Просмотр сохранённых сделок (под паролем)
    if (request.method === 'GET' && url.pathname === '/deals') {
      return listDeals(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleBitrixEvent(request, env, ctx) {
  // Битрикс шлёт данные формой (application/x-www-form-urlencoded), а не JSON
  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // Защита: адрес воркера публичный, поэтому проверяем токен исходящего вебхука
  const token = form.get('auth[application_token]') || '';
  if (!env.BITRIX_APP_TOKEN || !safeEqual(token, env.BITRIX_APP_TOKEN)) {
    return new Response('forbidden', { status: 403 });
  }

  const event = String(form.get('event') || '').toUpperCase();
  const dealId = Number(form.get('data[FIELDS][ID]'));

  // Нам нужен только ONCRMDEALUPDATE и корректный ID
  if (event !== 'ONCRMDEALUPDATE' || !Number.isInteger(dealId) || dealId <= 0) {
    return new Response('ignored', { status: 200 });
  }

  // Отвечаем Битриксу сразу «200», а работу делаем в фоне (waitUntil).
  // Если ответить не 2xx, Битрикс будет повторять запрос.
  ctx.waitUntil(processDeal(dealId, env));
  return new Response('ok', { status: 200 });
}

async function processDeal(dealId, env) {
  const receivedAt = new Date().toISOString(); // UTC
  try {
    // Битрикс присылает только ID, поэтому сами запрашиваем сделку целиком
    const deal = await fetchDeal(dealId, env);

    // Отдельного события «сделка закрыта» нет. Закрытие = стадия стала успешной или провальной.
    // STAGE_SEMANTIC_ID: P — в работе, S — успех, F — провал (одинаково во всех воронках)
    const semantic = deal.STAGE_SEMANTIC_ID;
    if (semantic !== 'S' && semantic !== 'F') {
      await log(env, receivedAt, dealId, 'ignored', `не закрыта (stage=${deal.STAGE_ID})`);
      return;
    }

    await saveDeal(env, deal, receivedAt);
    await log(
      env, receivedAt, dealId, 'saved',
      `закрыта: ${semantic === 'S' ? 'успех' : 'провал'} (stage=${deal.STAGE_ID})`
    );
  } catch (err) {
    await log(env, receivedAt, dealId, 'error', String(err && err.message ? err.message : err));
  }
}

async function fetchDeal(dealId, env) {
  const base = String(env.BITRIX_WEBHOOK_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('BITRIX_WEBHOOK_URL не задан');

  const resp = await fetch(`${base}/crm.deal.get.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: dealId }),
  });
  if (!resp.ok) throw new Error(`Bitrix HTTP ${resp.status}`);

  const data = await resp.json();
  if (data.error) throw new Error(`${data.error}: ${data.error_description || ''}`);
  return data.result;
}

async function saveDeal(env, d, receivedAt) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  await env.DB.prepare(
    `INSERT INTO deals (
       deal_id, title, stage_id, stage_semantic_id, opportunity, currency_id,
       assigned_by_id, contact_id, company_id, category_id,
       date_create, date_modify, close_date, moved_time,
       first_closed_at, last_seen_at, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_id) DO UPDATE SET
       title             = excluded.title,
       stage_id          = excluded.stage_id,
       stage_semantic_id = excluded.stage_semantic_id,
       opportunity       = excluded.opportunity,
       currency_id       = excluded.currency_id,
       assigned_by_id    = excluded.assigned_by_id,
       contact_id        = excluded.contact_id,
       company_id        = excluded.company_id,
       category_id       = excluded.category_id,
       date_create       = excluded.date_create,
       date_modify       = excluded.date_modify,
       close_date        = excluded.close_date,
       moved_time        = excluded.moved_time,
       first_closed_at   = COALESCE(deals.first_closed_at, excluded.first_closed_at),
       last_seen_at      = excluded.last_seen_at,
       raw_json          = excluded.raw_json`
  )
    .bind(
      Number(d.ID),
      d.TITLE ?? null,
      d.STAGE_ID ?? null,
      d.STAGE_SEMANTIC_ID ?? null,
      num(d.OPPORTUNITY),
      d.CURRENCY_ID ?? null,
      num(d.ASSIGNED_BY_ID),
      num(d.CONTACT_ID),
      num(d.COMPANY_ID),
      num(d.CATEGORY_ID),
      d.DATE_CREATE ?? null,
      d.DATE_MODIFY ?? null,
      d.CLOSEDATE ?? null,
      d.MOVED_TIME ?? null,
      receivedAt, // first_closed_at: сохранится только при первой вставке (см. COALESCE)
      receivedAt, // last_seen_at
      JSON.stringify(d)
    )
    .run();
}

async function log(env, receivedAt, dealId, result, note) {
  try {
    await env.DB.prepare(
      'INSERT INTO events_log (received_at, deal_id, result, note) VALUES (?, ?, ?, ?)'
    ).bind(receivedAt, dealId, result, note).run();
  } catch (e) {
    console.error('log failed', e); // лог не должен ронять обработку
  }
}

async function listDeals(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.VIEW_TOKEN || !safeEqual(auth, `Bearer ${env.VIEW_TOKEN}`)) {
    return new Response('unauthorized', { status: 401 });
  }
  const { results } = await env.DB.prepare(
    `SELECT deal_id, title, stage_semantic_id, opportunity, currency_id,
            first_closed_at, close_date
     FROM deals ORDER BY first_closed_at DESC LIMIT 50`
  ).all();
  return Response.json(results);
}

// Сравнение строк без утечки по времени (чтобы токен нельзя было подобрать по скорости ответа)
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
