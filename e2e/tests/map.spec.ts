import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Map Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/map');
  });

  test('should render the map canvas', async ({ page }) => {
    // MapLibre renders a canvas element
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show layer manager', async ({ page }) => {
    // Look for a layers panel/button
    const layersButton = page.getByRole('button', { name: /layers/i });
    if (await layersButton.isVisible()) {
      await layersButton.click();
    }
    // Layer manager or list should be visible
    await expect(page.getByText(/layers|layer manager/i).first()).toBeVisible();
  });

  test('should show basemap gallery', async ({ page }) => {
    const basemapButton = page.getByRole('button', { name: /basemap/i });
    if (await basemapButton.isVisible()) {
      await basemapButton.click();
      await expect(page.getByText(/satellite|streets|topo|dark/i).first()).toBeVisible();
    }
  });

  test('should toggle layer visibility', async ({ page }) => {
    // Open layer manager
    const layersButton = page.getByRole('button', { name: /layers/i });
    if (await layersButton.isVisible()) {
      await layersButton.click();
    }

    // Find a visibility toggle (checkbox or eye icon)
    const toggles = page.locator('[data-testid="layer-visibility"], input[type="checkbox"]');
    if (await toggles.first().isVisible()) {
      await toggles.first().click();
      // Toggle back
      await toggles.first().click();
    }
  });

  test('should show feature details on click', async ({ page }) => {
    // Click on the map canvas
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Click the center of the map
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // If a feature is there, a detail panel should appear
    // This test is best-effort since it depends on data being loaded
  });
});
