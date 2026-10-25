import { afterEach, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

afterEach(() => vi.unstubAllEnvs());

it('handles API Gateway requests through a Node 24 async entry point', async () => {
  for (const [key, value] of Object.entries({
    TABLE_NAME: 'test-data',
    SECRETS_TABLE_NAME: 'test-secrets',
    QUEUE_URL: 'https://sqs.eu-central-1.amazonaws.com/000000000000/test',
    COGNITO_USER_POOL_ID: 'eu-central-1_TestPool',
    COGNITO_CLIENT_ID: 'test-client',
    WEB_ORIGIN: 'https://example.com',
  }))
    vi.stubEnv(key, value);
  const { handler } = await import('../apps/api/src/lambda.js');
  expect(handler.length).toBe(2);
  expect(handler.constructor.name).toBe('AsyncFunction');
  const event: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: 'GET /health',
    rawPath: '/health',
    rawQueryString: '',
    headers: { host: 'example.com' },
    requestContext: {
      accountId: '000000000000',
      apiId: 'test',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: {
        method: 'GET',
        path: '/health',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test',
      routeKey: 'GET /health',
      stage: '$default',
      time: '25/Oct/2026:10:00:00 +0000',
      timeEpoch: 1792922400000,
    },
    isBase64Encoded: false,
  };
  const response = handler(event, {} as Context);
  expect(response).toBeInstanceOf(Promise);
  expect(await response).toMatchObject({ statusCode: 200, body: '{"status":"ok"}' });
  const denied = await handler(
    {
      ...event,
      routeKey: 'GET /v1/projects',
      rawPath: '/v1/projects',
      requestContext: {
        ...event.requestContext,
        http: { ...event.requestContext.http, path: '/v1/projects' },
      },
    },
    {} as Context,
  );
  expect(denied).toMatchObject({ statusCode: 401 });
});
