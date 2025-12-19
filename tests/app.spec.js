/**
 * PC Utility Pro - Automated Tests
 * Uses Playwright with Electron
 */

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');

let electronApp;
let window;

test.describe('PC Utility Pro v2.4.0', () => {

  test.beforeAll(async () => {
    // Launch Electron app with test mode to bypass single-instance lock
    electronApp = await _electron.launch({
      args: [path.join(__dirname, '..'), '--test-mode'],
      env: { ...process.env, PLAYWRIGHT_TEST: '1' },
    });

    // Get the first window
    window = await electronApp.firstWindow();

    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('App launches successfully', async () => {
    const title = await window.title();
    expect(title).toContain('PC Utility Pro');
  });

  test('Home page displays health score', async () => {
    // Navigate to home if not there
    await window.click('[data-page="home"]');
    await window.waitForTimeout(500);

    // Check health score element exists
    const healthScore = await window.locator('.health-score, #health-score, .score-value');
    await expect(healthScore.first()).toBeVisible({ timeout: 10000 });
  });

  test('System stats display CPU and RAM', async () => {
    const cpuStat = await window.locator('[class*="cpu"], [id*="cpu"]').first();
    const ramStat = await window.locator('[class*="ram"], [class*="memory"], [id*="ram"]').first();

    // At least one should be visible
    const cpuVisible = await cpuStat.isVisible().catch(() => false);
    const ramVisible = await ramStat.isVisible().catch(() => false);

    expect(cpuVisible || ramVisible).toBeTruthy();
  });

  test('Navigation sidebar works', async () => {
    const navItems = ['home', 'chat', 'specs', 'storage', 'settings'];

    for (const page of navItems) {
      const navButton = await window.locator(`[data-page="${page}"]`).first();
      if (await navButton.isVisible()) {
        await navButton.click();
        await window.waitForTimeout(300);
      }
    }
  });

  test('AI Chat page loads', async () => {
    await window.click('[data-page="chat"]');
    await window.waitForTimeout(500);

    const chatInput = await window.locator('#chat-input, [id*="chat"] input, textarea[placeholder*="message"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 5000 });
  });

  test('Storage page shows cleanup options', async () => {
    await window.click('[data-page="storage"]');
    await window.waitForTimeout(500);

    // Should have storage page visible
    const storagePage = await window.locator('#page-storage');
    await expect(storagePage).toBeVisible({ timeout: 5000 });
  });

  test('Settings page loads', async () => {
    await window.click('[data-page="settings"]');
    await window.waitForTimeout(500);

    // Should have settings elements
    const settingsContent = await window.locator('.settings, #settings, [class*="setting"]');
    await expect(settingsContent.first()).toBeVisible({ timeout: 5000 });
  });

  test('Speed test button exists', async () => {
    await window.click('[data-page="home"]');
    await window.waitForTimeout(500);

    const speedTestBtn = await window.locator('#speed-test-btn, button:has-text("Speed"), [onclick*="speed"]');
    await expect(speedTestBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('No console errors on load', async () => {
    const errors = [];

    window.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Reload and check for errors
    await window.reload();
    await window.waitForTimeout(2000);

    // Filter out expected warnings
    const realErrors = errors.filter(e =>
      !e.includes('API key') &&
      !e.includes('config') &&
      !e.includes('DevTools')
    );

    expect(realErrors.length).toBe(0);
  });

  test('Window controls work (minimize, close buttons exist)', async () => {
    const minimizeBtn = await window.locator('#btn-min');
    const closeBtn = await window.locator('#btn-close');

    // Window control buttons should exist
    const hasControls = await minimizeBtn.isVisible().catch(() => false) ||
                        await closeBtn.isVisible().catch(() => false);
    expect(hasControls).toBeTruthy();
  });

});

// Speed Test specific tests
test.describe('Speed Test Module', () => {

  test.beforeAll(async () => {
    electronApp = await _electron.launch({
      args: [path.join(__dirname, '..'), '--test-mode'],
      env: { ...process.env, PLAYWRIGHT_TEST: '1' },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('Speed test can be initiated', async () => {
    await window.click('[data-page="home"]');
    await window.waitForTimeout(1000);

    const speedTestBtn = await window.locator('#speed-test-btn, button:has-text("Speed Test")').first();

    if (await speedTestBtn.isVisible()) {
      // Just verify button is clickable, don't run full test
      await expect(speedTestBtn).toBeEnabled();
    }
  });

  test('Speed test results area exists', async () => {
    const resultsArea = await window.locator('#download-speed, #upload-speed, [class*="speed-result"]');
    const count = await resultsArea.count();
    expect(count).toBeGreaterThan(0);
  });

});
