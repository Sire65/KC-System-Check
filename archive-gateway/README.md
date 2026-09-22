# KC Archive Gateway

Provider-neutral HTTPS gateway for a private PostgreSQL archive database. Prepared for blitz.cloud, but not coupled to it.

## Required secrets
- DATABASE_URL (injected by provider)
- KC_GATEWAY_TOKEN (random secret; never commit)

## API
- GET /health — no secrets, DB reachability only
- GET /v1/stats — authenticated aggregate usage
- POST /v1/archive — authenticated idempotent archive envelope with SHA-256 verification
- GET /v1/archive/:id — authenticated restore/read path with SHA-256 verification
- POST /v1/selftest — transactional write/read/checksum test; always rolls back

No Supabase, Neon, B2 or provider credentials are embedded. Large files do not belong here; keep them in B2.
