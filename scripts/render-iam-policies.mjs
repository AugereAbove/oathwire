import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { account: { type: 'string' } } });
if (!/^\d{12}$/.test(values.account ?? ''))
  throw new Error('Supply --account with the approved account ID.');
await mkdir('.local/deployment/policies', { recursive: true });
for (const file of await readdir('infra/policies')) {
  if (!file.endsWith('.json')) continue;
  const policy = (await readFile(`infra/policies/${file}`, 'utf8')).replaceAll(
    '${AccountId}',
    values.account,
  );
  if (policy.includes('${')) throw new Error('Unresolved policy placeholder.');
  JSON.parse(policy);
  await writeFile(`.local/deployment/policies/${file}`, policy);
}
console.log(
  'Rendered policies locally in ignored .local/deployment/policies; no IAM changes made.',
);
