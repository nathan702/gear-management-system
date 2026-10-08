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

async function failInspection(page: Page, gear: string, form: RegExp, item: string, comment: string) {
  await page.goto(`/gear?q=${encodeURIComponent(gear)}`);
  await page.getByRole('link', { name: gear, exact: true }).click();
  await page.getByRole('link', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: form }).click();
  await page.getByRole('button', { name: 'Pass all unanswered checks' }).click();
  const li = page.locator('li', { hasText: item });
  await li.getByRole('button', { name: 'Fail' }).click();
  await li.getByPlaceholder('What did you find?').fill(comment);
  await page.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(page.getByRole('link', { name: 'Repair work order' })).toBeVisible({ timeout: 15_000 });
}

test('failed inspections share one work order; closing it returns the gear to Active', async ({ page }) => {
  await signIn(page, 'staff');
  await failInspection(page, 'Raft 2', /Inflatable inspection/, 'Valves seat and seal', 'Valve 1 hisses');
  await page.getByRole('link', { name: 'Repair work order' }).click();
  await expect(page.getByRole('heading', { name: /Failed Inflatable inspection/ })).toBeVisible();
  const number = (await page.locator('h1 .font-mono').textContent())!.trim();
  expect(number).toMatch(/^WO-\d{4}$/);

  // A second failure is added to the same work order.
  await failInspection(page, 'Raft 2', /Inflatable inspection/, 'D-rings, handles', 'Handle torn');
  await page.getByRole('link', { name: 'Repair work order' }).click();
  await expect(page.locator('h1 .font-mono')).toHaveText(number);
  await expect(page.getByText('Handle torn')).toBeVisible();

  // Manager assigns it to the technician.
  await signIn(page, 'manager');
  await page.goto('/work-orders');
  await page.getByRole('link', { name: new RegExp(number) }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Assigned to').selectOption({ label: 'Taylor Tech' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Assigned to Taylor Tech')).toBeVisible({ timeout: 15_000 });

  // Technician works it through to done.
  await signIn(page, 'tech');
  await page.goto('/work-orders');
  await expect(page.getByRole('button', { name: /Assigned to me/ })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(number) }).click();
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.getByText('Open → In progress')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Comment').fill('Ordered a Leafield valve');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Ordered a Leafield valve')).toBeVisible();
  await shot(page, 'p3-01-work-order');
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText(/goes from/)).toContainText('Active');
  await page.getByLabel('What was done? (required)').fill('Replaced valve and handle, pressure tested');
  await page.getByLabel('Cost (USD)').fill('85');
  await page.getByRole('button', { name: 'Complete', exact: true }).last().click();
  await expect(page.getByText(/In progress → Done — Replaced valve/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Raft 2' }).first().click();
  await expect(page.getByRole('heading', { name: /Raft 2/ })).toContainText('Active');
  await shot(page, 'p3-02-gear');
});

test('staff report an issue; managers see it in the list', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/gear?q=pfd%201');
  await page.getByRole('link', { name: 'PFD 1', exact: true }).click();
  await page.getByRole('button', { name: 'Report issue' }).click();
  await page.getByLabel('What’s wrong?').fill('Torn shoulder strap');
  await page.getByLabel(/Quarantine/).check();
  await shot(page, 'p3-03-report-issue');
  await page.getByRole('button', { name: 'Report issue' }).last().click();
  await expect(page.getByText(/^WO-\d{4}$/)).toBeVisible({ timeout: 15_000 });
  // Staff can't edit or complete someone else's work order.
  await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0);
  await page.getByRole('link', { name: 'PFD 1' }).first().click();
  await expect(page.getByText(/Quarantined: WO-\d{4} issue reported: Torn shoulder strap/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change status' })).toHaveCount(0);

  await signIn(page, 'manager');
  await page.goto('/work-orders');
  await expect(page.getByRole('link', { name: /Torn shoulder strap/ })).toBeVisible();
  await shot(page, 'p3-04-list');
  // Managers can't set gear back to Active by hand.
  await page.goto('/gear?q=pfd%201');
  await page.getByRole('link', { name: 'PFD 1', exact: true }).click();
  await page.getByRole('button', { name: 'Change status' }).click();
  await expect(page.getByLabel(/Retired/)).toBeVisible();
  await expect(page.getByLabel(/^Active/)).toHaveCount(0);
});

test('admin edits assignment rules', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/work-orders/rules');
  await expect(page.getByText('Quarantined gear')).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Name').fill('River School repairs');
  await page.getByLabel('Program area').selectOption({ label: 'River School' });
  await page.getByLabel('Assign to').selectOption({ label: 'Taylor Tech' });
  await page.getByLabel('Due in (days)').fill('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('River School repairs')).toBeVisible();
  const row = () => page.locator('ol li', { hasText: 'River School repairs' });
  for (let i = 3; i > 0; i--) {
    await row().getByRole('button', { name: 'Move up' }).click();
    await expect(page.locator('ol li').nth(i - 1)).toContainText('River School repairs');
  }
  await shot(page, 'p3-05-rules');
});
