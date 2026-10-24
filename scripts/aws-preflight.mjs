import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assessConcurrency } from './concurrency-policy.mjs';

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    profile: { type: 'string' },
    'concurrency-mode': { type: 'string', default: 'reserved' },
    stack: { type: 'string', default: 'oathwire-beta' },
  },
});
if (!/^\d{12}$/.test(values.account ?? ''))
  throw new Error('--account must identify the approved account.');
if (!/^oathwire-[a-z0-9-]+$/.test(values.stack)) throw new Error('Invalid stack name.');
const region = 'eu-central-1';
const windowsAws = 'C:/Program Files/Amazon/AWSCLIV2/aws.exe';
const executable = process.platform === 'win32' && existsSync(windowsAws) ? windowsAws : 'aws';
function read(...args) {
  return JSON.parse(
    execFileSync(
      executable,
      [
        ...args,
        '--region',
        region,
        '--output',
        'json',
        '--no-cli-pager',
        ...(values.profile ? ['--profile', values.profile] : []),
      ],
      {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    ),
  );
}
const identity = read('sts', 'get-caller-identity');
if (identity.Account !== values.account || identity.Arn.endsWith(':root'))
  throw new Error('Account mismatch or root CLI identity; no further checks were run.');
const lambda = read('lambda', 'get-account-settings');
const functions = read('lambda', 'list-functions', '--query', 'Functions[].FunctionName');
const ownNames = [`${values.stack}-api`, `${values.stack}-worker`];
const foreignFunctions = functions.filter((name) => !ownNames.includes(name));
let ownReserved = 0;
for (const name of functions.filter((name) => ownNames.includes(name)))
  ownReserved +=
    read('lambda', 'get-function-concurrency', '--function-name', name)
      .ReservedConcurrentExecutions ?? 0;
const assessment = assessConcurrency({
  mode: values['concurrency-mode'],
  total: lambda.AccountLimit.ConcurrentExecutions,
  unreserved: lambda.AccountLimit.UnreservedConcurrentExecutions,
  ownReserved,
  foreignFunctions,
});
const quota = read(
  'service-quotas',
  'get-service-quota',
  '--service-code',
  'lambda',
  '--quota-code',
  'L-B99A9384',
).Quota;
const quotas = {};
for (const service of ['apigateway', 'cognito-idp', 'dynamodb', 'sqs'])
  quotas[service] = read('service-quotas', 'list-service-quotas', '--service-code', service).Quotas;
const stacks = read('cloudformation', 'list-stacks').StackSummaries.filter(
  (stack) => stack.StackStatus !== 'DELETE_COMPLETE',
);
mkdirSync('.local/deployment', { recursive: true });
writeFileSync(
  '.local/deployment/aws-preflight.json',
  JSON.stringify(
    {
      checkedAtUtc: new Date().toISOString(),
      region,
      identity,
      lambda,
      quota,
      functions,
      ownReserved,
      quotas,
      stacks,
      assessment,
      scope:
        'Read-only identity and quota checks; not proof of deployment permission or application correctness.',
    },
    null,
    2,
  ),
);
console.log(
  `Concurrency mode: ${assessment.mode}; live regional quota: ${quota.Value}; ${assessment.ready ? 'PASS' : 'BLOCKED'}`,
);
for (const blocker of assessment.blockers) console.error(blocker);
process.exitCode = assessment.ready ? 0 : 2;
