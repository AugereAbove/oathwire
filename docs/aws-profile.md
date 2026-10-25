# Secure AWS CLI profile setup

## Current access status (2026-10-25)

The applied Lambda concurrency quota is 1,000. Bootstrap and application deployment completed in reserved mode, with 3 executions per function and SQS maximum concurrency 2. The reviewed API runtime/callback update and frontend publication also completed. All five temporary quota, bootstrap, planning, execution and publishing policy attachments are now removed. The non-root profile retains ViewOnlyAccess, SignInLocalDevelopmentAccess and the inline OathwirePreflightRead policy; MFA and temporary credentials remain in use. No root CLI credentials or access keys were created. Authenticated application acceptance is still pending; see [verification](verification.md).

## Initial access snapshot (2026-10-23)

AWS CLI v2.38.5 and SAM CLI v1.170.0 are installed locally. The owner approved creation of IAM user `oathwire-dev` with `ViewOnlyAccess` and `SignInLocalDevelopmentAccess`, then completed password and MFA setup directly in AWS. The console confirmed one MFA device and zero access keys. Browser login completed and STS verified `arn:aws:iam::YOUR_AWS_ACCOUNT_ID:user/oathwire-dev` in account `YOUR_AWS_ACCOUNT_ID`. The local profile defaults to `eu-central-1` and JSON output. Temporary login credentials remain outside the repository.

The owner also approved the inline `OathwirePreflightRead` policy in `infra/preflight-read-policy.json`. It is attached and its Lambda/account-quota read actions work through the non-root CLI. Permissions are restricted to Frankfurt; individual quota lookups are limited to five application services, while quota listing can show service quotas across that region.

Read-only checks found no non-deleted CloudFormation stacks and no Lambda functions in Frankfurt. **The Lambda concurrent-execution quota is 10, which blocks the default reserved mode.** That mode reserves 3 executions for each of two functions. AWS requires 100 executions to remain unreserved, so this empty account needs at least 106 total. No quota increase has been requested. The explicit `shared-beta` alternative introduced on 2026-10-24 omits reservations only after that mode is selected; see [the reduced isolation and approval requirements](concurrency-and-iam.md). [AWS concurrency API requirements](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html).

API Gateway reports a 10,000 requests/sec regional quota, burst 5,000 and 300 routes per HTTP API; the application uses lower throttles and four routes. Cognito reports 1,000 pools and 1,000 clients per pool; the application needs one of each. DynamoDB reports capacity limits of 80,000 account read/write units each and 40,000 per table, 2,500 tables and 20 GSIs/table; the application needs two on-demand tables and three GSIs. Provisioned-capacity limits are not measurements of the application's on-demand usage. The SQS applied-quota listing returned no entries, so it does not confirm queue-specific live behavior.

Repeat these read-only checks with `./scripts/aws-preflight.ps1 -AccountId YOUR_AWS_ACCOUNT_ID` (reserved default) or explicitly add `-ConcurrencyMode shared-beta`. The shared Node implementation writes metadata to ignored `.local/deployment/aws-preflight.json`, rejects a mismatched account/root CLI profile, and checks the selected mode. No application infrastructure or change set has been created, and no deployment permissions have been granted.

The instructions below describe repeatable setup and do not authorize deployment. Do not share credential files, cached tokens, passwords or MFA codes in chat or Git.

## Install AWS CLI v2

On Windows, download the signed installer from [AWS's installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), or run its documented MSI installer locally. Verify the publisher is Amazon Web Services. Reopen PowerShell and check `aws --version`. Use the current CLI v2; the browser `aws login` option below requires at least 2.32.0.

Avoid root credentials and long lived access keys. Use MFA on your account. Credentials and token caches belong under your Windows user directory, never inside this repository.

## Option A: existing IAM Identity Center access

If your account administrator has already configured IAM Identity Center and assigned you a suitable permission set, run:

```powershell
aws configure sso --profile oathwire-dev
```

Use these wizard values:

| Prompt                | Enter                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| SSO session name      | `oathwire`                                                                      |
| SSO start/issuer URL  | The exact portal URL supplied by your administrator                             |
| SSO region            | The region hosting that Identity Center directory; it may differ from Frankfurt |
| Registration scopes   | `sso:account:access`                                                            |
| AWS account           | The intended account; check its 12-digit ID                                     |
| Role / permission set | Your assigned scoped development/deployment role                                |
| Default client region | `eu-central-1`                                                                  |
| Default output        | `json`                                                                          |

Complete authentication only in the AWS browser window, then:

```powershell
aws sso login --profile oathwire-dev
aws configure set region eu-central-1 --profile oathwire-dev
aws configure set output json --profile oathwire-dev
aws sts get-caller-identity --profile oathwire-dev --region eu-central-1
```

The last command is read only. Confirm the returned account/ARN locally; do not post tokens, browser authorization codes or credential files. SSO configuration is saved in `%USERPROFILE%\.aws\config`; cached temporary tokens are under `%USERPROFILE%\.aws\sso\cache`. Do not manually copy or commit them. [AWS SSO profile documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).

## Option B: browser login for an existing nonroot console identity

If you do not use Identity Center, current CLI v2 supports temporary console backed local credentials. The identity must already have the `SignInLocalDevelopmentAccess` permission; any IAM change to grant it needs separate owner/admin authorization. Do not use the root account for this.

```powershell
aws login --profile oathwire-dev --region eu-central-1
aws configure set region eu-central-1 --profile oathwire-dev
aws configure set output json --profile oathwire-dev
aws sts get-caller-identity --profile oathwire-dev --region eu-central-1
```

Use the AWS browser page and select the intended nonroot role/account. The CLI manages temporary credentials and refreshes within the session's allowed duration. Its cache stays under `%USERPROFILE%\.aws\login\cache`. [AWS browser login documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

## Use the profile deliberately

Prefer explicit `--profile oathwire-dev --region eu-central-1` on AWS/SAM commands. For a future authorized local API session:

```powershell
$env:AWS_PROFILE='oathwire-dev'
$env:AWS_REGION='eu-central-1'
$env:AWS_SDK_LOAD_CONFIG='1'
npm run dev
```

Do not set `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` in `.env`. Existing credential environment variables override profiles; use a fresh terminal or remove only known obsolete AWS credential variables from that terminal before logging in. Never print their values to diagnose configuration.

For Identity Center, `aws sso logout` clears cached SSO sessions and can affect other profiles. For console backed login, use `aws logout --profile oathwire-dev`. GitHub Actions uses OIDC roles rather than either of these local sessions. Authentication is separate from authorization: a working profile does not grant permission to deploy this project.
