import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoStore } from '../../../packages/shared/src/store.js';
import { Service } from '../../../packages/shared/src/service.js';
import { Engine, sqsPublisher } from '../../worker/src/engine.js';
import { send } from '../../worker/src/http.js';
import { createApp } from './app.js';
export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error('Missing configuration: ' + name);
  return v;
}
export function runtime() {
  const store = new DynamoStore(required('TABLE_NAME'), required('SECRETS_TABLE_NAME'));
  const engine = new Engine(store, sqsPublisher(required('QUEUE_URL')), send);
  const verifier = CognitoJwtVerifier.create({
    userPoolId: required('COGNITO_USER_POOL_ID'),
    clientId: required('COGNITO_CLIENT_ID'),
    tokenUse: 'access',
  });
  const app = createApp(
    new Service(store),
    async (token) => (await verifier.verify(token)).sub,
    (id) => engine.enqueue(id),
    required('WEB_ORIGIN'),
  );
  return { app, engine };
}
