/**
 * Image-to-3D reconstruction, fronting a third-party provider.
 *
 * Every provider in this space follows the same shape — submit an image, poll
 * a job, collect a mesh URL — so the client speaks one protocol and this
 * module translates. Set MESHSTAGE_RECONSTRUCT_PROVIDER and the matching key:
 *
 *   meshy  MESHY_API_KEY   https://docs.meshy.ai   (image-to-3d, has rigging)
 *   tripo  TRIPO_API_KEY   https://platform.tripo3d.ai
 *   fal    FAL_API_KEY     https://fal.ai  (TripoSR / Hunyuan3D endpoints)
 *
 * These cost money per generation. Nothing here runs unless a key is set.
 */

const PROVIDER = process.env.MESHSTAGE_RECONSTRUCT_PROVIDER ?? '';

/** In-memory job index. Swap for your datastore when you run more than one instance. */
const jobs = new Map();

export function isConfigured() {
  return Boolean(PROVIDER && keyFor(PROVIDER));
}

function keyFor(provider) {
  return {
    meshy: process.env.MESHY_API_KEY,
    tripo: process.env.TRIPO_API_KEY,
    fal: process.env.FAL_API_KEY,
  }[provider];
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl ?? '');
  if (!match) throw new Error('Expected a base64 image data URL');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

/**
 * Starts a reconstruction. Returns a job the client polls.
 *
 * The upstream call is fired without awaiting completion: these jobs run for
 * tens of seconds to minutes, far longer than a request should be held open.
 */
export async function submit({ image }) {
  if (!isConfigured()) {
    throw new Error(
      'No reconstruction provider configured. Set MESHSTAGE_RECONSTRUCT_PROVIDER and its API key.',
    );
  }

  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, status: 'queued', progress: 0 };
  jobs.set(id, job);

  void runJob(job, image).catch((error) => {
    job.status = 'failed';
    job.error = error.message;
  });

  return job;
}

export function get(id) {
  return jobs.get(id) ?? null;
}

async function runJob(job, image) {
  job.status = 'running';
  const { buffer, mimeType } = dataUrlToBuffer(image);

  if (PROVIDER === 'meshy') return runMeshy(job, buffer, mimeType);
  if (PROVIDER === 'tripo') return runTripo(job, buffer, mimeType);
  if (PROVIDER === 'fal') return runFal(job, buffer, mimeType);

  throw new Error(`Unknown provider "${PROVIDER}"`);
}

async function poll(job, check, intervalMs = 4000, timeoutMs = 300_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const result = await check();

    if (result.progress !== undefined) job.progress = result.progress;
    if (result.done) {
      job.status = 'succeeded';
      job.meshUrl = result.meshUrl;
      // Image-to-3D returns geometry, not a rig. Unless the provider also ran
      // a rigging pass, the mesh has no skeleton and no viseme blendshapes —
      // the studio needs to know, because lip-sync depends on them.
      job.rigged = Boolean(result.rigged);
      return;
    }
    if (result.failed) throw new Error(result.error ?? 'provider reported failure');
  }

  throw new Error('provider timed out');
}

async function runMeshy(job, buffer, mimeType) {
  const key = keyFor('meshy');
  const create = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
      should_remesh: true,
      should_texture: true,
    }),
  });

  if (!create.ok) throw new Error(`Meshy submit failed (${create.status})`);
  const { result: taskId } = await create.json();

  await poll(job, async () => {
    const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return { progress: job.progress };

    const task = await response.json();
    return {
      progress: (task.progress ?? 0) / 100,
      done: task.status === 'SUCCEEDED',
      failed: task.status === 'FAILED' || task.status === 'CANCELED',
      error: task.task_error?.message,
      meshUrl: task.model_urls?.glb,
    };
  });
}

async function runTripo(job, buffer, mimeType) {
  const key = keyFor('tripo');

  const upload = new FormData();
  upload.append('file', new Blob([buffer], { type: mimeType }), 'reference.png');
  const uploaded = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: upload,
  });
  if (!uploaded.ok) throw new Error(`Tripo upload failed (${uploaded.status})`);
  const { data: uploadData } = await uploaded.json();

  const create = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'image_to_model',
      file: { type: mimeType.split('/')[1], file_token: uploadData.image_token },
    }),
  });
  if (!create.ok) throw new Error(`Tripo submit failed (${create.status})`);
  const { data: task } = await create.json();

  await poll(job, async () => {
    const response = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${task.task_id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return { progress: job.progress };

    const { data } = await response.json();
    return {
      progress: (data.progress ?? 0) / 100,
      done: data.status === 'success',
      failed: data.status === 'failed' || data.status === 'banned',
      meshUrl: data.output?.pbr_model ?? data.output?.model,
    };
  });
}

async function runFal(job, buffer, mimeType) {
  const key = keyFor('fal');
  const model = process.env.FAL_MODEL ?? 'fal-ai/triposr';

  const create = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
    }),
  });
  if (!create.ok) throw new Error(`fal submit failed (${create.status})`);
  const queued = await create.json();

  await poll(job, async () => {
    const response = await fetch(queued.status_url, { headers: { Authorization: `Key ${key}` } });
    if (!response.ok) return { progress: job.progress };

    const status = await response.json();
    if (status.status !== 'COMPLETED') {
      return { progress: status.status === 'IN_PROGRESS' ? 0.5 : 0.1 };
    }

    const result = await fetch(queued.response_url, { headers: { Authorization: `Key ${key}` } });
    const payload = await result.json();
    return { done: true, meshUrl: payload.model_mesh?.url ?? payload.model_glb?.url };
  });
}
