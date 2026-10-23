import { mkdir, readFile, writeFile } from 'node:fs/promises';

const region = 'eu-central-1';
const selections = {
  lambdaGbSecond: ['AWSLambda', '6PPNGCBXY95TENXZ'],
  lambdaRequest: ['AWSLambda', 'UVYYDZQ83GKQ2K6C'],
  dynamoWrite: ['AmazonDynamoDB', '9G7XEGBNEMAXT6EE'],
  dynamoRead: ['AmazonDynamoDB', 'GA5XQXTMQJ8CBEU4'],
  dynamoStorage: ['AmazonDynamoDB', 'DC7NMEMXZPW6E4HE'],
  sqsRequest: ['AWSQueueService', 'ZSV7PSV36PVSDE32'],
  httpApiRequest: ['AmazonApiGateway', 'T5HBB5E3DWVQPUNF'],
  logGb: ['AmazonCloudWatch', 'XAE7GPNAZR6AWCQK'],
  logStorage: ['AmazonCloudWatch', '4V9YKJHUP3C55Q2R'],
  alarm: ['AmazonCloudWatch', 'VJ934U28PCG8EKRA'],
  customMetric: ['AmazonCloudWatch', '8CM49YJM6J2SHVD6'],
  s3Storage: ['AmazonS3', 'NRYRNCXF5TWHB476'],
  s3Put: ['AmazonS3', 'F5832W93RMW27RD7'],
  s3Get: ['AmazonS3', 'TUSXZSTYY6YJH244'],
  cognitoMau: ['AmazonCognito', '47JUGDNC5N3DZT85'],
  snsRequest: ['AmazonSNS', '3BKF6C2U97QDJ5YT'],
  snsEmail: ['AmazonSNS', 'AGSKKZHUG9QEQWYF'],
  cdnGb: ['AmazonCloudFront', 'VU3485RNDU6HBQF6'],
  cdnRequest: ['AmazonCloudFront', 'YA5QZD7XG45UGHCH'],
  outboundGb: ['AWSDataTransfer', 'F62Y6TKR8NC6Q2ZB'],
};
const offers = new Map();
const evidence = {};
const rates = {};
await mkdir('.local/pricing', { recursive: true });
for (const [name, [service, sku]] of Object.entries(selections)) {
  if (!offers.has(service)) {
    const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/${service === 'AmazonCloudFront' ? '' : region + '/'}index.json`;
    let offer;
    if (process.argv.includes('--cached'))
      offer = JSON.parse(await readFile(`.local/pricing/${service}.json`, 'utf8'));
    else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Price list unavailable: ${service}`);
      offer = await response.json();
      await writeFile(`.local/pricing/${service}.json`, JSON.stringify(offer));
    }
    offers.set(service, { offer, url });
  }
  const { offer, url } = offers.get(service);
  const dimensions = Object.values(offer.terms.OnDemand[sku] ?? {}).flatMap((t) =>
    Object.values(t.priceDimensions),
  );
  const rate = dimensions.find((d) => Number(d.pricePerUnit.USD) > 0);
  if (!rate)
    throw new Error(`Missing paid rate for ${name}; review AWS pricing before using the model.`);
  rates[name] = Number(rate.pricePerUnit.USD);
  evidence[name] = {
    usd: rates[name],
    unit: rate.unit,
    sku,
    description: rate.description,
    source: url,
    publicationDate: offer.publicationDate,
  };
}
const inputs = {
  idle: {
    events: 0,
    users: 0,
    apiRequests: 0,
    attempts: 0,
    schedules: 43200,
    pollRequests: 648000,
    lambdaGbSeconds: 1080,
    writes: 0,
    reads: 21600,
    dynamoGb: 0.001,
    logGb: 0.03,
    activeCustomMetrics: 0,
    cdnGb: 0,
    cdnRequests: 0,
    outboundGb: 0,
    s3Gb: 0.1,
    s3Put: 0,
    s3Get: 0,
    snsRequests: 0,
    snsEmails: 0,
  },
  beta: {
    events: 10000,
    users: 20,
    apiRequests: 12000,
    attempts: 22000,
    schedules: 43200,
    pollRequests: 648000,
    lambdaGbSeconds: 3055,
    writes: 1000000,
    reads: 1021600,
    dynamoGb: 0.1,
    logGb: 0.1,
    activeCustomMetrics: 1,
    cdnGb: 1,
    cdnRequests: 100000,
    outboundGb: 0.122,
    s3Gb: 0.1,
    s3Put: 1000,
    s3Get: 10000,
    snsRequests: 100,
    snsEmails: 20,
  },
  outage: {
    events: 10000,
    users: 20,
    apiRequests: 12000,
    attempts: 120000,
    schedules: 43200,
    pollRequests: 648000,
    lambdaGbSeconds: 151680,
    writes: 4000000,
    reads: 4021600,
    dynamoGb: 0.2,
    logGb: 0.5,
    activeCustomMetrics: 1,
    cdnGb: 1,
    cdnRequests: 100000,
    outboundGb: 0.3,
    s3Gb: 0.1,
    s3Put: 1000,
    s3Get: 10000,
    snsRequests: 1000,
    snsEmails: 100,
  },
};
const scenarios = {};
for (const [name, i] of Object.entries(inputs)) {
  const costs = {
    lambda:
      (i.apiRequests + i.attempts + i.schedules) * rates.lambdaRequest +
      i.lambdaGbSeconds * rates.lambdaGbSecond,
    dynamodb:
      i.writes * rates.dynamoWrite + i.reads * rates.dynamoRead + i.dynamoGb * rates.dynamoStorage,
    sqs: (i.pollRequests + i.attempts * 3) * rates.sqsRequest,
    apiGateway: i.apiRequests * rates.httpApiRequest,
    cloudwatch:
      i.logGb * rates.logGb +
      ((i.logGb * 7) / 30) * rates.logStorage +
      4 * rates.alarm +
      i.activeCustomMetrics * rates.customMetric,
    cognito: i.users * rates.cognitoMau,
    s3: i.s3Gb * rates.s3Storage + i.s3Put * rates.s3Put + i.s3Get * rates.s3Get,
    cloudfront: i.cdnGb * rates.cdnGb + i.cdnRequests * rates.cdnRequest,
    transfer: i.outboundGb * rates.outboundGb,
    sns: i.snsRequests * rates.snsRequest + i.snsEmails * rates.snsEmail,
  };
  scenarios[name] = { inputs: i, costs, totalUsd: Object.values(costs).reduce((a, b) => a + b, 0) };
}
const report = {
  asOf: new Date().toISOString().slice(0, 10),
  region,
  currency: 'USD',
  periodDays: 30,
  excludes: [
    'free allowances and credits',
    'VAT/taxes',
    'domains',
    'support plans',
    'CloudWatch queries',
    'CI overages',
    'external receiver/tunnel hosting',
    'unbounded abuse',
  ],
  assumptions: [
    'All durations, unit counts and traffic quantities are estimates, not measured throughput.',
    'Idle assumes 5 long pollers at one 20-second poll each; verify observed polling in AWS.',
    'Beta assumes 10,000 ~1-KiB events, two destinations, 10% one-extra-attempt retries, 20 MAUs.',
    'All table/index/transaction write amplification is included in the modeled request-unit totals.',
  ],
  rates: evidence,
  scenarios,
};
await writeFile('docs/cost-model.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(scenarios).map(([k, v]) => [k, { totalUsd: v.totalUsd, costs: v.costs }]),
    ),
    null,
    2,
  ),
);
