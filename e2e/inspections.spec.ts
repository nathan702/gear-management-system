import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, who: 'admin' | 'manager' | 'staff') {
  await page.goto('/');
  await page.getByLabel('Demo user').selectOption(`${who}@calleva.org`);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

test('staff inspects a raft; a failed item quarantines it', async ({ page }) => {
  await signIn(page, 'staff');
  await shot(page, 'p2-01-home');

  await page.goto('/inspections');
  await expect(page.getByRole('button', { name: 'Due' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inspect' }).first()).toBeVisible();
  await shot(page, 'p2-02-due');

  await page.goto('/gear?q=raft%205');
  await page.getByRole('link', { name: 'Raft 5', exact: true }).click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: /Inflatable inspection/ }).click();

  // Submitting with nothing answered is blocked.
  await page.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(page.getByText(/required items? still need an answer/)).toBeVisible();

  await page.getByRole('button', { name: 'Pass all unanswered checks' }).click();
  const valves = page.locator('li', { hasText: 'Valves seat and seal' });
  await valves.getByRole('button', { name: 'Fail' }).click();
  await valves.getByPlaceholder('What did you find?').fill('Valve 2 leaks after 10 minutes');
  await expect(page.getByText('1 item failed')).toBeVisible();
  await shot(page, 'p2-03-inspect');
  await page.getByRole('button', { name: 'Submit inspection' }).click();

  await expect(page.getByRole('heading', { name: 'Inflatable inspection' })).toBeVisible();
  // The server applies the result.
  await expect(page.getByText('Active → Quarantined')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Valve 2 leaks after 10 minutes')).toBeVisible();
  await shot(page, 'p2-04-result');

  await page.getByRole('link', { name: 'Raft 5' }).first().click();
  await expect(page.getByText(/Quarantined: Inflatable inspection — quarantined: failed Valves seat and seal/)).toBeVisible();
  await expect(page.getByText('Inspections up to date')).toBeVisible();
  await shot(page, 'p2-05-gear');
});

test('override needs a reason', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/gear?q=pfd%203');
  await page.getByRole('link', { name: 'PFD 3', exact: true }).click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: /PFD inspection/ }).click();
  await page.getByRole('button', { name: 'Pass all unanswered checks' }).click();
  await page.locator('li', { hasText: 'Foam intact' }).getByRole('button', { name: 'Fail' }).click();
  await page.getByLabel('Override the result').check();
  await page.getByLabel('Result instead').selectOption('has_issues');
  await page.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(page.getByText('Give a reason for overriding the status.')).toBeVisible();
  await page.getByLabel('Reason (required)').fill('Minor compression, OK for flatwater');
  await page.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(page.getByText('Minor compression, OK for flatwater')).toBeVisible();
  await expect(page.getByText(/Has issues/).first()).toBeVisible();
});

test('manager edits a form and schedules it on a product', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/inspections/forms');
  await page.getByRole('link', { name: /Bike inspection/ }).click();
  await expect(page.getByText(/Version 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Add item' }).click();
  const last = page.locator('.card').filter({ has: page.getByLabel('Check') }).last();
  await last.getByLabel('Check').fill('Tire pressure');
  await last.getByLabel('Answer type').selectOption('number');
  await last.getByLabel('Minimum OK').fill('30');
  await last.getByLabel('Maximum OK').fill('50');
  await last.getByLabel('Unit').fill('psi');
  await shot(page, 'p2-06-form-editor');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText(/Version 2/)).toBeVisible();

  await page.goto('/products');
  await page.getByRole('link', { name: /Trek Marlin 5/ }).click();
  await expect(page.getByText(/every 6 months, or every 40 days used/)).toBeVisible();

  // The number item fails when out of range.
  await page.goto('/gear?q=bike%201');
  await page.getByRole('link', { name: 'Bike 1', exact: true }).click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: /Bike inspection/ }).click();
  await page.getByRole('textbox', { name: 'Tire pressure', exact: true }).fill('22');
  await expect(page.getByText('Out of range')).toBeVisible();
  await page.getByRole('textbox', { name: 'Tire pressure', exact: true }).fill('40');
  await expect(page.getByText('OK', { exact: true })).toBeVisible();
});

test('mobile inspection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'staff');
  await page.goto('/gear?q=helmet%201');
  await page.getByRole('link', { name: /Helmet 1\b/ }).first().click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: /Helmet inspection/ }).click();
  await page.locator('li', { hasText: 'Foam liner intact' }).getByRole('button', { name: 'Fail' }).click();
  await shot(page, 'p2-07-mobile-inspect');
});

test('in-service checks come due only while gear is in use, for whoever has it', async ({ page }) => {
  await signIn(page, 'staff');
  // Idle gear: the weekly in-service check isn't due.
  await page.goto('/gear?q=kayak%205');
  await page.getByRole('link', { name: 'Kayak 5', exact: true }).click();
  await expect(page.getByText(/weekly · not in use/)).toBeVisible();

  // Taking it out makes it due today, for this person.
  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await page.getByRole('button', { name: /^Check out( anyway)?$/ }).last().click();
  await expect(page.getByText(/weekly · due today/)).toBeVisible();
  await page.goto('/inspections?mine=1&kind=in_service');
  await expect(page.getByRole('link', { name: 'Kayak 5', exact: true })).toBeVisible();
  await shot(page, 'p2b-01-in-service-due');

  // Doing it clears it until next week.
  await page.goto('/gear?q=kayak%205');
  await page.getByRole('link', { name: 'Kayak 5', exact: true }).click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: /Pre-use inspection/ }).click();
  await page.getByRole('button', { name: 'Pass all unanswered checks' }).click();
  await page.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(page.getByText('No failures').or(page.getByText('Stayed'))).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Kayak 5' }).first().click();
  await expect(page.getByText(/weekly · next /)).toBeVisible({ timeout: 15_000 });
});
