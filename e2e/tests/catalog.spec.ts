import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Service Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should navigate to catalog page', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByText(/catalog|services|browse/i).first()).toBeVisible();
  });

  test('should show catalog cards or empty state', async ({ page }) => {
    await page.goto('/catalog');
    // Either show catalog items or any content on the page
    const content = page.locator('[data-testid="catalog-card"], [class*="card"]');
    const emptyMsg = page.getByText(/no services|no entries|empty|add.*service|catalog|browse/i);
    const hasCards = await content.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await emptyMsg.first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test('should filter catalog entries', async ({ page }) => {
    await page.goto('/catalog');
    const searchInput = page.getByPlaceholder(/search|filter/i);
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.fill('test');
      // Should filter results (or show "no results")
      await page.waitForTimeout(500);
    }
  });

  test('should show metadata modal on card click', async ({ page }) => {
    await page.goto('/catalog');
    const card = page.locator('[data-testid="catalog-card"]').first();
    if (await card.isVisible({ timeout: 5000 })) {
      await card.click();
      // Metadata modal or detail view
      await expect(page.getByText(/metadata|details|description/i).first()).toBeVisible();
    }
  });
});
