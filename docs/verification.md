# Verification record

Date: 2026-10-23. Environment: Windows, Node 24, npm 11, Java DynamoDB Local, region configuration eu-central-1. No production performance numbers have been measured.

2026-10-24 preparation: non-root credentials were refreshed and the quota rechecked at 10 (`Adjustable=true`). Explicit shared-beta preflight passes the otherwise empty region; reserved preflight blocks it. New admission tests cover quota growth, co-tenancy, invalid evidence and updates with existing app reservations. Both template modes are validated offline with 35 resources and unchanged queue/API/storage/auth safeguards. All 62 tests passed in [preparation CI](https://github.com/AugereAbove/oathwire/actions/runs/40081588807). See [concurrency and IAM review](concurrency-and-iam.md).

2026-10-24 authorized AWS actions: five reviewed managed policies were created, verified through their stored JSON previews, and attached to the non-root user. Duplicate quota-request history was empty; the default Lambda concurrency quota read returned 1,000. The request for 1,000 was submitted once and remains **PENDING**, with the applied quota still 10 and zero functions. Receipts remain ignored and local. Both infrastructure templates passed live CloudFormation `ValidateTemplate`. No bootstrap/application stack or change set was created; no account-plan or billing change was made. Deployment awaits an applied quota of at least 106 under the approved reserved configuration, without automatic shared-beta fallback. These observations do not verify live application behavior.

AWS preparation update: temporary CLI authentication now verifies the non-root user in account `YOUR_AWS_ACCOUNT_ID`; MFA and zero access keys were confirmed in the console. The approved preflight read policy is attached. Lambda account settings and Service Quotas report only 10 regional concurrent executions, insufficient for the template's six reserved executions plus AWS's required 100 unreserved. No application stack/change set exists. The repeatable preflight script confirms this blocker and records ignored local metadata. See [deployment preparation](deployment-preparation.md) for exact completed work, account limits, costs and remaining approval steps. This does not establish live application correctness.

Executed locally:

- `npm run check`: ESLint, strict TypeScript, 58 unit/service/React/SDK tests and API/worker/frontend builds, including the pre deployment audit corrections.
- Real DynamoDB Local SDK test: transactional concurrent idempotent acceptance, sparse due work query, conditional delivery/attempt completion, destination history index query, conflict response.
- Security tests: blocked IPv4/IPv6 ranges, alternate IP URL forms, HMAC/timestamp verification, private DNS answers, pinned lookup and absolute DNS deadline.
- Failure injection: enqueue failures before/after publication, duplicate jobs, retry publication failure, expired leases, unknown outcomes, stale worker completion, exhaustion and replay preservation.
- SAM `validate --lint` and local artifact build.
- Edge/Playwright inspection of the unconfigured landing page at desktop and mobile sizes. This is not an authenticated AWS dashboard test.
- npm audit of installed dependencies.
- [GitHub Actions CI](https://github.com/AugereAbove/oathwire/actions/runs/39967921252) passed for commit `fa9f987`: clean npm install, all 51 tests including DynamoDB Local, lint, typechecks, production builds, formatting, SAM lint validation and SAM artifact build on Linux.
- Both bundled Lambda handlers loaded successfully under Node 24 with placeholder resource configuration; this verifies bundle loading, not AWS access.
- Fresh Edge browser session reported no console errors. At 390 px viewport width, the page content width was also 390 px with the integration example expanded.
- Pre deployment audit: clean install, current dependency audit (zero vulnerabilities), offline SAM expansion/guard assertions, SAM lint/build, checksum verified Gitleaks all ref and current first party scans. Two explicit false positives (an inert publishing key placeholder and public AWS pricing SKU) were narrowly excepted; no real secrets were detected.
- Current region/rate/source evidence and modeled costs are in `cost-model.json`; the full 35-resource inventory and readiness distinctions are in `pre-deployment-audit.md`. No AWS change set or resource has been created during this audit.
- [Audited commit CI](https://github.com/AugereAbove/oathwire/actions/runs/39999859441) passed for `a9bc8f6`: clean install, all 58 tests with DynamoDB Local, lint/typechecks/builds, formatting, SAM validation/build and offline infrastructure assertions on Linux.

The test command requires `DYNAMODB_LOCAL_URL=http://localhost:8000` to include SDK integration. The test only memory adapter is never used by a production entry point. Transport tests stub HTTPS responses; DynamoDB Local delivery tests use an injected receiver. These do not establish live network delivery.

Not yet verified:

- AWS deployment, IAM correctness at runtime, Cognito invitation/sign-in/recovery and CloudFront callback behavior.
- Actual SQS event source processing, scheduled AWS recovery and DLQ alarms.
- Public HTTPS receiver delivery with signature verification, outage recovery and replay in AWS.
- Account specific OIDC deployment policies and billing notification receipt.
- Load testing (requires an approved budget).

The MVP is incomplete until the live acceptance checklist in `deployment.md` passes. Update this record with observed results, never assumed ones.
