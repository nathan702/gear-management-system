import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

const config = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }
  : {
      // "demo-" project ids only ever talk to the local emulators.
      apiKey: 'demo-key',
      authDomain: 'demo-gear.firebaseapp.com',
      projectId: 'demo-gear',
      storageBucket: 'demo-gear.appspot.com',
      appId: 'demo-app',
    };

export const app = initializeApp(config);
export const auth = getAuth(app);

// Firestore keeps a persistent cache in IndexedDB so gear can be looked up,
// edited and inspected with no signal; queued writes sync on reconnect.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

if (usingEmulators) {
  // Use the page's host so a phone on the same network can test against a laptop.
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}
