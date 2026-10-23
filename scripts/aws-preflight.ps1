param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]{12}$')]
  [string]$AccountId,
  [string]$Profile = 'oathwire-dev',
  [ValidateSet('eu-central-1')]
  [string]$Region = 'eu-central-1'
)

# Read-only account checks. This script never requests quota changes or deploys resources.
$ErrorActionPreference = 'Stop'
$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
$awsExecutable = if ($awsCommand) { $awsCommand.Source } else { 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' }
if (-not (Test-Path -LiteralPath $awsExecutable)) { throw 'Install AWS CLI v2 first.' }

function Read-AwsJson {
  param([string[]]$Arguments)
  $rawResult = & $awsExecutable @Arguments --profile $Profile --region $Region --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw "Read-only AWS check failed: $($Arguments[0..1] -join ' ')" }
  return ($rawResult -join "`n" | ConvertFrom-Json)
}

$identity = Read-AwsJson @('sts', 'get-caller-identity')
if ($identity.Account -ne $AccountId) { throw 'Account mismatch; no further checks were run.' }
if ($identity.Arn -match ':root$') { throw 'Use a non-root temporary-credential profile.' }

$lambdaSettings = Read-AwsJson @('lambda', 'get-account-settings')
$lambdaQuota = Read-AwsJson @('service-quotas', 'get-service-quota', '--service-code', 'lambda', '--quota-code', 'L-B99A9384')
$apiQuotas = Read-AwsJson @('service-quotas', 'list-service-quotas', '--service-code', 'apigateway')
$cognitoQuotas = Read-AwsJson @('service-quotas', 'list-service-quotas', '--service-code', 'cognito-idp')
$dynamoQuotas = Read-AwsJson @('service-quotas', 'list-service-quotas', '--service-code', 'dynamodb')
$sqsQuotas = Read-AwsJson @('service-quotas', 'list-service-quotas', '--service-code', 'sqs')
$dynamoLimits = Read-AwsJson @('dynamodb', 'describe-limits')
$stacks = Read-AwsJson @('cloudformation', 'list-stacks')

$blockers = [System.Collections.Generic.List[string]]::new()
$requiredReserved = 6 # API 3 + worker 3; separate from provisioned concurrency.
$availableReserved = [math]::Max(0, [int]$lambdaSettings.AccountLimit.UnreservedConcurrentExecutions - 100)
if ($availableReserved -lt $requiredReserved) {
  $blockers.Add("Lambda has $availableReserved reservable executions; Oathwire requires $requiredReserved. With no other reservations, the regional quota must be at least 106. Preserve both per-function limits of 3.")
}

$report = [ordered]@{
  CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
  Identity = $identity
  Region = $Region
  Lambda = $lambdaSettings
  LambdaQuota = $lambdaQuota.Quota
  RequiredReservedExecutions = $requiredReserved
  AvailableReservedExecutions = $availableReserved
  ApiGatewayQuotas = $apiQuotas.Quotas
  CognitoQuotas = $cognitoQuotas.Quotas
  DynamoDbQuotas = $dynamoQuotas.Quotas
  SqsQuotas = $sqsQuotas.Quotas
  DynamoDbCapacityLimits = $dynamoLimits
  ExistingStacks = @($stacks.StackSummaries | Where-Object { $_.StackStatus -ne 'DELETE_COMPLETE' })
  Blockers = @($blockers)
  Scope = 'Account identity and quota checks only; does not establish deployment permissions, resource availability, billing access, or live application correctness.'
}
$reportDirectory = Join-Path $PSScriptRoot '../.local/deployment'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$reportPath = Join-Path $reportDirectory 'aws-preflight.json'
$report | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Output "Verified non-root account $AccountId in $Region. Report: $reportPath"
if ($blockers.Count) {
  $blockers | ForEach-Object { Write-Output "BLOCKED: $_" }
  exit 2
}
Write-Output 'Quota checks passed; deployment approval and permissions must still be reviewed.'
