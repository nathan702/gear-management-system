import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import {
  DEFAULT_SETTINGS,
  productName,
  type AppSettings,
  type Category,
  type Gear,
  type InspectionAssignment,
  type InspectionForm,
  type Location,
  type Manufacturer,
  type Product,
  type ProgramArea,
  type UserProfile,
  type WithId,
} from '@gear/shared';
import { db } from '../firebase';

/**
 * With ~500 gear items and ~50 users, the app keeps every reference
 * collection and all gear in memory (and in Firestore's offline cache).
 * Lookups, search and reports are then instant and work without signal.
 */
export interface Data {
  loaded: boolean;
  programAreas: Map<string, ProgramArea & WithId>;
  locations: Map<string, Location & WithId>;
  categories: Map<string, Category & WithId>;
  manufacturers: Map<string, Manufacturer & WithId>;
  products: Map<string, Product & WithId>;
  gear: Map<string, Gear & WithId>;
  users: Map<string, UserProfile & WithId>;
  inspectionForms: Map<string, InspectionForm & WithId>;
  inspectionAssignments: (InspectionAssignment & WithId)[];
  settings: AppSettings;
  productLabel(id: string | null | undefined): string;
  /** True while there are writes made offline that haven't reached the server. */
  pendingWrites: boolean;
}

const DataContext = createContext<Data | null>(null);

const COLLECTIONS = [
  'programAreas',
  'locations',
  'categories',
  'manufacturers',
  'products',
  'gear',
  'users',
  'inspectionForms',
  'inspectionAssignments',
] as const;
type CollectionKey = (typeof COLLECTIONS)[number];

export function DataProvider({ children }: { children: ReactNode }) {
  const [maps, setMaps] = useState<Partial<Record<CollectionKey, Map<string, WithId>>>>({});
  const [pending, setPending] = useState<Partial<Record<CollectionKey, boolean>>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const unsubs = COLLECTIONS.map((key) =>
      onSnapshot(
        collection(db, key),
        { includeMetadataChanges: true },
        (snap) => {
          setMaps((m) => ({ ...m, [key]: new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }])) }));
          setPending((p) => (p[key] === snap.metadata.hasPendingWrites ? p : { ...p, [key]: snap.metadata.hasPendingWrites }));
        },
        (err) => console.warn(`listen ${key}`, err),
      ),
    );
    unsubs.push(
      onSnapshot(doc(db, 'settings', 'app'), (snap) =>
        setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings> | undefined) }),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const value = useMemo<Data>(() => {
    const get = <T,>(k: CollectionKey) => (maps[k] ?? new Map()) as Map<string, T & WithId>;
    const manufacturers = get<Manufacturer>('manufacturers');
    const products = get<Product>('products');
    return {
      loaded: COLLECTIONS.every((k) => maps[k]),
      programAreas: get<ProgramArea>('programAreas'),
      locations: get<Location>('locations'),
      categories: get<Category>('categories'),
      manufacturers,
      products,
      gear: get<Gear>('gear'),
      users: get<UserProfile>('users'),
      inspectionForms: get<InspectionForm>('inspectionForms'),
      inspectionAssignments: [...get<InspectionAssignment>('inspectionAssignments').values()],
      settings,
      productLabel: (id) => (id ? productName(products.get(id), manufacturers) || 'Unknown product' : ''),
      pendingWrites: Object.values(pending).some(Boolean),
    };
  }, [maps, pending, settings]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Natural sort so "Raft 2" comes before "Raft 10". */
export const byName = <T extends { name?: string }>(a: T, b: T) => collator.compare(a.name ?? '', b.name ?? '');
export const compareText = (a: string, b: string) => collator.compare(a, b);

export function sortedValues<T extends { name?: string }>(map: Map<string, T>, includeInactive = false): T[] {
  return [...map.values()]
    .filter((v) => includeInactive || (v as { active?: boolean }).active !== false)
    .sort(byName);
}
