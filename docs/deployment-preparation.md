# Deployment preparation: 2026-10-23

Application deployment is incomplete. No live application/API URL exists and no CloudFormation change set has been created or executed.

Update 2026-10-24: [concurrency and IAM preparation](concurrency-and-iam.md) adds a tested, explicit shared-pool fallback and prepared scoped policies/quota request. The default reserved mode still requires a quota increase; no mode has been deployed. The details below record the preceding preparation snapshot.

## Completed

- Installed AWS CLI v2.38.5 and SAM CLI v1.170.0.
- Created the owner-approved non-root IAM user `oathwire-dev`. The owner configured its password and one authenticator MFA device directly in AWS. No access keys were created.
- Attached approved `ViewOnlyAccess`, `SignInLocalDevelopmentAccess` and inline `OathwirePreflightRead`. These do not grant deployment rights.
- Completed temporary browser-backed CLI login; STS confirmed account `YOUR_AWS_ACCOUNT_ID` and user `oathwire-dev`. Profile region is `eu-central-1`, output JSON. No root CLI credentials were used.
- Added a repeatable read-only account preflight script, preserving an ignored local JSON evidence file.
- Prepared `infra/bootstrap.yaml` locally: private encrypted artifact bucket, TLS bucket policy, runtime permissions boundary and CloudFormation execution role. Nothing in this template has been deployed. The draft scopes named resources and the Lambda PassRole destination; API Gateway, Cognito and CloudFront use generated resource IDs and some creation actions require wildcard resources. Runtime IAM behavior still needs review/live verification.
- Required a runtime permissions boundary on both application execution roles, passed it through the plan workflow, and retained change-set review and no-execute defaults.

## Verified account limits

Lambda account settings and Service Quotas both report **10 concurrent executions** in Frankfurt, with zero functions deployed. Oathwire requires six reserved executions in total. [AWS requires another 100 to remain unreserved](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html), so the empty account needs a quota of at least **106**. This is a deployment blocker, not a failure of the application tests. No increase was requested. Both function limits remain 3 and SQS maximum concurrency remains 2.

API Gateway's 10,000 requests/sec, 5,000 burst and 300 HTTP routes exceed the application's 10/sec, 20 burst and four routes. Cognito has capacity for the required single pool/client. DynamoDB reports limits sufficient for two tables and three GSIs, with the template retaining low on-demand throughput ceilings. SQS returned no applied quota entries; queue processing and account eligibility still require live validation. No non-deleted CloudFormation stacks exist in Frankfurt. Billing visibility through the non-root profile has not been established.

## Local verification

Lint, strict TypeScript checks, all 58 tests including DynamoDB Local, and production builds passed. Formatting, offline SAM assertions (35 application resources), SAM validation and artifact builds passed. The bootstrap draft passes SAM lint validation. Production dependency audit found zero known vulnerabilities. These checks do not establish IAM runtime correctness, Cognito authentication, signed public delivery or actual AWS retries/recovery.

## Remaining deployment steps

1. Resolve the regional Lambda quota blocker with at least 106 total concurrency, preserving the per-function ceilings. Any required account-plan upgrade needs explicit owner approval; none was performed.
2. Review and authorize narrowly scoped deployment/bootstrap permissions. The current principal can inspect metadata but cannot provision Oathwire.
3. Review the bootstrap's four resources, permissions and artifact-storage costs; approve its exact change set before execution. The artifact bucket adds small storage/request costs to the application model.
4. Upload built artifacts, create an unexecuted application change set, review the exact account/region/resources/IAM changes and obtain execution approval. No current change-set ARN exists.
5. Deploy the approved plan, configure the exact CloudFront callback through a reviewed update, publish frontend assets, confirm notification email subscriptions and invite test users.
6. Run every live acceptance case in `deployment.md`, then publish the actual URLs and observed outcomes.

The audited application model remains approximately **$0.71/month idle**, **$2.41/month for the defined small beta**, and **$7.57/month with sustained destination timeouts**, before tax/free allowances and separate deployment artifacts. Planning ranges are $0.60–$1.50, $2–$5 and $8–$15 respectively. These are estimates, not spending caps. See `costs.md` for traffic assumptions and risks. No paid plan upgrade, application resource, public signup or load test has been enabled.
