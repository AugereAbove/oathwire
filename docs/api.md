# API

Management routes use `Authorization: Bearer <Cognito access token>`. Publishing uses a separate `ow_live_` project key. Management ownership failures return 404. Use JSON bodies on POST/PATCH; payloads are limited to 16 KiB. All timestamps are UTC ISO strings except `nextAttemptAt` (epoch milliseconds) and `expiresAt` (epoch seconds).

## Routes

| Method             | Path                                  | Body / behavior                                        |
| ------------------ | ------------------------------------- | ------------------------------------------------------ |
| GET                | `/health`                             | Public liveness, no infrastructure details             |
| GET                | `/v1/me`                              | Authenticated subject                                  |
| GET, POST          | `/v1/projects`                        | List / create `{name, description?}`                   |
| GET, PATCH, DELETE | `/v1/projects/{id}`                   | Read / rename or describe / archive                    |
| GET, POST          | `/v1/projects/{id}/destinations`      | List / create `{name,url,eventTypes}`                  |
| GET, PATCH, DELETE | `/v1/destinations/{id}`               | Read / edit `{name?,enabled?,eventTypes?}` / retire    |
| POST               | `/v1/destinations/{id}/rotate-secret` | `{}`; returns new `signingSecret` once                 |
| GET                | `/v1/destinations/{id}/deliveries`    | Paginated destination history                          |
| GET, POST          | `/v1/projects/{id}/keys`              | Active metadata / create `{label}`, returns `key` once |
| DELETE             | `/v1/keys/{id}`                       | Revoke immediately                                     |
| POST               | `/v1/events`                          | Publish `{type,data}` using project API key            |
| GET                | `/v1/projects/{id}/events`            | History with `type`, `hours` (1–168; default 24)       |
| GET                | `/v1/events/{id}`                     | Event with payload                                     |
| GET                | `/v1/events/{id}/deliveries`          | Original and replay deliveries                         |
| GET                | `/v1/deliveries/{id}`                 | Delivery status and schedule                           |
| GET                | `/v1/deliveries/{id}/attempts`        | Recorded attempts, including unknown outcomes          |
| POST               | `/v1/deliveries/{id}/replay`          | `{}` plus required Idempotency-Key                     |
| GET                | `/v1/projects/{id}/stats`             | Bounded recent sample with explicit scope              |

Objects expose `id`. Lists return `{items: [...], cursor?: "..."}`. Pass the returned opaque `cursor` query parameter to read the next page. Event filtering happens within each page; continue even if a filtered page is empty. Archive is irreversible. Retired configurations count toward the five-destination cap. There is no URL mutation endpoint.

## Publishing

```http
POST /v1/events
Authorization: Bearer ow_live_YOUR_KEY
Content-Type: application/json
Idempotency-Key: order-1842

{"type":"order.created","data":{"orderId":"1842"}}
```

Event types contain 1–100 ASCII letters, digits, dots, underscores or hyphens, starting with a letter or digit. `data` must be an object. Additional envelope fields and JSON nesting beyond 16 levels are rejected. Destination `eventTypes` is either `["*"]` or an exact-name list.

A successful response is HTTP 202:

```json
{
  "id": "evt_<generated-uuid>",
  "status": "accepted",
  "matchedDestinations": 1,
  "createdAt": "<UTC timestamp>"
}
```

These placeholders are illustrative, not actual service identifiers. Same project + idempotency key + canonical payload returns the original response for seven days; different payload returns 409. Keys are 1–128 visible ASCII characters. Do not put secrets in them. Automatic retry delays are 10, 30, 90, 300 and 900 seconds after the preceding attempt. Scheduling/reconciliation can make observed waits longer.

Errors use `{"error":{"code":"INVALID_EVENT","message":"..."}}`. Statuses: 400 malformed JSON/parameters, 401 unauthenticated, 403 disabled project, 404 missing/inaccessible, 409 conflict, 413 oversized, 415 wrong content type, 422 invalid fields, 429 quota/limit and 503 infrastructure failure/concurrent contention. No stacks or raw AWS errors are returned.

## Receiving and signatures

The worker POSTs the exact JSON bytes of `{id,type,created_at,data}` and sends:

- `Content-Type: application/json`, `User-Agent: Oathwire/1.0`.
- `X-Oathwire-Event-Id`, `X-Oathwire-Delivery-Id`, `X-Oathwire-Attempt`.
- `X-Oathwire-Timestamp` (Unix seconds).
- `X-Oathwire-Signature: v1=<hex HMAC-SHA256>`.

Compute HMAC over `timestamp + "." + rawBody`, before parsing JSON. [The example receiver](../examples/receiver.ts) uses the tested timing-safe verifier, five-minute timestamp tolerance and a small duplicate set for demonstration. A real receiver must persist deduplication atomically with its business effect. Automatic retries preserve the delivery ID. Replay has a fresh ID and a reference to the failed original in Oathwire's history.

Signing secrets are random strings used directly as HMAC keys; do not base64-decode them. Rotation affects new claims immediately. Reject missing/malformed signatures and stale timestamps. A 2xx response acknowledges receipt; it cannot prove downstream work completed. Redirects are failures and never followed.
