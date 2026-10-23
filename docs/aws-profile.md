# Secure AWS CLI profile setup

These are owner run instructions, not commands executed during the local audit. They do not authorize deployment. No AWS resource creation, policy change or IAM setup has been performed by this project.

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
