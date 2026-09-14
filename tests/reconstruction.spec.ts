import { expect, test, type Page } from '@playwright/test';
import { buildGlbWithVisemes, writeFixtures } from './fixtures';
import { exportFormat, goToExport, unlockAudio, watchForErrors } from './helpers';

const fixtures = writeFixtures();

/**
 * The image-to-3D provider path, end to end, against a stubbed service.
 *
 * This exists because the path shipped dead once: `meshUrl` came back from the
 * provider and nothing ever loaded it, so a correctly configured deployment
 * would have shown an empty stage. Nothing in the suite noticed, because
 * without a key the app never took the branch at all. The stub removes the key
 * from the equation.
 */
const PROVIDER = 'https://provider.test';

async function stubProvider(
  page: Page,
  options: { rigged?: boolean; visemes?: string[]; failMesh?: boolean } = {},
) {
  const glb = buildGlbWithVisemes(options.visemes ?? ['viseme_AA', 'viseme_O']);
  let polls = 0;

  // The app reads its endpoint from localStorage before falling back to the
  // build-time variable, which the test build blanks.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ['meshstage:gen-endpoint', PROVIDER],
  );

  await page.route(`${PROVIDER}/generate`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'job_test', status: 'running', progress: 0.1 }),
    }),
  );

  await page.route(`${PROVIDER}/generate/*`, (route) => {
    polls += 1;
    // Answer "running" once, so the polling loop is genuinely exercised rather
    // than short-circuited on the first response.
    const done = polls > 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'job_test',
        status: done ? 'succeeded' : 'running',
        progress: done ? 1 : 0.5,
        ...(done ? { meshUrl: `${PROVIDER}/mesh.glb`, rigged: options.rigged ?? true } : {}),
      }),
    });
  });

  await page.route(`${PROVIDER}/mesh.glb`, (route) =>
    options.failMesh
      ? route.fulfill({ status: 502, body: 'upstream storage unavailable' })
      : route.fulfill({
          status: 200,
          contentType: 'model/gltf-binary',
          body: glb,
        }),
  );
}

async function generateViaProvider(page: Page) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixtures.face);
  await page.getByRole('button', { name: 'Generate 3D Character' }).click();
  await expect(page.getByRole('button', { name: 'Finalize & Continue to Export' })).toBeVisible({
    timeout: 60_000,
  });
  await unlockAudio(page);
}

/**
 * Locates the mesh in the rendered frame.
 *
 * Brightness alone is not enough to find it: the stage floor is a lit cyan
 * disc that reaches the bottom of the viewport, so a naive threshold reports
 * the subject as touching the edge no matter where the camera is. The mesh
 * carries no material in the fixture, so three renders it in default white —
 * near-achromatic, which the teal stage and blue vignette never are.
 */
async function subjectBounds(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);

    let top = -1;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < probe.height; y += 1) {
      let inRow = 0;
      for (let x = 0; x < probe.width; x += 1) {
        const i = (y * probe.width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (r + g + b > 240 && spread < 26) inRow += 1;
      }
      if (inRow > 3) {
        if (top < 0) top = y;
        bottom = y;
      }
      pixels += inRow;
    }
    return { top, bottom, pixels, height: probe.height };
  });
}

test.describe('image-to-3D reconstruction', () => {
  test('a provider mesh is what renders, not the procedural stand-in', async ({ page }) => {
    const errors = watchForErrors(page);
    await stubProvider(page);
    await generateViaProvider(page);

    // The status chips are the visible proof of which branch ran: the
    // procedural path reports triangle and bone counts, this one does not.
    const chips = page.getByRole('status').first();
    await expect(chips).toContainText('reconstructed');
    await expect(chips).not.toContainText('bones');

    await page.waitForTimeout(1500);
    const bounds = await subjectBounds(page);
    expect(bounds?.pixels ?? 0).toBeGreaterThan(2000);
    expect(errors).toEqual([]);
  });

  test('the camera frames the mesh once it lands, not the empty stage', async ({ page }) => {
    await stubProvider(page);
    await generateViaProvider(page);
    await page.waitForTimeout(1500);

    // The mesh downloads after the viewport mounts, so a fit that runs on the
    // first frame has nothing to measure. Two separate bugs put the subject
    // off the top of the screen here: the fit fell back to measuring the whole
    // scene (the stage floor kept its box non-empty, so it disarmed on that),
    // and it framed the subject's centre plane while the face nearest the
    // camera — half a depth closer, and larger for it — spilled past the edge.
    const bounds = await subjectBounds(page);
    expect(bounds).not.toBeNull();
    expect(bounds!.top).toBeGreaterThan(0);
    expect(bounds!.bottom).toBeLessThan(bounds!.height - 1);
  });

  test('blendshapes the provider left behind are found and driven', async ({ page }) => {
    await stubProvider(page, { visemes: ['viseme_AA', 'viseme_E', 'viseme_O'] });
    await generateViaProvider(page);

    await expect(page.getByRole('status').first()).toContainText('blendshapes found');
  });

  test('geometry with no blendshapes says so instead of faking lip-sync', async ({ page }) => {
    await stubProvider(page, { visemes: [] });
    await generateViaProvider(page);

    await expect(page.getByRole('status').first()).toContainText('geometry only');
    await expect(page.getByText(/no blendshapes, so lip-sync will not move/i)).toBeVisible();
  });

  test('a mesh that fails to download is reported, not left blank', async ({ page }) => {
    await stubProvider(page, { failMesh: true });
    await generateViaProvider(page);

    await expect(page.getByRole('alert')).toContainText(/could not load the reconstructed mesh/i);
  });

  test('exporting writes out the provider mesh, not the procedural rig', async ({ page }) => {
    await stubProvider(page);
    await generateViaProvider(page);
    await goToExport(page);

    // Verification parses the exported bytes, so this is an assertion about
    // the file, not about what the UI claims it wrote.
    const report = await exportFormat(page, /\.GLB/);

    // The two morph targets are the provider's, not the procedural rig's —
    // which would have carried 15. Verification reads them back out of the
    // exported bytes, so this is an assertion about the file.
    expect(report).toMatch(/2 morph targets/);
    // And it reports the gap honestly rather than claiming a rig: image-to-3D
    // geometry has no skeleton unless the provider also ran a rigging pass.
    expect(report).toMatch(/Skeleton none/);
  });

  test('a provider outage degrades to the local build instead of dead-ending', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['meshstage:gen-endpoint', PROVIDER],
    );
    await page.route(`${PROVIDER}/generate`, (route) => route.fulfill({ status: 503, body: '{}' }));

    await generateViaProvider(page);

    // Falls back to the procedural path, which reports its own counts.
    await expect(page.getByRole('status').first()).toContainText('bones');
  });
});
