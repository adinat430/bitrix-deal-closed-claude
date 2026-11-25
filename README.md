# Bitrix24 → Cloudflare Workers: закрытые сделки

Мини-сервер, который принимает исходящий вебхук Битрикс24, определяет закрытие сделки, сохраняет данные в базу и добавляет в карточку сделки короткое резюме от Claude.

## Как работает

1. Сделку изменяют в Битрикс24 → исходящий вебхук (`ONCRMDEALUPDATE`) шлёт ID сделки на воркер.
2. Воркер проверяет токен вебхука и запрашивает сделку через входящий вебхук (`crm.deal.get`).
3. Если стадия успешная или провальная (`STAGE_SEMANTIC_ID` = `S` или `F`), сделка сохраняется в Cloudflare D1. Время закрытия берётся из `MOVED_TIME`, плюс сохраняется время обработки (`first_closed_at`, UTC).
4. Данные сделки (без контактов) отправляются в Claude API, резюме сохраняется в базу и добавляется комментарием в карточку (`crm.timeline.comment.add`).
5. Защита от повторов и петель: резюме создаётся один раз на сделку (блокировка через поле `ai_summary`).

## Стек

JavaScript (Cloudflare Workers), Cloudflare D1 (SQLite), Bitrix24 REST API (вебхуки), Claude API.

## Развёртывание

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create bitrix-deals` и вставьте `database_id` в `wrangler.toml`
4. `npx wrangler d1 execute bitrix-deals --remote --file=./schema.sql`
5. Секреты (по одному): `npx wrangler secret put` для `BITRIX_WEBHOOK_URL`, `BITRIX_APP_TOKEN`, `VIEW_TOKEN`, `ANTHROPIC_API_KEY`
6. `npx wrangler deploy`
7. В Битрикс24 создайте исходящий вебхук с адресом `https://<имя-воркера>.<поддомен>.workers.dev/bitrix/deal` и событием «Обновление сделки»

## Просмотр данных

`GET /deals` с заголовком `Authorization: Bearer <VIEW_TOKEN>` возвращает последние закрытые сделки.

## Ограничения

- Обрабатывается только событие обновления сделки (создание сразу закрытой сделки не отслеживается).
- В коде нет токенов и адресов вебхуков: они хранятся как секреты Cloudflare.
- Для персональных данных учитывайте требования законодательства: данные отправляются в Cloudflare и Anthropic.
