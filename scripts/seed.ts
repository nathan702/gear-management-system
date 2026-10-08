/**
 * Loads starter reference data (program areas, locations, categories and
 * default settings). Safe to re-run: existing names are skipped.
 *
 *   Emulator:   npm run seed -- --demo        (adds demo gear + test users)
 *   Real project:
 *     GOOGLE_APPLICATION_CREDENTIALS=key.json GCLOUD_PROJECT=<id> npm run seed
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_SETTINGS,
  SEED_CATEGORIES,
  SEED_LOCATIONS,
  SEED_PROGRAM_AREAS,
  SEED_CHECKLISTS,
  DEFAULT_WORK_ORDER_RULES,
  addDays,
  addMonths,
  generateQrCode,
  starterForms,
  todayIso,
  type GearStatus,
} from '../shared/src/index';

const demo = process.argv.includes('--demo');
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? (emulator ? 'demo-gear' : undefined);
if (!projectId) {
  console.error('Set GCLOUD_PROJECT (and GOOGLE_APPLICATION_CREDENTIALS), or run against the emulator.');
  process.exit(1);
}
if (demo && !emulator) {
  console.error('--demo only runs against the emulator.');
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();
const SEED = 'seed';
const stamp = () => ({
  createdAt: FieldValue.serverTimestamp(),
  createdBy: SEED,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: SEED,
});

async function ensureNamed(db: Firestore, coll: string, names: string[], extra: Record<string, unknown> = {}) {
  const snap = await db.collection(coll).get();
  const ids = new Map(snap.docs.map((d) => [String(d.get('name')).toLowerCase(), d.id]));
  const batch = db.batch();
  let added = 0;
  for (const name of names) {
    if (ids.has(name.toLowerCase())) continue;
    const ref = db.collection(coll).doc();
    batch.set(ref, { name, description: '', active: true, ...extra, ...stamp() });
    ids.set(name.toLowerCase(), ref.id);
    added++;
  }
  await batch.commit();
  console.log(`${coll}: ${added} added, ${names.length - added} already present`);
  return (name: string) => ids.get(name.toLowerCase())!;
}

async function main() {
  const settingsRef = db.doc('settings/app');
  if (!(await settingsRef.get()).exists) {
    await settingsRef.set(DEFAULT_SETTINGS);
    console.log('settings: defaults written');
  }
  const program = await ensureNamed(db, 'programAreas', SEED_PROGRAM_AREAS);
  const location = await ensureNamed(db, 'locations', SEED_LOCATIONS);
  const category = await ensureNamed(db, 'categories', SEED_CATEGORIES);
  const forms = await ensureForms();
  await ensureRules();
  if (demo) await seedDemo(program, location, category, forms);
}

/** Starter work order rules (due dates by severity), if none exist. */
async function ensureRules() {
  const snap = await db.collection('workOrderRules').limit(1).get();
  if (!snap.empty) return console.log('workOrderRules: already present');
  const batch = db.batch();
  for (const r of DEFAULT_WORK_ORDER_RULES)
    batch.set(db.collection('workOrderRules').doc(), { ...r, programAreaId: null, categoryId: null, locationId: null, ...stamp() });
  await batch.commit();
  console.log(`workOrderRules: ${DEFAULT_WORK_ORDER_RULES.length} starter rules added`);
}

/** Starter inspection forms from the Gear Register's checklists, if none exist. */
async function ensureForms() {
  const snap = await db.collection('inspectionForms').get();
  const ids = new Map(snap.docs.map((d) => [String(d.get('name')), d.id]));
  if (snap.empty) {
    const batch = db.batch();
    for (const f of starterForms(SEED_CHECKLISTS)) {
      const ref = db.collection('inspectionForms').doc();
      batch.set(ref, { ...f, ...stamp() });
      ids.set(f.name, ref.id);
    }
    await batch.commit();
    console.log(`inspectionForms: ${ids.size} starter forms added`);
  } else console.log('inspectionForms: already present');
  return (name: string) => ids.get(`${name} inspection`);
}

async function seedDemo(
  program: (n: string) => string,
  location: (n: string) => string,
  category: (n: string) => string,
  form: (n: string) => string | undefined,
) {
  const auth = getAuth();
  const people = [
    { email: 'admin@calleva.org', displayName: 'Avery Admin', role: 'admin' },
    { email: 'manager@calleva.org', displayName: 'Morgan Manager', role: 'manager' },
    { email: 'staff@calleva.org', displayName: 'Sam Staff', role: 'staff' },
    { email: 'tech@calleva.org', displayName: 'Taylor Tech', role: 'technician' },
  ];
  for (const p of people) {
    const user = await auth.getUserByEmail(p.email).catch(() =>
      auth.createUser({ email: p.email, emailVerified: true, displayName: p.displayName, password: 'password' }),
    );
    await db.doc(`users/${user.uid}`).set({ ...p, active: true, expiresAt: null, homeProgramAreaId: null, ...stamp() }, { merge: true });
  }
  console.log('demo users: admin@ / manager@ / staff@ / tech@calleva.org (password "password")');

  if (!(await db.collection('gear').limit(1).get()).empty) {
    console.log('gear already present — skipping demo gear');
    return;
  }
  const maker = await ensureNamed(db, 'manufacturers', ['NRS', 'Petzl', 'Black Diamond', 'Astral', 'Jackson Kayak', 'Trek']);

  const products = [
    { key: 'raft', manufacturerId: maker('NRS'), model: 'Otter 130', variant: 'Blue', categoryId: category('Rafts'), lifetimeYears: 10, replacementCost: 5800 },
    { key: 'pfd', manufacturerId: maker('Astral'), model: 'V-Eight', variant: 'M/L', categoryId: category('PFDs'), lifetimeYears: 8, replacementCost: 140, standards: 'USCG Type III', isPpe: true },
    { key: 'helmet', manufacturerId: maker('Petzl'), model: 'Boreo', variant: 'Size 2', categoryId: category('Helmets'), lifetimeYears: 10, replacementCost: 70, standards: 'EN 12492', isPpe: true },
    { key: 'harness', manufacturerId: maker('Black Diamond'), model: 'Momentum', variant: 'M', categoryId: category('Harnesses'), lifetimeYears: 10, replacementCost: 65, standards: 'EN 12277', isPpe: true },
    { key: 'kayak', manufacturerId: maker('Jackson Kayak'), model: 'Zen 3.0', variant: 'Medium', categoryId: category('Kayaks'), lifetimeYears: 12, replacementCost: 1450 },
    { key: 'bike', manufacturerId: maker('Trek'), model: 'Marlin 5', variant: 'M', categoryId: category('Bikes'), lifetimeYears: 8, replacementCost: 700 },
  ];
  const scheduleFor: Record<string, [string, number, number | null]> = {
    raft: ['Inflatable', 12, 60],
    pfd: ['PFD', 12, null],
    helmet: ['Helmet', 12, null],
    harness: ['Textile', 12, null],
    kayak: ['Hull', 12, null],
    bike: ['Bike', 6, 40],
  };
  const productIds: Record<string, string> = {};
  const productForm: Record<string, string | undefined> = {};
  for (const { key, ...p } of products) {
    const ref = db.collection('products').doc();
    const [formName, months, days] = scheduleFor[key];
    const formId = form(formName);
    productForm[key] = formId;
    // Routine in-depth inspection by maintenance staff, plus a quick
    // in-service check by whoever is using it (daily for PPE, weekly otherwise).
    const preUse = form('Pre-use');
    const inService = ['pfd', 'helmet', 'harness'].includes(key) ? 1 : 7;
    const inspectionSchedules = [
      ...(formId ? [{ formId, kind: 'in_depth', everyMonths: months, everyDaysUsed: days, reminderLeadDays: 14, beforeEachCheckout: false }] : []),
      ...(preUse ? [{ formId: preUse, kind: 'in_service', everyDaysInUse: inService, beforeEachCheckout: false }] : []),
    ];
    await ref.set({ ...p, notes: '', links: [], inspectionSchedules, active: true, ...stamp() });
    productIds[key] = ref.id;
  }

  const fleet: [string, string, number, string, string, string][] = [
    // product, base name, count, program, location, purchase date
    ['raft', 'Raft', 6, 'River School', 'Riley\'s', '2019-04-15'],
    ['pfd', 'PFD', 12, 'River School', 'Riley\'s', '2021-05-01'],
    ['helmet', 'Helmet', 10, 'Climbing & Rope PPE', 'Farm', '2020-03-10'],
    ['harness', 'Harness', 8, 'Climbing & Rope PPE', 'Farm', '2017-06-01'],
    ['kayak', 'Kayak', 5, 'Camp', 'Fraser', '2022-02-20'],
    ['bike', 'Bike', 6, 'School Programs', 'Madeira', '2023-08-12'],
  ];
  const statuses: GearStatus[] = ['active', 'active', 'active', 'active', 'has_issues', 'active', 'quarantined', 'active'];
  const batch = db.batch();
  let n = 0;
  for (const [pk, base, count, prog, loc, bought] of fleet) {
    for (let i = 1; i <= count; i++) {
      const ref = db.collection('gear').doc();
      const qrCode = generateQrCode();
      const status = statuses[(n + i) % statuses.length];
      // Stagger last inspections 1–14 months ago so some are due or overdue.
      const formId = productForm[pk];
      const lastDate = addMonths(todayIso(), -(((n + i) * 5) % 14) - 1);
      batch.set(ref, {
        inspectionState: formId ? { [formId]: { lastDate, lastInspectionId: 'seed', failedCount: 0, daysUsedAtLast: 0 } } : {},
        stats: { daysUsed: ((n + i) * 7) % 50 },
        name: `${base} ${i}`,
        productId: productIds[pk],
        programAreaId: program(prog),
        locationId: location(loc),
        status,
        statusReason: status === 'active' ? 'Added to inventory' : status === 'has_issues' ? 'Minor abrasion noted' : 'Failed buckle — do not use',
        statusSource: 'created',
        qrCode,
        serialNumber: `${base.slice(0, 2).toUpperCase()}-${1000 + n + i}`,
        tags: [],
        mfgDate: null,
        purchaseDate: bought,
        firstUseDate: bought,
        purchaseValue: products.find((p) => p.key === pk)!.replacementCost,
        supplier: '',
        customEol: null,
        notes: '',
        links: [],
        ...stamp(),
      });
      batch.set(db.doc(`qrCodes/${qrCode}`), { gearId: ref.id });
    }
    n += count;
  }
  await batch.commit();
  console.log(`demo gear: ${n} items`);

  // Every demo item with a problem gets a matching open work order.
  const tech = (await auth.getUserByEmail('tech@calleva.org')).uid;
  const problems = await db.collection('gear').where('status', 'in', ['has_issues', 'quarantined']).get();
  const woBatch = db.batch();
  let number = 1;
  for (const g of problems.docs) {
    const quarantined = g.get('status') === 'quarantined';
    const ref = db.collection('workOrders').doc();
    woBatch.set(ref, {
      number: number++,
      gearId: g.id,
      productId: g.get('productId'),
      title: g.get('statusReason'),
      description: '',
      source: 'issue',
      severity: g.get('status'),
      status: 'open',
      priority: quarantined ? 'high' : 'normal',
      assigneeId: quarantined ? tech : null,
      dueDate: addDays(todayIso(), quarantined ? (number % 3 === 0 ? -2 : 5) : 25),
      ...stamp(),
    });
    woBatch.set(ref.collection('log').doc('created'), { type: 'created', text: `Issue reported: ${g.get('statusReason')}`, by: SEED, at: FieldValue.serverTimestamp() });
  }
  woBatch.set(db.doc('counters/workOrders'), { next: number });
  await woBatch.commit();
  console.log(`demo work orders: ${number - 1}`);

  // A list for a common trip, and a kit built from it.
  const staff = (await auth.getUserByEmail('staff@calleva.org')).uid;
  const listRef = db.collection('lists').doc();
  await listRef.set({
    name: 'Day raft trip — 6 guests',
    description: 'Two rafts plus PFDs and helmets for guests and guides.',
    programAreaId: program('River School'),
    lines: [
      { id: 'l1', productId: productIds.raft, categoryId: null, quantity: 2, notes: '' },
      { id: 'l2', productId: null, categoryId: category('PFDs'), quantity: 8, notes: 'Mixed sizes' },
      { id: 'l3', productId: productIds.helmet, categoryId: null, quantity: 8, notes: '' },
    ],
    active: true,
    ...stamp(),
  });
  const active = (await db.collection('gear').where('status', '==', 'active').get()).docs;
  const pick = (pid: string, n: number) => active.filter((d) => d.get('productId') === pid).slice(0, n).map((d) => d.id);
  await db.collection('kits').doc().set({
    name: 'River trip with Year 9',
    ownerId: staff,
    programAreaId: program('River School'),
    startDate: addDays(todayIso(), 3),
    endDate: addDays(todayIso(), 4),
    notes: '',
    listId: listRef.id,
    gearIds: [...pick(productIds.raft, 1), ...pick(productIds.pfd, 4)],
    status: 'planned',
    ...stamp(),
  });
  console.log('demo list and kit added');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
