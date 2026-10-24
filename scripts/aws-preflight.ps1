param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]{12}$')]
  [string]$AccountId,
  [string]$Profile = 'oathwire-dev',
  [ValidateSet('eu-central-1')]
  [string]$Region = 'eu-central-1',
  [ValidateSet('reserved', 'shared-beta')]
  [string]$ConcurrencyMode = 'reserved'
)
# The same read-only implementation runs locally and in the plan workflow.
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  & node scripts/aws-preflight.mjs --account $AccountId --profile $Profile --concurrency-mode $ConcurrencyMode
  $preflightExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $preflightExitCode
