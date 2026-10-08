import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, who: 'admin' | 'manager' | 'staff') {
  await page.goto('/');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut.or(page.getByLabel('Demo user'))).toBeVisible();
  if (await signOut.isVisible()) await signOut.click();
  await page.getByLabel('Demo user').selectOption(`${who}@calleva.org`);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

test('managers get reports with filters, a replacement forecast and exports', async ({ page }) => {
  await signIn(page, 'manager');
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByText('Items in service')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'River School' })).toBeVisible();
  await shot(page, 'reports-inventory');

  // Filters carry across tabs and narrow every report.
  await page.getByLabel('Program area', { exact: true }).selectOption({ label: 'River School' });
  await expect(page.getByRole('cell', { name: 'Climbing' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Age & replacement' }).click();
  await expect(page).toHaveURL(/\/reports\/replacement\?.*program=/);
  await expect(page.getByText('Replacement budget forecast')).toBeVisible();
  await page.getByLabel('Period', { exact: true }).selectOption('quarter');
  await page.getByRole('img', { name: 'Replacement cost by period' }).locator('[tabindex="0"]').first().hover();
  await shot(page, 'reports-replacement');

  const download = page.waitForEvent('download');
  await page.locator('section', { hasText: 'Forecast by' }).getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^replacement-forecast-by-program-area-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByRole('button', { name: 'Inspections', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/inspections\?/);
  await expect(page.getByText('In-depth inspections current')).toBeVisible();
  await shot(page, 'reports-inspections');

  await page.getByRole('button', { name: 'Work orders', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/work-orders\?/);
  await expect(page.getByText('Work orders opened per month')).toBeVisible();
  await shot(page, 'reports-workorders');

  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/usage\?/);
  await page.getByLabel('Date range').selectOption('30d');
  await expect(page.getByText('Items used', { exact: true }).first()).toBeVisible();
  await shot(page, 'reports-usage');
});

test('staff do not see reports', async ({ page }) => {
  await signIn(page, 'staff');
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
});
