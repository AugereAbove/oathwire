import { configure } from '@codegenie/serverless-express';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { runtime } from './runtime.js';
const proxy = configure({ app: runtime().app, resolutionMode: 'PROMISE' });
export async function handler(event: APIGatewayProxyEventV2, context: Context) {
  return proxy(event, context, () => {});
}
