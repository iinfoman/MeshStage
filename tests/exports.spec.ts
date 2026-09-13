import { expect, test } from '@playwright/test';
import {
  exportFormat,
  generateCharacter,
  goToExport,
  selectFormat,
  unlockAudio,
  watchForErrors,
} from './helpers';

/**
 * These assert on the in-page verification panel, which parses the bytes the
 * exporter actually produced. That makes them real format tests: a regression
 * in the skeleton bind, the morph targets or the video muxing fails here
 * rather than shipping a file that only looks right by its size.
 */
test.describe('export formats', () => {
  test.beforeEach(async ({ page }) => {
    await generateCharacter(page);
    await unlockAudio(page);
    await goToExport(page);
  });

  test('GLB carries a resolved skeleton and named viseme blendshapes', async ({ page }) => {
    const errors = watchForErrors(page);
    const report = await exportFormat(page, /\.GLB/);

    expect(report).toContain('Rigged asset verified');
    expect(report).toContain('13 joints');
    // The joint indices resolving is what proves the skeleton survived the
    // export clone — a broken one still produces a plausible-looking file.
    expect(report).not.toContain('INDICES BROKEN');
    expect(report).toContain('JOINTS_0 + WEIGHTS_0');
    expect(report).toContain('15 morph targets');
    expect(errors).toEqual([]);
  });

  test('GLB blendshapes are named for the ARKit viseme set', async ({ page }) => {
    await exportFormat(page, /\.GLB/);
    await page.getByText('Blendshape names').click();

    const names = await page.locator('pre').innerText();
    for (const viseme of ['viseme_sil', 'viseme_PP', 'viseme_aa', 'viseme_O', 'viseme_U']) {
      expect(names).toContain(viseme);
    }
  });

  test('the viseme timeline is monotonic and non-empty', async ({ page }) => {
    const report = await exportFormat(page, /Animation Timestamps/);

    expect(report).toContain('Timeline verified');
    expect(report).toContain('meshstage.viseme-timeline');
    expect(report).toMatch(/\d+ viseme keys/);
    expect(report).toContain('Monotonic yes');
  });

  test('USDZ is a valid package', async ({ page }) => {
    const report = await exportFormat(page, /Mobile AR/);

    expect(report).toContain('USDZ package verified');
    expect(report).toContain('zip (uncompressed)');
  });

  test('video records a real track from the live viewport', async ({ page }) => {
    const report = await exportFormat(page, /Video Output/);

    expect(report).toMatch(/Video (with audio )?verified/);
    expect(report).toContain('Video track present');

    // Playable inline — the panel is the proof, not the download.
    const video = page.locator('video');
    await expect(video).toBeVisible();
    expect(await video.evaluate((el: HTMLVideoElement) => el.src)).toMatch(/^blob:/);
  });

  test('video without the TTS service is silent, and says so', async ({ page }) => {
    // No VITE_MESHSTAGE_API in this build, so takes use device voices, whose
    // output cannot be routed into WebAudio and therefore cannot be recorded.
    const report = await exportFormat(page, /Video Output/);
    expect(report).toContain('none (device voice)');
  });

  test('exports consume a render credit only when metered', async ({ page }) => {
    await expect(page.getByText('3/10 renders left')).toBeVisible();

    await exportFormat(page, /\.GLB/);
    await expect(page.getByText('3/10 renders left')).toBeVisible();

    await exportFormat(page, /Video Output/);
    await expect(page.getByText('2/10 renders left')).toBeVisible();
  });

  test('the verification panel scrolls itself into view', async ({ page }) => {
    await selectFormat(page, /Animation Timestamps/);
    await page.getByRole('button', { name: /^Download/ }).click();

    const panel = page.getByLabel('Export verification');
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport();
  });
});
