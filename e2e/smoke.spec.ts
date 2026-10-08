import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, who: 'admin' | 'manager' | 'staff' | 'tech') {
  await page.goto('/');
  await page.getByLabel('Demo user').selectOption(`${who}@calleva.org`);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

test('admin: browse, change status, photo, labels, QR lookup, import', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await shot(page, '01-login');

  await signIn(page, 'admin');
  await shot(page, '02-home');

  // Gear list + search
  await page.getByRole('link', { name: 'Gear', exact: true }).first().click();
  await page.getByLabel('Search gear').fill('raft');
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await shot(page, '03-gear-list');

  // Detail + status change (history is written by a Cloud Function)
  await page.getByRole('link', { name: 'Raft 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Raft 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByLabel(/Quarantined/).check();
  await page.getByLabel('Reason (required)').fill('Floor torn at stern');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Quarantined: Floor torn at stern')).toBeVisible();
  await expect(page.locator('ol').getByText('Floor torn at stern')).toBeVisible({ timeout: 15_000 });

  // Photo: queued locally, then uploaded to Storage
  await page.locator('input[type=file]').first().setInputFiles('web/public/icon-512.png');
  await expect(page.getByRole('heading', { name: 'Photos (1)' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[title="Waiting to upload"]')).toHaveCount(0, { timeout: 20_000 });
  await shot(page, '04-gear-detail');

  // Create several at once → labels
  await page.goto('/gear/new');
  await page.getByLabel('How many?').fill('3');
  await page.getByLabel('Base name').fill('Throw bag');
  await page.getByRole('button', { name: 'Add 3 items' }).click();
  await expect(page.getByRole('heading', { name: 'Print QR labels' })).toBeVisible();
  await expect(page.getByText('Throw bag 3')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await shot(page, '05-labels');

  // QR lookup: known code redirects, unknown offers to attach
  await page.goto('/gear?q=raft%202');
  const row = page.locator('tbody tr', { has: page.getByRole('link', { name: 'Raft 2', exact: true }) });
  const code = (await row.locator('.font-mono').first().textContent())!.trim();
  await page.goto(`/q/${code.toLowerCase()}`);
  await expect(page.getByRole('heading', { name: /Raft 2/ })).toBeVisible();
  await page.goto('/q/TAG-0042');
  await expect(page.getByText('This tag isn’t attached to any gear yet.')).toBeVisible();
  await page.getByPlaceholder('Search gear by name, code or serial…').fill('Raft 3');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByRole('heading', { name: /Raft 3/ })).toBeVisible();
  await expect(page.getByText('TAG-0042').first()).toBeVisible();
  await shot(page, '06-retagged');

  // Import: one new item, one update matched by QR code
  await page.goto('/admin/import-export');
  await page.getByLabel('Create missing program areas').check();
  const csv = `name,qr_code,location,status,purchase_date\nCanoe 1,,Boat shed,active,4/1/2024\n,TAG-0042,Fraser,,\n`;
  await page.locator('section', { hasText: 'What are you importing?' }).locator('input[type=file]').setInputFiles({ name: 'gear.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('1 new', { exact: true })).toBeVisible();
  await expect(page.getByText('1 updates')).toBeVisible();
  await expect(page.getByText(/Syncing changes/)).toHaveCount(0, { timeout: 10_000 });
  await shot(page, '07-import-preview');
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByText(/Imported: 1 new, 1 updated, 1 list entries created/)).toBeVisible();
  await page.goto('/gear?q=canoe');
  await expect(page.getByRole('cell', { name: 'Boat shed' })).toBeVisible();

  // Invite a seasonal staffer
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.getByLabel('Email addresses').fill('summer.counselor@gmail.com');
  await page.getByLabel('Access ends').fill('2027-08-20');
  await page.getByRole('button', { name: /^Invite 1/ }).click();
  await expect(page.getByText('summer.counselor@gmail.com ·', { exact: false })).toBeVisible();
  await shot(page, '08-users');
});

test('staff cannot manage gear', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/gear');
  await expect(page.getByRole('link', { name: 'Add gear' })).toHaveCount(0);
  await page.goto('/gear/new');
  await expect(page.getByText('Only managers and admins can open this page.')).toBeVisible();
});

test('mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'manager');
  await shot(page, '09-mobile-home');
  await page.getByRole('link', { name: 'Gear' }).last().click();
  await page.getByRole('link', { name: /Harness 1\b/ }).click();
  await expect(page.getByRole('heading', { name: /Harness 1/ })).toBeVisible();
  await shot(page, '10-mobile-detail');
});

test('works offline and syncs on reconnect', async ({ page, context }) => {
  await signIn(page, 'manager');
  await page.goto('/gear?q=kayak%201');
  await page.getByRole('link', { name: 'Kayak 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Kayak 1/ })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/Offline — changes are saved on this device/)).toBeVisible();
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByLabel(/Has issues/).check();
  await page.getByLabel('Reason (required)').fill('Small crack near skeg');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Has issues: Small crack near skeg')).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles('web/public/icon-192.png');
  await expect(page.getByRole('heading', { name: 'Photos (1)' })).toBeVisible();
  await expect(page.getByText(/1 photo waiting/)).toBeVisible();
  await shot(page, '11-offline');

  await context.setOffline(false);
  // History is written server-side once the change syncs; the photo uploads.
  await expect(page.locator('ol').getByText('Small crack near skeg')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[title="Waiting to upload"]')).toHaveCount(0, { timeout: 70_000 });
});
