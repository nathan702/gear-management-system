import type { AppSettings, FailureOutcome, GearStatus, Role } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
  technician: 'Repair technician',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including settings, users and other people’s kits.',
  manager: 'Manages gear, products and reference data; sees reports; assigns work orders.',
  staff: 'Builds their own kits, inspects gear and reports issues.',
  technician: 'Works on the repair orders assigned to them, plus everything staff can do.',
};

export const STATUS_LABELS: Record<GearStatus, string> = {
  active: 'Active',
  has_issues: 'Has issues',
  quarantined: 'Quarantined',
  retired: 'Retired',
};

export const STATUS_DESCRIPTIONS: Record<GearStatus, string> = {
  active: 'All good.',
  has_issues: 'Still usable, but needs repair eventually.',
  quarantined: 'Do not use until repaired.',
  retired: 'Permanently out of service.',
};

/** Higher number = worse. Used to pick the worst outcome of an inspection. */
export const STATUS_SEVERITY: Record<GearStatus, number> = {
  active: 0,
  has_issues: 1,
  quarantined: 2,
  retired: 3,
};

export const FAILURE_OUTCOME_LABELS: Record<FailureOutcome, string> = {
  note: 'Note only (stays Active)',
  has_issues: 'Has issues',
  quarantined: 'Quarantine',
};

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: 'Calleva',
  autoJoinDomains: ['calleva.org'],
  qrBaseUrl: '',
  labels: { templateId: 'avery-22805', offsetX: 0, offsetY: 0 },
};

/** Reference data loaded into a fresh project by `npm run seed`. */
export const SEED_PROGRAM_AREAS = [
  'River School',
  'Camp',
  'School Programs',
  'Climbing & Rope PPE',
  'Facilities',
  'Farm',
];

export const SEED_LOCATIONS = ['Farm', 'Fraser', 'Madeira', "Riley's"];

export const SEED_CATEGORIES = [
  'Harnesses',
  'Helmets',
  'Ropes',
  'Slings & anchors',
  'Lanyards',
  'Connectors',
  'Belay & descenders',
  'Pulleys & rescue',
  'Kayaks',
  'Canoes',
  'Rafts',
  'Duckies (inflatable kayaks)',
  'Packrafts',
  'Stand-up paddleboards',
  'Raft frames & oars',
  'Paddles',
  'PFDs',
  'Spray skirts',
  'Throw bags',
  'Wetsuits & drysuits',
  'River rescue kits',
  'Bikes',
  'E-bikes',
  'Vehicles & trailers',
  'Boat & bike trailers',
  'Outboard motors',
  'Power tools',
  'Farm machinery',
  'Tents & shelters',
  'Camp kitchen equipment',
  'Radios & communications',
  'First aid & AED',
  'Electronics & AV',
  'Other',
];

/**
 * Starter inspection checklists carried over from the Calleva Gear Register.
 * Seeded as inspection forms in phase 2.
 */
export const SEED_CHECKLISTS: Record<string, string[]> = {
  Textile: [
    'Markings and label legible',
    'No cuts, fraying or abrasion',
    'Stitching intact, no pulled threads',
    'No burns, chemical or UV damage',
    'Buckles and attachment points work',
    'Not overly stiff, dirty or wet-damaged',
  ],
  Metal: [
    'Markings legible',
    'No cracks, deformation or sharp edges',
    'No corrosion',
    'Gate opens and closes fully',
    'Locking mechanism works',
    'Rope-contact wear under 1 mm',
  ],
  Rope: [
    'Ends sealed and ID marking present',
    'Sheath free of cuts, glazing or core showing',
    'Core has no soft spots or lumps',
    'No chemical contamination',
    'Length check against record',
  ],
  Helmet: [
    'Shell free of cracks and deformation',
    'Foam liner intact',
    'Chinstrap and buckle work',
    'Headband adjusts and holds',
    'Markings legible',
  ],
  PFD: [
    'Fabric free of rips and fading',
    'Foam intact, not compressed',
    'Buckles, zips and straps work',
    'Size and rating label legible',
    'Fit and buoyancy check done',
  ],
  Hull: [
    'Hull free of cracks, holes or deep gouges',
    'Seat, footpegs and bulkheads secure',
    'Grab handles and deck lines sound',
    'Drain plug and hatches seal',
    'Buoyancy fitted where required',
  ],
  Inflatable: [
    'Tubes hold pressure overnight, no leaks',
    'Valves seat and seal',
    'Seams, patches and glued areas intact',
    'D-rings, handles and perimeter lines secure',
    'Floor, thwarts and self-bailer intact',
    'Fabric free of punctures and heavy abrasion',
  ],
  Bike: [
    'Frame and fork free of cracks or dents',
    'Brakes stop firmly, pads not worn',
    'Wheels true, spokes tight',
    'Tires in good condition at correct pressure',
    'Chain and drivetrain shift and run clean',
    'Headset, stem, bars and seatpost bolts tight',
    'Quick releases and thru-axles secure',
  ],
  Paddle: ['Shaft straight, no cracks', 'Blade edges intact', 'Joints and ferrules lock', 'Grips secure'],
  General: [
    'Physically intact, no damage',
    'Operates correctly',
    'Guards and safety features present',
    'Cords, hoses and fuel lines sound',
    'Service record current',
  ],
};
