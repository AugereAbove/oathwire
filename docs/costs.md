# Frankfurt cost model

As of 2026-10-23. USD per 30-day month, before taxes, credits and free allowances. This is a model, not a measured bill or spending cap. No AWS resources were created to obtain prices. Regional AWS public price list JSON was downloaded anonymously; the exact SKU, rate, source URL and publication date are retained in [cost model.json](cost-model.json).

| Scenario                                                        | Central estimate | Planning range |
| --------------------------------------------------------------- | ---------------: | -------------: |
| Idle deployment, no users/requests                              |      $0.71/month | $0.60 to $1.50 |
| Small beta                                                      |      $2.41/month |       $2 to $5 |
| Same beta with all destinations timing out through six attempts |      $7.57/month |      $8 to $15 |

The small beta assumes **20 monthly active users, 10,000 accepted ~1-KiB events/month, two matching destinations, 10% requiring one additional attempt, 12,000 total API requests, 100,000 CDN requests and 1 GB of CDN traffic**. It assumes 0.2-second API calls, 0.25-second attempts and 0.1-second reconciliation invocations, all at 256 MiB ARM. These durations are assumptions, not benchmarks. The outage scenario assumes 120,000 attempts taking five seconds each. Slow database calls, cold starts, large payloads or repeated infrastructure recovery increase costs.

| Component                               |   Idle |    Beta | Basis                                                                                                                  |
| --------------------------------------- | -----: | ------: | ---------------------------------------------------------------------------------------------------------------------- |
| Lambda                                  | $0.023 |  $0.056 | $0.20/million requests; $0.0000133334/GB-second ARM                                                                    |
| DynamoDB, including indexes             | $0.004 |  $0.949 | $0.7625/million WRUs; $0.1525/million RRUs; $0.306/GB-month                                                            |
| SQS                                     | $0.259 |  $0.286 | $0.40/million standard requests                                                                                        |
| HTTP API                                |     $0 |  $0.014 | $1.20/million requests in Frankfurt                                                                                    |
| CloudWatch                              | $0.419 |  $0.764 | Four $0.10 alarms; logs $0.63/GB ingested, $0.0324/GB-month stored; one active custom metric budgeted at $0.30 in beta |
| Cognito Lite                            |     $0 |  $0.110 | $0.0055/MAU list rate; eligible free allowance normally covers these 20 users                                          |
| S3 frontend + artifact storage/requests | $0.002 |  $0.012 | $0.0245/GB-month; $0.0054/1,000 PUT; $0.00043/1,000 GET                                                                |
| CloudFront, Europe                      |     $0 |  $0.205 | $0.085/GB out; $0.012/10,000 HTTPS requests                                                                            |
| Regional internet egress                |     $0 |  $0.011 | $0.09/GB modeled conservatively for API/worker output                                                                  |
| SNS operational email                   |     $0 | <$0.001 | Publish $0.50/million; email $2/100,000 after allowance                                                                |

Model details: 43,200 minute schedule invocations, at least 21,600 RRU of empty reconciliation queries, 648,000 idle long poll requests, three SQS operations per processed attempt, and seven day log retention. Lambda's maximum concurrency setting disables its two poller idle optimization, so the model allows five 20-second pollers. Actual managed polling must be checked after deployment. [AWS SQS scaling documentation](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html).

The beta reserves one million WRU and roughly one million RRU across **both tables and all indexes**, including transactions, enqueue state changes, claims, attempts, completion and dashboard reads. A transactional write is charged twice per item size unit; ALL projection indexes also charge for updates. Event storage can cross the next 1-KiB boundary after metadata is added. The request unit totals are an intentionally rounded workload estimate; use actual consumed capacity metrics to refine them later. [DynamoDB request metering](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html).

AWS Free Tier/always-free allowances and account credits can reduce these totals significantly, potentially near zero for a small beta, but eligibility and sharing across projects are unknown. Do not budget on receiving them. Cognito Lite/Essentials currently offer a 10,000-MAU free allowance for qualifying direct sign ins; legacy offers differ. CloudFront's eligible allowances include 1 TB and 10 million requests/month. Check the account's actual offer; no subscription to a paid flat rate CDN plan is configured. [Cognito pricing](https://aws.amazon.com/cognito/pricing/), [CloudFront pay as you go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).

## Costs that can surprise you

- **Idle is not zero.** Minute reconciliation, empty SQS receives, alarms and retained logs/storage continue without users. Reserved concurrency is a ceiling, not provisioned capacity, and itself has no fee.
- **Retries multiply delivery work.** Five destinations times six attempts means up to 30 HTTP attempts per accepted event. Maximum 16-KiB inputs and slow receivers cost more than this beta model.
- **Quotas do not cover all requests.** Invalid publishing credentials, management queries, repeated idempotent submissions, preflights and bot traffic still use Gateway/Lambda/logging. The per project daily quota only limits new accepted events. Replay can add five new delivery jobs per project/minute independently of ingestion quota.
- **DynamoDB indexes and transactions amplify units.** Maximum on demand throughput reduces bursts but is not a monthly budget. Just 100 WRU/second continuously is about **$197.64/month** at this region's write price, before indexes, reads or other services. The table and each index have their own ceilings; the application may reach lower limits first.
- **Dashboards are real queries.** Event summaries and stats each read up to 50 event related delivery pages. Repeated refreshes by authenticated users cost reads and can hit the ceilings. They use bounded samples, not unlimited scans.
- **The public frontend can be crawled.** CloudFront requests/egress and origin misses can grow independently of event quotas. Unknown routes return the SPA with a cache TTL of zero for origin errors.
- **Logs charge on ingestion.** Seven day retention reduces storage, not bytes already ingested. Lambda platform logs and repeated failure messages remain billable. Log Insights queries, extra dashboards or third party subscriptions are outside this estimate.
- **Old assets and artifacts accumulate.** Frontend publication does not delete old hashed assets, and SAM artifact uploads persist until deliberately cleaned. Add retention/lifecycle rules only after considering rollback needs.
- **Email and invalidation overages exist.** Repeated alarm transitions consume SNS requests/email deliveries; CloudFront charges $0.005 per invalidation path after 1,000/month. No SMS is configured. Cognito's default email delivery limits may require a separately reviewed SES setup as invitations grow.
- **Account wide bills include other projects.** The $5/$15/$30 Budget notifications cover the account and are delayed alerts, not hard blocks. AWS Support, domain registration, external receiver hosting, tunnels, taxes and GitHub Actions usage are excluded.

There are no customer managed KMS keys, NAT gateways, EC2 instances, RDS, load balancers, provisioned Lambda concurrency, dedicated SQS pollers, DAX, paid Cognito advanced security, Route 53 zones or custom TLS certificates in this template. DynamoDB uses AWS owned encryption; this avoids the KMS request charges of the earlier `SSEEnabled: true` selection. [AWS encryption setting reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-dynamodb-table-ssespecification.html).

AWS Budgets monitoring/email notifications are free; no action enabled budget or scheduled Budget Report is created. Native CloudFormation resource management has no separate template fee; the resources themselves are billed. [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/).

## Reproduce

Run `node scripts/estimate-costs.mjs` to fetch current public offers and regenerate the JSON, then `npx prettier --write docs/cost-model.json`. `--cached` reuses ignored `.local/pricing/` downloads. The script makes no authenticated AWS calls. Refresh the rates and review assumptions before deployment; if an SKU disappears, it stops rather than substituting a rate.
