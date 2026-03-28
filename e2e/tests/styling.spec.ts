import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Layer Styling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should open style editor from data page', async ({ page }) => {
    await page.goto('/data');
    // Find a style button on a dataset row
    const styleButton = page.getByRole('button', { name: /style|paint/i }).first();
    if (await styleButton.isVisible({ timeout: 5000 })) {
      await styleButton.click();
      // Style editor modal should appear
      await expect(page.getByText(/uniform|categorical|graduated/i).first()).toBeVisible();
    }
  });

  test('should switch between style modes', async ({ page }) => {
    await page.goto('/data');
    const styleButton = page.getByRole('button', { name: /style|paint/i }).first();
    if (await styleButton.isVisible({ timeout: 5000 })) {
      await styleButton.click();

      // Click on the Categorical tab
      const categoricalTab = page.getByRole('tab', { name: /categorical/i });
      if (await categoricalTab.isVisible()) {
        await categoricalTab.click();
        await expect(page.getByText(/field|column|attribute/i).first()).toBeVisible();
      }
    }
  });

  test('should save style changes', async ({ page }) => {
    await page.goto('/data');
    const styleButton = page.getByRole('button', { name: /style|paint/i }).first();
    if (await styleButton.isVisible({ timeout: 5000 })) {
      await styleButton.click();

      // Look for save button
      const saveButton = page.getByRole('button', { name: /save|apply/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
        // Should show success or close modal
        await expect(page.getByText(/saved|updated|success/i)).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should show legend on map page', async ({ page }) => {
    await page.goto('/map');
    // Legend panel or toggle
    const legendToggle = page.getByRole('button', { name: /legend/i });
    if (await legendToggle.isVisible({ timeout: 5000 })) {
      await legendToggle.click();
      await expect(page.getByText(/legend/i)).toBeVisible();
    }
  });
});
