# Deployment

**Deployment is on hold at the owner's request.** No AWS resource has been created, modified or deleted. Do not run the planning, upload, deployment, invitation or teardown commands below until the owner separately authorizes that action. Local validation/builds need no authorization. Read the [audit](pre-deployment-audit.md), [cost model](costs.md), and [secure CLI profile guide](aws-profile.md) first.

## Prerequisites and billing

- Node 24, AWS CLI v2, SAM CLI, an approved account and region `eu-central-1`.
- Permission to create the resources in `infra/template.yaml`, including IAM execution roles, Cognito, DynamoDB, SQS, API Gateway, Lambda, EventBridge, S3, CloudFront, logs, alarms and one AWS Budget.
- Billing visibility and an owner email. The template creates actual-spend notifications at $5, $15 and $30. These alerts are not spending caps and may arrive after costs accrue.
- Review current [AWS pricing](https://aws.amazon.com/pricing/) in the selected region, account concurrency quotas and CloudWatch retention. Some small accounts cannot allocate reserved concurrency until their account quota is raised. No NAT, VPC, RDS or load balancer is created.
- Keep registration invitation-only. The Cognito pool permits only administrator-created users.

The SAM template has seven-day log and history retention, daily event quotas, API throttling and low Lambda concurrency. The budget covers the account's costs, not just this stack. Operational alarms appear in CloudWatch; subscribe the configured email to the SNS topic and confirm its email before relying on notifications.

## First deployment (owner-approved)

Authenticate outside chat, then verify the account with `aws sts get-caller-identity`. Install SAM normally or use `uvx --from aws-sam-cli sam` in place of `sam`. Build and validate:

```sh
npm ci
npm run check
sam validate --lint --template-file infra/template.yaml --region eu-central-1
sam build --template-file infra/template.yaml
```

### Plan and review (only after separate authorization)

The checked-in `samconfig.toml` fixes the region to `eu-central-1`, enables `confirm_changeset`, and sets `no_execute_changeset=true`. The GitHub workflow is **plan-only**, requires an explicit owner-authorized input and `production` environment approval, and passes `--no-execute-changeset`. It cannot execute the stack or publish frontend files. Creating a change set can upload artifacts and create a CloudFormation stack in REVIEW_IN_PROGRESS; that is an AWS state change, so it has not been run during the audit.

After authorization, with an existing owner-approved artifact bucket and CloudFormation execution role, prepare a change set using the CLI (replace every placeholder locally):

```powershell
sam deploy --template-file .aws-sam/build/template.yaml --stack-name oathwire-beta --profile oathwire-dev --region eu-central-1 --s3-bucket YOUR_ARTIFACT_BUCKET --s3-prefix oathwire-beta --role-arn YOUR_CLOUDFORMATION_EXECUTION_ROLE_ARN --capabilities CAPABILITY_IAM --parameter-overrides 'WebOrigin=http://localhost:5173' 'AuthDomainPrefix=YOUR_UNIQUE_PREFIX' 'BudgetEmail=YOUR_EMAIL' --no-execute-changeset --confirm-changeset
aws cloudformation list-change-sets --stack-name oathwire-beta --profile oathwire-dev --region eu-central-1
aws cloudformation describe-change-set --change-set-name REVIEWED_CHANGE_SET_ARN --stack-name oathwire-beta --profile oathwire-dev --region eu-central-1 --include-property-values
```

Review the exact ARN, CREATE_COMPLETE status, account, region, template/commit, parameter values, expanded IAM policies, all additions/removals, replacements, encryption, retention, concurrency, budget email and data-loss implications. Approve that exact change set separately. Do not use a later `sam deploy` to regenerate a different plan and assume it was reviewed. **Only after explicit execution authorization**, execute the reviewed plan:

```powershell
aws cloudformation execute-change-set --change-set-name REVIEWED_CHANGE_SET_ARN --stack-name oathwire-beta --profile oathwire-dev --region eu-central-1
```

Use `aws cloudformation describe-stacks` to inspect completion and stack events on failure. Existing template resources do not include the deployment artifact bucket, OIDC provider or deployment/execution roles; bootstrap them only with separate owner approval and review. These prerequisites also require account-specific policies and cleanup.

For first creation, `WebOrigin=http://localhost:5173` is a temporary bootstrap callback, never the public callback. An application stack cannot know its generated CloudFront hostname before creation without adding more complexity.

Read `WebUrl`, `ApiUrl`, `AuthDomain`, `UserPoolId`, `UserClientId`, `FrontendBucket`, and `DistributionId` from the stack outputs. Update the stack a second time with **WebOrigin set to the exact WebUrl**, without a trailing slash. This avoids a circular dependency between Cognito callback configuration and the CloudFront distribution. Update the existing stack; do not create another one.

Copy `.env.example` into `.env` and set:

| Variable                                        | Value                                                         |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `AWS_REGION`                                    | `eu-central-1`                                                |
| `TABLE_NAME`, `SECRETS_TABLE_NAME`, `QUEUE_URL` | Stack resource IDs/queue URL; local API only                  |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`     | UserPoolId and UserClientId outputs                           |
| `WEB_ORIGIN`                                    | Actual browser origin for local API CORS                      |
| `VITE_API_URL`                                  | ApiUrl output                                                 |
| `VITE_COGNITO_DOMAIN`                           | AuthDomain output                                             |
| `VITE_COGNITO_CLIENT_ID`                        | UserClientId output                                           |
| `VITE_COGNITO_ISSUER`                           | `https://cognito-idp.eu-central-1.amazonaws.com/<UserPoolId>` |
| `VITE_REDIRECT_URI`                             | `<WebUrl>/callback`                                           |

Only `VITE_` values are bundled into the browser, and all listed ones are public identifiers. Never prefix secrets with `VITE_`. For localhost authentication, deliberately configure localhost callback/logout URLs in Cognito using an infrastructure change; do not weaken token verification. Lambda configuration is supplied by SAM, not the local `.env` file.

Build the frontend, upload assets before `index.html`, use immutable caching for hashed assets and no-cache for `index.html`, then invalidate `/`, `/index.html`, `/callback`. The separately authorized publication section below gives the exact commands. The S3 bucket stays private; CloudFront OAC has read access. HTTPS, CSP, HSTS and frame restrictions are configured at CloudFront. Confirm the SNS email subscription and configure Cognito's account email delivery appropriately for your invitation volume.

Invite a user using Cognito `admin-create-user` or the console, with a verified recovery email. Hosted UI handles temporary password change and account recovery. The SPA keeps tokens in tab session storage, signs in with PKCE, and asks for sign-in again on expiry; no custom password database or background refresh mechanism is implemented.

## GitHub OIDC and least privilege

The change-set workflow is manual, `main` only, and targets a GitHub environment named `production`. Configure required reviewers and restrict that environment to `main` before enabling it. CI is separate and has no AWS credentials. Restrict the OIDC planning role so it **cannot** call ExecuteChangeSet; use a separate owner-controlled identity for executing an approved plan.

The owner must provision a GitHub OIDC provider (`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and a deployment role. If a provider already exists, reuse it. Its trust condition must restrict:

```json
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:AugereAbove/oathwire:environment:production"
  }
}
```

Use a dedicated CloudFormation execution role and an artifact bucket rather than administrator access in the workflow. The deployment role needs:

- CloudFormation create/describe/list change sets only for `oathwire-beta`; restrict any unavoidable list/validate actions separately. Do not grant ExecuteChangeSet or stack deletion/update shortcuts to the planning role.
- `iam:PassRole` only for the dedicated CloudFormation execution role, conditioned on `cloudformation.amazonaws.com`.
- Read/write only the `oathwire-beta/` artifact prefix plus bucket location/list permissions as needed by SAM.
- No frontend publication permission is needed by the planning workflow. A separately authorized publishing identity would need S3 list/put only for the stack's frontend bucket and CloudFront invalidation only for its distribution.

The CloudFormation execution role needs the resource-management actions listed in prerequisites, scoped to this stack's resource names/ARNs where supported, including permission to create/pass only its Lambda roles. It is privileged and should have an owner-reviewed permissions boundary. An account-specific role policy cannot be honestly finalized without its account ID, artifact bucket, provider, and execution-role ARN. Do not substitute AdministratorAccess.

Set these **production environment variables**: `AWS_DEPLOY_ROLE_ARN` (planning role despite the historical variable name), `CF_EXECUTION_ROLE_ARN`, `ARTIFACT_BUCKET`, `WEB_ORIGIN`, `AUTH_DOMAIN_PREFIX`, `BUDGET_EMAIL`. Run the plan workflow only after owner authorization. It does not run automatically on pushes. No execute/publish workflow is enabled.

### Frontend publication (separate authorization)

After the reviewed infrastructure change set completes and Cognito's callback origin is updated through a second reviewed change set, build the frontend with the public Vite configuration above. The following owner-run commands upload files and invalidate CloudFront; they have not been run and require publication authorization:

```powershell
npm run build -w @oathwire/web
aws s3 sync apps/web/dist/ s3://YOUR_FRONTEND_BUCKET/ --exclude index.html --cache-control 'public,max-age=31536000,immutable' --profile oathwire-dev --region eu-central-1
aws s3 cp apps/web/dist/index.html s3://YOUR_FRONTEND_BUCKET/index.html --cache-control 'no-cache,no-store,must-revalidate' --profile oathwire-dev --region eu-central-1
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths /index.html / /callback --profile oathwire-dev --region eu-central-1
```

Public HTTP health checks only confirm liveness; run the full acceptance checklist below before calling the MVP complete.

## Live acceptance checklist

1. Load the public CloudFront URL. Sign in through Cognito, create Example Store, register a controlled public HTTPS receiver and save its one-time secret.
2. Start `examples/receiver.ts` behind a controlled public HTTPS tunnel with `OATHWIRE_SIGNING_SECRET` set. Run `node --env-file=.env --import tsx examples/receiver.ts` or set the environment variable through the shell. Do not log its value. Private/local URLs remain blocked by the worker.
3. Generate a publishing key. Publish `order.created`, verify a 202, receiver signature verification, and a delivered attempt in the dashboard.
4. Restart the receiver with `RECEIVER_STATUS=503`. Publish again. Observe retry state; restore it to 200 before the next attempt and verify eventual delivery.
5. Leave it at 503 through six attempts (roughly 24 minutes plus scheduling delays). Verify failed status and preserved attempt history. Restore 200 and replay. Verify a new delivery ID and success without altering the failed original.
6. Use a second invited account to verify foreign project/event/delivery reads and replay return 404. Revoke the publishing key and verify ingestion returns 401.
7. Inspect queue age, DLQ, logs and AWS costs. Record timestamps, URLs, resource region, exact outcomes and commit SHA in `verification.md` without credentials or payloads.

Only then consider the core MVP demonstrated. Public registration stays disabled until security/cost safeguards have been reviewed in the deployed environment. A bounded load test requires a separately approved request/spending budget; no load results are currently claimed.

## Troubleshooting and teardown

`/health` confirms API process liveness, not dependency health. Internal logs intentionally omit raw exceptions and payloads; use action categories and IDs, CloudWatch Lambda errors, queue age and DLQ alarms to locate failures. Retryable endpoint errors appear in attempt history rather than Lambda failure alarms. Investigate `OUTCOME_UNKNOWN` for crashes/timeouts around persistence. Persistent `reconciliation_item_failed` records require IAM/storage investigation; the next minute retries the durable record.

If frontend deployment fails after infrastructure succeeds, retain the working stack and retry publishing assets. Do not delete queues or tables to repair a failed frontend. Check Cognito callback origin and public Vite configuration after sign-in failures. Use stack events for deployment errors; never change permissions to wildcard administrator as a shortcut.

To remove a test deployment, first get owner approval, confirm the AWS account, region, and stack, export any needed history, and stop traffic. Empty only that stack's verified frontend bucket, then use `sam delete --stack-name oathwire-beta --region eu-central-1`. This deletes data, secrets, user accounts, queues and logs; there is no automatic recovery. Remove the separately created artifact bucket, OIDC roles and unused provider only after confirming no other project uses them. Check that Budgets, alarms, CloudFront, logs and buckets are gone and review the final bill.
