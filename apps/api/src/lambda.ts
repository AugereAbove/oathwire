import { configure } from '@codegenie/serverless-express';
import { runtime } from './runtime.js';
export const handler = configure({ app: runtime().app });
