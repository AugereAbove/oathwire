import { createServer } from 'node:http';
import { verify } from '../packages/shared/src/security.js';
const secret = process.env.OATHWIRE_SIGNING_SECRET;
if (!secret) throw new Error('Set OATHWIRE_SIGNING_SECRET.');
const seen = new Set<string>();
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/oathwire') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 18000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  const header = (key: string) =>
    typeof req.headers[key] === 'string' ? (req.headers[key] as string) : '';
  if (!verify(secret, header('x-oathwire-timestamp'), body, header('x-oathwire-signature'))) {
    res.writeHead(401).end();
    return;
  }
  // Restart with RECEIVER_STATUS=503 for controlled outage/retry demonstrations.
  const status = Number(process.env.RECEIVER_STATUS ?? 200);
  if (status !== 200) {
    res.writeHead(status).end();
    return;
  }
  const id = header('x-oathwire-delivery-id');
  if (!/^del_[a-f0-9-]{36}$/.test(id)) {
    res.writeHead(400).end();
    return;
  }
  if (!seen.has(id)) {
    if (seen.size >= 10000) seen.clear(); // Demo only. Use durable atomic deduplication in your application.
    seen.add(id);
    console.log(JSON.stringify({ action: 'verified_webhook', deliveryId: id }));
  }
  res.writeHead(200).end();
});
server.requestTimeout = 10000;
server.headersTimeout = 5000;
server.listen(4100, '127.0.0.1', () =>
  console.log(
    'Receiver listening on http://localhost:4100/webhooks/oathwire; expose through a controlled public HTTPS tunnel.',
  ),
);
