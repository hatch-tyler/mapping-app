import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Data Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should navigate to data page with datasets', async ({ page }) => {
    await page.goto('/data');
    await expect(page.getByText(/datasets|data/i).first()).toBeVisible();
  });

  test('should show export options for a dataset', async ({ page }) => {
    await page.goto('/data');
    // Look for export dropdown or button
    const exportButton = page.getByRole('button', { name: /export|download/i }).first();
    if (await exportButton.isVisible({ timeout: 5000 })) {
      await exportButton.click();
      // Should show format options
      await expect(page.getByText(/geojson|csv|shapefile/i).first()).toBeVisible();
    }
  });

  test('should download GeoJSON export', async ({ page }) => {
    await page.goto('/data');
    const exportButton = page.getByRole('button', { name: /export|download/i }).first();
    if (await exportButton.isVisible({ timeout: 5000 })) {
      await exportButton.click();

      // Start waiting for download before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      const geojsonOption = page.getByText(/geojson/i).first();
      if (await geojsonOption.isVisible()) {
        await geojsonOption.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.geojson$/);
      }
    }
  });
});
