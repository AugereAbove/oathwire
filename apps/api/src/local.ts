import { runtime } from './runtime.js';
runtime().app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () =>
  console.log('Oathwire API listening on http://localhost:3000'),
);
