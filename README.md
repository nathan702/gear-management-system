# Calleva Gear

Tracks Calleva's outdoor gear: what we own, where it is, how it's used, when it
was inspected and what's being repaired. It's a web app that installs on phones
from the browser, so staff can scan a gear label's QR code in the field — even
with no signal.

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Sign-in & roles, reference data, products, gear, QR codes & labels, photos, import/export, offline | **Built** |
| 2. Inspections | Form builder, inspections (offline), failure outcomes, overrides, time/usage schedules, who-inspects-what | **Built** |
| 3. Work orders | One open work order per gear from failed inspections (later failures added to it), issue reports, manual work orders, assignment rules, close → back to Active | **Built** |
| 4. Kits, lists, check-outs | Lists of products/categories, kits with dates and no double-booking, fill from list, scan to add, check-out/return with days used, single-item check-outs, usage logging | **Built** |
| 5. Notifications | Per-user email/Slack preferences, admin channel routing, reminders | Next |
| 6. Reporting | Usage, inspection completion, inventory, age, replacement budget forecast | |

## Stack

- **Web app** — React + TypeScript (Vite), Tailwind, installable PWA. Hosted on **Firebase Hosting**.
- **Database** — **Firestore** with persistent offline cache: gear can be looked up, edited and photographed offline; changes sync on reconnect.
- **Sign-in** — Firebase Auth: Google (calleva.org accounts join automatically as staff) and emailed sign-in links for invited personal addresses.
- **Photos** — Cloud Storage. Resized on the phone and queued in IndexedDB, so they work offline.
- **Server logic** — Cloud Functions (account activation, status history, audit log, account expiry, photo cleanup).
- **Security** — Firestore and Storage rules enforce roles, QR-code uniqueness and status-change reasons.

```
shared/      Types, constants, seed data and pure logic (lifecycle maths, QR codes, import/export) — used by web and functions
web/         The React app
functions/   Cloud Functions (bundled with esbuild, including shared/)
scripts/     seed.ts — starter reference data (+ demo data for the emulator)
tests/       Security-rule and Cloud Function tests (run against the emulators)
e2e/         Playwright browser tests (run against the emulators)
```

## Data model (Firestore collections)

| Collection | Notes |
|---|---|
| `users/{uid}` | name, email, role (`admin`/`manager`/`staff`/`technician`), active, `expiresAt`, phone, home program area. Created only by the `activateAccount` function. |
| `invites/{email}` | Pending invitations for non-calleva.org emails (role, optional access end date). |
| `programAreas`, `locations`, `categories`, `manufacturers` | Name, description, active. Locations can sit inside another location. |
| `products` | Manufacturer + model + variant (Model is merged into Product), category, lifetime (years), replacement cost, standards, PPE flag, document links; inspection schedules arrive in phase 2. |
| `gear` | name, product, program area, location, status, QR code, serial, tags, mfg/purchase/first-use dates, purchase value, supplier, custom end of life, notes, links, retired date/reason. Server-maintained: `inspectionState` (latest inspection per form) and `stats` (days used). |
| `gear/{id}/statusHistory` | Every status change with reason, source and who — written by a Cloud Function. |
| `qrCodes/{code}` | Reverse index `{ gearId }` that keeps codes unique; lookups work offline. |
| `photos` | Linked to gear, and optionally an inspection (and item) or, later, a work order. `uploaded` flips true once the image reaches Storage. |
| `inspectionForms` | Name, version (bumped on every save), items: prompt, help, type (pass/fail, number with OK range, text), **failure outcome** (*Note only* / *Has issues* / *Quarantine*), required. |
| `inspections` | Gear, form + version, date, inspector, every answer with the item's wording copied in, notes, calculated status, optional override + reason. Permanent once written. |
| `inspectionAssignments` | Who inspects gear by product, category, location or program area (most specific wins). |
| `workOrders` | Number (WO-0001, assigned by a function), gear, title, description, source (*inspection* / *issue* / *manual*), severity, status (Open → In progress / Waiting on parts → Done / Cancelled), priority, assignee, due date, linked inspections, resolution, cost, labor hours. |
| `workOrders/{id}/log` | Activity: creation, each inspection added, status / assignee / due changes (functions) and people's notes. |
| `workOrderRules` | Admin settings: match severity, program area, category and/or location → assignee, due in N days, priority. First match by order wins. |
| `lists` | Name, program area, lines (a product *or* any product in a category, with a quantity and notes). |
| `kits` | Name, owner, program area, optional start/end dates, source list, gear ids, status (Planned → Checked out → Returned). |
| `checkouts` | A single item checked out outside a kit: who, from, due back, returned. |
| `usageLogs` | Days (and optional uses) a piece of gear was actually used. Permanent; a function adds them to `gear.stats`, which drives usage-based inspection schedules. |
| `settings/app` | Org name, auto-join domains, QR link base URL, label template and printer offsets. |
| `auditLog` | Who changed which fields of which record, when. |

**Gear statuses:** Active · Has issues (usable, needs repair) · Quarantined (do not use) · Retired (permanent).
Any status change requires a reason, which is recorded in the history.

### Inspections

- Products list the forms their gear needs and how often: every N months and/or every N days used — whichever comes first — plus how many days ahead it shows as *due soon* (default 14). Never-inspected gear counts from its first-use date (else purchase date, else when it was added).
- Anyone can inspect, including offline. Submitting writes the inspection; the `applyInspection` Cloud Function then works out the result — the **worst failure outcome** among failed items (*Note only* failures count as Active), or the inspector's **override** (which needs a reason) — and applies it only if it is **worse** than the gear's current status. Inspections never clear a problem: only closing a work order returns gear to Active (phase 3). Retired gear isn't changed. A late-syncing older inspection still applies any problem it found but doesn't replace the newer inspection as the latest.
- *Inspections → Due* lists overdue and due-soon gear, filterable to *Assigned to me*. Reminders are sent in phase 5.
- Starter forms are built from the Gear Register's checklists (*Inspection forms → Add starter forms*, or `npm run seed`).

### Work orders and gear status

Gear status only gets worse through inspections and issue reports, and only gets better by closing work orders:

- **Failed inspections** — any failed item, including *Note only*, opens a work order. While that work order is open, later failed inspections of the same gear are added to it (raising its severity if needed) instead of opening another. Assignee, due date and priority come from the **assignment rules**.
- **Report issue** — anyone can report a problem from a gear page (with photos), choosing *Note only*, *Has issues* or *Quarantine*. It opens a work order (assigned by the rules) and flags the gear. Works offline.
- **Manual work orders** — managers can open any number per gear.
- **Closing** — the assignee or a manager completes a work order with what was done (plus cost and hours); managers can cancel. The gear then becomes the worst severity among its *other* open work orders, or **Active** when none remain. This is the only way gear returns to Active. Reopening a work order flags the gear again.
- Managers can still **retire** gear by hand; admins can set gear with no open work orders back to Active (e.g. to fix imported data).

### Kits, lists and usage

- **Lists** (managers) say what an activity needs: specific products or “any” of a category, with quantities.
- **Kits** are the actual gear someone takes. Anyone can build their own (optionally from a list, which then shows what's still missing and suggests available gear); admins can build them for others; everyone can see every kit. Gear can be in several kits only if their dates don't overlap — a kit without dates holds its gear until it's returned.
- Adding gear checks it: **retired gear and double-booking are never allowed**; **quarantined gear or gear with an overdue inspection** is blocked for everyone except admins, who get a warning and can add it anyway. Gear with issues or an inspection due soon shows a warning.
- **Check out / return** — checking a kit out flags anything not ready (and any product set to need an inspection *before each check-out* that hasn't had one today). Returning asks how many days each item was actually used.
- Single items can be **checked out** from their gear page too, and use outside kits can be **logged** directly. Days used feed the *every N days used* inspection schedules.

## Roles

| | Admin | Manager | Staff | Technician |
|---|:-:|:-:|:-:|:-:|
| View gear, products, scan, add photos, inspect (incl. override with reason), report issues, comment on work orders | ✓ | ✓ | ✓ | ✓ |
| Work through work orders assigned to them (start, waiting on parts, complete) | ✓ | ✓ | ✓ | ✓ |
| Build, check out, return and delete their own kits; check out single items; log usage | ✓ | ✓ | ✓ | ✓ |
| Create and edit lists | ✓ | ✓ | | |
| Manage other people's kits; add quarantined/overdue gear to kits (with a warning) | ✓ | | | |
| Create, edit, assign, cancel and reopen any work order; retire gear | ✓ | ✓ | | |
| Add/edit gear & products, change status, reference data, inspection forms & assignments, import/export | ✓ | ✓ | | |
| Users, invitations, settings, work order assignment rules, delete records, set gear back to Active directly | ✓ | | | |

Admins can delete inspection and work order records (the gear's status isn't rolled back). Technicians land on *Work orders → Assigned to me*, and their phone menu shows Work orders instead of Inspections.

## Local development

Requires Node 22 and Java 21 (for the Firebase emulators).

```bash
npm install
npm run emulators                 # terminal 1 — Auth, Firestore, Storage, Functions + UI at http://localhost:4000
npm run build -w functions        # once, and after changing functions/ (or: npm run watch -w functions)

# terminal 2 — load reference + demo data into the emulator
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed -- --demo

cp web/.env.example web/.env.local   # VITE_USE_EMULATORS=true
npm run dev                          # http://localhost:5173
```

With the emulators, the sign-in page shows a **demo user** picker (admin@, manager@, staff@, tech@calleva.org).
Emulator data is saved to `.emulator-data/` on exit.

### Tests

```bash
npm run typecheck
npm test                 # unit tests (shared logic: lifecycle, QR codes, import planning)
npm run test:emulator    # security rules + Cloud Functions, in throwaway emulators
npm run test:e2e         # browser tests; needs `npm run emulators` running (resets emulator data)
```

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

## Setting up the development Firebase project

1. In the [Firebase console](https://console.firebase.google.com) create a project (e.g. `calleva-gear-dev`) and upgrade it to the **Blaze** plan (needed for Cloud Functions; expected cost is a few dollars a month at most).
2. **Firestore** → create database in **nam5 (United States)**, production mode.
3. **Storage** → get started (same region).
4. **Authentication** → Sign-in method → enable **Google** and **Email/Password → Email link (passwordless sign-in)**. Add the hosting domain under *Authorized domains* if you use a custom domain.
5. **Project settings → Your apps** → add a Web app; copy its config into GitHub repository variables (below) or `web/.env.local` for a local build.
6. Create a deploy service account (IAM → Service accounts) with the *Firebase Admin* role (plus *Service Account User* and *Cloud Functions Admin*), download a JSON key, and save it as the GitHub secret `FIREBASE_SERVICE_ACCOUNT_DEV`.
7. GitHub → Settings → Secrets and variables → Actions → **Variables**: `FIREBASE_DEV_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.

Every push to `main` then deploys hosting, functions, rules and indexes (`.github/workflows/deploy-dev.yml`).
Load the starter reference data once:

```bash
GOOGLE_APPLICATION_CREDENTIALS=key.json GCLOUD_PROJECT=calleva-gear-dev npm run seed
```

**First sign-in:** the first person to sign in with a calleva.org Google account becomes an **admin**; everyone after that joins as staff, and admins can change roles under *Users*.

A separate production project (and a `production` branch/workflow) can be added later the same way.

## QR labels

- Each gear item gets a code like `CG-7KQ2MX` (no 0/O or 1/I/L). Labels encode `<site>/q/<code>`, so any phone camera opens the item — set the permanent address under **Settings → Label link address** before printing in bulk.
- **Avery sheets:** select gear on the Gear page → *Print labels*. Templates: 22805 (1½″ square, weatherproof), 22806 (2″ square), 22807 (2″ round), 5160 (address). Print at 100%. Use *Draw label outlines* on plain paper to check alignment and adjust the printer offsets in Settings.
- **Pre-printed durable tags:** scan a tag that isn't attached yet and choose *Add gear with this tag* or *Attach to existing gear*. Tags may encode any URL or text; the last URL segment or the text itself is used as the code.

## Import / export

*Manage → Import / export* exports any list (or everything as one Excel workbook) and imports CSV or Excel files with a preview before anything is written.
Rows with an `id` (from an export) update that record; others are matched by QR code (gear), manufacturer + model + variant (products), email (users) or name (everything else).
Only columns present in the file change, and blank cells clear optional fields. New users become invitations.

Inspection forms import/export one row per item (`form`, `prompt`, `type`, `failure_outcome`, `required`, `min`, `max`, `unit`, `help`); importing a form with an existing name saves a new version of it. The full inspection log, work orders, kits and the usage log export to CSV or Excel; lists import and export one row per line. All of them are included in the *Everything* workbook.
