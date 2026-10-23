# Verification record

Date: 2026-10-23. Environment: Windows, Node 24, npm 11, Java DynamoDB Local, region configuration eu-central-1. No production performance numbers have been measured.

Executed locally:

- `npm run check`: ESLint, strict TypeScript, 58 unit/service/React/SDK tests and API/worker/frontend builds, including the pre-deployment audit corrections.
- Real DynamoDB Local SDK test: transactional concurrent idempotent acceptance, sparse due-work query, conditional delivery/attempt completion, destination-history index query, conflict response.
- Security tests: blocked IPv4/IPv6 ranges, alternate IP URL forms, HMAC/timestamp verification, private DNS answers, pinned lookup and absolute DNS deadline.
- Failure injection: enqueue failures before/after publication, duplicate jobs, retry publication failure, expired leases, unknown outcomes, stale worker completion, exhaustion and replay preservation.
- SAM `validate --lint` and local artifact build.
- Edge/Playwright inspection of the unconfigured landing page at desktop and mobile sizes. This is not an authenticated AWS dashboard test.
- npm audit of installed dependencies.
- [GitHub Actions CI](https://github.com/AugereAbove/oathwire/actions/runs/39967921252) passed for commit `fa9f987`: clean npm install, all 51 tests including DynamoDB Local, lint, typechecks, production builds, formatting, SAM lint validation and SAM artifact build on Linux.
- Both bundled Lambda handlers loaded successfully under Node 24 with placeholder resource configuration; this verifies bundle loading, not AWS access.
- Fresh Edge browser session reported no console errors. At 390 px viewport width, the page content width was also 390 px with the integration example expanded.
- Pre-deployment audit: clean install, current dependency audit (zero vulnerabilities), offline SAM expansion/guard assertions, SAM lint/build, checksum-verified Gitleaks all-ref and current first-party scans. Two explicit false positives (an inert publishing-key placeholder and public AWS pricing SKU) were narrowly excepted; no real secrets were detected.
- Current region/rate/source evidence and modeled costs are in `cost-model.json`; the full 35-resource inventory and readiness distinctions are in `pre-deployment-audit.md`. No AWS change set or resource has been created during this audit.

The test command requires `DYNAMODB_LOCAL_URL=http://localhost:8000` to include SDK integration. The test-only memory adapter is never used by a production entry point. Transport tests stub HTTPS responses; DynamoDB Local delivery tests use an injected receiver. These do not establish live network delivery.

Not yet verified:

- AWS deployment, IAM correctness at runtime, Cognito invitation/sign-in/recovery and CloudFront callback behavior.
- Actual SQS event source processing, scheduled AWS recovery and DLQ alarms.
- Public HTTPS receiver delivery with signature verification, outage recovery and replay in AWS.
- Account-specific OIDC deployment policies and billing notification receipt.
- Load testing (requires an approved budget).

The MVP is incomplete until the live acceptance checklist in `deployment.md` passes. Update this record with observed results, never assumed ones.
