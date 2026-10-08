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

test('people choose their notifications and can send themselves a test', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/me');
  await expect(page.getByText('Manager summary')).toHaveCount(0);
  const daily = page.getByLabel('Daily reminders by slack');
  await daily.check();
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await expect(page.getByText('Notification settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Daily reminders by slack')).toBeChecked();

  await page.getByRole('button', { name: 'Send me a test email' }).click();
  // No email server in the emulator, so it is logged as skipped with a reason.
  await expect(page.getByText(/skipped · email/)).toBeVisible({ timeout: 30_000 });
  await shot(page, 'p5-01-profile');
});

test('admins send today’s reminders and see the delivery log', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/admin/notifications');
  await expect(page.getByText('Email — not set up')).toBeVisible();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Name').last().fill('#gear-alerts');
  await page.getByLabel('Channel ID').fill('C0123ABCD');
  await page.getByLabel('Manager summary').check();
  await page.getByRole('button', { name: 'Save channels' }).click();
  await expect(page.getByRole('button', { name: 'Send a test here' })).toBeVisible();

  await page.getByRole('button', { name: 'Send today’s reminders now' }).click();
  await expect(page.getByText(/Reminders queued for \d+ people/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Gear summary: \d+ overdue inspections/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/to C0123ABCD/).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'p5-02-admin');
});
