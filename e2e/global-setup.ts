import { execSync } from 'node:child_process';

/** Wipes the Firestore emulator and re-seeds demo data so every run starts clean. */
export default async function globalSetup() {
  const res = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-gear/databases/(default)/documents', { method: 'DELETE' });
  if (!res.ok) throw new Error('Start the emulators first: npm run emulators');
  execSync('npx tsx scripts/seed.ts --demo', {
    stdio: 'inherit',
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  });
}
