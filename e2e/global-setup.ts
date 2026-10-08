import { execSync } from 'node:child_process';

const DOCS = 'http://127.0.0.1:8080/v1/projects/demo-gear/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' }; // emulator-only admin access

async function count(path: string): Promise<number> {
  const res = await fetch(`${DOCS}/${path}?pageSize=1000`, { headers: OWNER });
  const json = (await res.json()) as { documents?: unknown[] };
  return json.documents?.length ?? 0;
}

/**
 * Wipes the Firestore emulator, re-seeds demo data, then waits for the
 * Cloud Functions it triggers (status history, notifications…) to finish so
 * tests don't race a busy emulator.
 */
export default async function globalSetup() {
  const res = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-gear/databases/(default)/documents', { method: 'DELETE' });
  if (!res.ok) throw new Error('Start the emulators first: npm run emulators');
  execSync('npx tsx scripts/seed.ts --demo', {
    stdio: 'inherit',
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  });
  const gear = await count('gear');
  const deadline = Date.now() + 120_000;
  let stable = 0;
  let last = -1;
  while (Date.now() < deadline) {
    // Every seeded item gets a status-history entry; the audit log settles last.
    const audit = await count('auditLog');
    const histories = await fetch(`${DOCS}:runQuery`, {
      method: 'POST',
      headers: { ...OWNER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'statusHistory', allDescendants: true }], limit: 1000 } }),
    }).then((r) => r.json() as Promise<{ document?: unknown }[]>);
    const done = histories.filter((h) => h.document).length >= gear;
    stable = done && audit === last ? stable + 1 : 0;
    last = audit;
    if (stable >= 3) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn('Emulator functions still busy after seeding; continuing anyway.');
}
