# plcp-mng worker integration

After deployment, open Admin Settings → Connections → plcp-mng integration.
Confirm the HTTPS public monitor origin (prefilled from the browser) and choose
Generate API key. Copy the one-time key into plcp-mng Admin → plcp-dc along with
the deployed service origin, then save and test the connection. No integration
environment variables are required. The web service creates the additive
eldorado_integration_config and eldorado_integration_orders tables at startup.

Save URL updates the customer monitor origin. Rotate API key requires confirmation
and invalidates the old key immediately for subsequent requests. Update plcp-mng
with the new key to reconnect. In-flight requests already authenticated can finish.
Keys are generated with 32 random bytes. Only their SHA-256 hash and last four
characters are persisted; GET never returns a key or hash. A lost key must be
rotated. Settings writes use revisions so concurrent admins cannot silently
overwrite a newer key. Settings endpoints require an existing admin session:

- GET /api/admin/eldorado-integration: masked metadata and revision.
- PUT /api/admin/eldorado-integration: { publicBase, revision }.
- POST /api/admin/eldorado-integration/key: { publicBase, revision, rotate }.
  rotate must be true when replacing a configured key. Only this response returns
  apiKey. Responses are no-store. UI Kit preview never calls these endpoints.

Legacy PLCP_MNG_INTEGRATION_KEY and PLCP_PUBLIC_URL values, if present before
the first startup of this version, are imported once. Database settings take
precedence thereafter, including after key rotation and service restarts.
Provider credentials are separate from this integration key.

Integration routes require Authorization: Bearer <generated API key>:

- GET /api/integrations/eldorado/catalog: category IDs, names and allowed methods.
- POST /api/integrations/eldorado/validate: { kind, invite }. Boost join forms
  return code join_application; unknown verification results fail closed.
- POST /api/integrations/eldorado/orders: { externalId, kind, invite, amount,
  settings }. kind is members or boosts. Members settings: service, categoryId,
  delay, speedProfile, joinMethod, durationMonths, reactionLimit. Boost settings:
  duration, boostProvider, boostStockPool, concurrency, removeTwoFactor.
- GET /api/integrations/eldorado/orders/:externalId: sanitized status, counts,
  remote uniqid and deliveryMessage. Never returns account tokens or credentials.

externalId is the Eldorado order ID. It is unique and durable. The remote uniqid
is reserved before the existing creation handler can touch stock. Retries reuse
the original order. An unconfirmed creation returns REVIEW and is not submitted
again. Operator review is intentional: checking the existing order and stock is
safer than consuming another package after an uncertain provider response.

The original admin creation endpoints retain session authentication and reuse
the same creation handlers. Boost integration cannot enable Continue anyway or
membership-screening bypass. Existing Members and Boost processing is unchanged.

Tests use mock orders; no real deliveries are created. Verify a controlled
end-to-end order after deploying both repos and integration-websocket.
