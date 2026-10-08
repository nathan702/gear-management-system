import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, who: 'admin' | 'manager' | 'staff' | 'tech') {
  await page.goto('/');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut.or(page.getByLabel('Demo user'))).toBeVisible();
  if (await signOut.isVisible()) await signOut.click();
  await page.getByLabel('Demo user').selectOption(`${who}@calleva.org`);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 864e5));

test('staff build a kit from a list, check it out and return it with days used', async ({ page }) => {
  await signIn(page, 'staff');
  await expect(page.getByRole('heading', { name: 'My kits' })).toBeVisible();

  await page.goto('/lists');
  await page.getByRole('link', { name: /Day raft trip/ }).click();
  await shot(page, 'p4-01-list');
  await page.getByRole('link', { name: 'Build a kit from this list' }).click();
  await page.getByLabel('Name').fill('Raft trip — Friday');
  await page.getByLabel('Start date').fill(inDays(10));
  await page.getByLabel('End date').fill(inDays(10));
  await page.getByRole('button', { name: 'Create kit and add gear' }).click();
  await expect(page.getByRole('heading', { name: /Raft trip — Friday/ })).toBeVisible();

  await page.getByRole('button', { name: /^Add \d+ suggestions?$/ }).click();
  await expect(page.getByRole('heading', { name: /^Gear \((1[0-9]|[5-9])\)$/ })).toBeVisible();

  // Quarantined gear can't be added by staff.
  await page.getByLabel('Add gear').fill('Helmet 4');
  await expect(page.getByText(/Quarantined/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add/ }).last()).toBeDisabled();
  await page.getByLabel('Add gear').fill('');
  await shot(page, 'p4-02-kit');

  await page.getByRole('button', { name: 'Check out' }).click();
  await page.getByRole('button', { name: /^Check out( anyway)?$/ }).last().click();
  await expect(page.getByText('Checked out', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Return' }).click();
  await page.getByRole('button', { name: 'Set all to 0' }).click();
  const first = page.getByLabel(/^Days used for /).first();
  const firstName = (await first.getAttribute('aria-label'))!.replace('Days used for ', '');
  await first.fill('2');
  await page.getByRole('button', { name: 'Return and log usage' }).click();
  await expect(page.getByText('Returned', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: firstName, exact: true }).click();
  // Demo gear starts with some days already; the new log entry shows 2.
  await expect(page.locator('details li').first()).toContainText(/2 days/, { timeout: 15_000 });
});

test('gear can’t be double-booked across kits', async ({ page }) => {
  await signIn(page, 'staff');
  // The seeded "River trip with Year 9" kit holds a raft 3–4 days from now.
  await page.goto('/kits');
  await page.getByRole('link', { name: /River trip with Year 9/ }).click();
  const raft = (await page.locator('ul li a.font-medium', { hasText: 'Raft' }).first().textContent())!.trim();

  await page.goto('/kits/new');
  await page.getByLabel('Name').fill('Overlapping trip');
  await page.getByLabel('Start date').fill(inDays(4));
  await page.getByLabel('End date').fill(inDays(6));
  await page.getByRole('button', { name: 'Create kit and add gear' }).click();
  await page.getByLabel('Add gear').fill(raft);
  await expect(page.getByText(/In “River trip with Year 9”/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add/ }).last()).toBeDisabled();
  await shot(page, 'p4-03-conflict');
});

test('admins are warned but can add problem gear', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/kits/new');
  await page.getByLabel('Name').fill('Admin kit');
  await page.getByRole('button', { name: 'Create kit and add gear' }).click();
  await page.getByLabel('Add gear').fill('Helmet 4');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Gear (1)' })).toBeVisible();
});

test('check out and return a single item from its page', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/gear?q=kayak%204');
  await page.getByRole('link', { name: 'Kayak 4', exact: true }).click();
  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await page.getByRole('button', { name: /^Check out( anyway)?$/ }).last().click();
  await expect(page.getByText(/Checked out to Sam Staff/)).toBeVisible();
  await page.getByRole('button', { name: 'Return', exact: true }).click();
  await page.getByLabel('Days actually used').fill('1');
  await page.getByLabel(/Uses/).fill('3');
  await page.getByRole('button', { name: 'Return and log usage' }).click();
  await expect(page.getByText(/Checked out to/)).toHaveCount(0);
  await expect(page.getByText(/days used · 3 uses/)).toBeVisible({ timeout: 15_000 });
  await shot(page, 'p4-04-gear-usage');
});

test('managers create lists', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/lists/new');
  await page.getByLabel('Name').fill('Climbing session — 10 kids');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Qty').fill('10');
  await page.getByLabel('Type').selectOption('category');
  await page.locator('label:has(> span.label:text-is("Category")) select').selectOption({ label: 'Harnesses' });
  await page.getByRole('button', { name: 'Save list' }).click();
  await expect(page.getByText('Any Harnesses')).toBeVisible();
});
