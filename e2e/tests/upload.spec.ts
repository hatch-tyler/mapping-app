import { test, expect } from '@playwright/test';
import path from 'path';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Data Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should navigate to upload/data manager page', async ({ page }) => {
    await page.goto('/upload');
    await expect(page.getByText(/upload|data manager/i).first()).toBeVisible();
  });

  test('should show upload form with file input', async ({ page }) => {
    await page.goto('/upload');
    // Should have a file input or drag-and-drop area
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
  });

  test('should reject unsupported file formats', async ({ page }) => {
    await page.goto('/upload');
    const fileInput = page.locator('input[type="file"]').first();

    // Create a dummy text file
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a geospatial file'),
    });

    // Should show an error or validation message
    await expect(page.getByText(/unsupported|invalid|format/i)).toBeVisible({ timeout: 5000 });
  });

  test('should upload a GeoJSON file', async ({ page }) => {
    await page.goto('/upload');
    const fileInput = page.locator('input[type="file"]').first();

    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
          properties: { name: 'San Francisco' },
        },
      ],
    });

    await fileInput.setInputFiles({
      name: 'test-upload.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(geojson),
    });

    // Wait for upload to complete or a success indicator
    await expect(page.getByText(/success|uploaded|complete/i)).toBeVisible({ timeout: 15000 });
  });
});
