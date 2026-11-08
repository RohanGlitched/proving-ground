# Lux3D pipeline

Turns a sentence or a photo into an object the robot can walk into: a Lux3D model, split into collision parts,
compressed for the browser, stored, and listed in the library.

## Stages

```
object (text)    generate ─► fetch-result ─► upload-for-split ─► part-split ─► process ─► publish
object (photo)   upload-input ─► generate ─► … same …
                                    │                        └─ skipped when the object is < 12 cm or marked split:false;
                                    │                           a failed or 1-part split falls back to the whole mesh
pedestrian       generate ─► fetch-result ─► upload-for-rig ─► rig ─► upload-for-retarget ─► retarget(Walk_Loop) ─► process ─► publish
articulated      generate ─► fetch-result ─► upload-for-articulation ─► articulate(motion prompt) ─► process ─► publish
```

- `generate` is text-to-3D or image-to-3D (`G1-Turbo`, `faceCount` 20,000) and `upload-*` re-uploads a stored
  GLB through Asset/OUS. Every Lux3D file input must be an OUS URL: third-party links fail silently with
  status 4, so generated outputs are re-uploaded too.
- Every finished task's output is downloaded into storage (`raw/{jobId}/…`) as soon as it is noticed,
  because output links expire after about 2 hours. If a link has already expired, generation runs once more.
- `process` (process.ts) writes `objects/{id}/visual.glb` and `objects/{id}/parts.json`. `publish` writes
  `meta.json` and appends to `library.json`.

## Files and frames

| key | what |
| --- | --- |
| `objects/{id}/visual.glb` | one mesh node per part, named `part-0…part-N-1` in parts.json order; ≤ 25k triangles; WebP textures ≤ 1024 px; meshopt + KHR_mesh_quantization for static objects. Load it with `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`. Every part node has the same node transform (the quantization scale), so explode parts by adding to `position`, not by resetting it. Animated models (pedestrians, articulated) keep their skeleton and animations and are not quantized. |
| `objects/{id}/parts.json` | `{version, up:"y", unit:"m", source:"part-split"\|"whole", bbox, parts:[{name, count, points:[x,y,z,…], bbox, centroid}]}`; at most 400 extreme points per part (the sim hulls them). Pedestrians and articulated objects carry `animated.clips`. |
| `objects/{id}/meta.json` | `ObjectMeta` (library.ts): name, kind, source, prompt, style, bbox, size [x, y, z] m, parts, split, tris, bytes, credits, Lux3D task ids, `up:"y"`, `unit:"m"`. |
| `inputs/{id}.jpg` | the cleaned input photo (EXIF stripped, ≤ 1024 px), served only once the object is published. |
| `jobs/{id}.json`, `queue.json`, `library.json`, `limits/*`, `courses/*` | state, all updated with generation-match. |

Both files use the Lux3D frame unchanged: **Y-up, metres, origin at the bounding-box centre** (so the object
spans y = −h/2…h/2; the sim lifts it to the floor). `lux3d_metadata.bbox` in the raw GLB lists the extents in
Z-up order, so bbox and size here are measured from the geometry.

## Queue

One Lux3D task may run per account, so there is one global queue (`queue.json`) with one active job.
Advancement is stateless and poll-driven: `GET /api/jobs/:id` and `POST /api/tick` (also a Vercel cron every
minute) call `advanceJob`, which starts the next stage, collects a finished task or processes, then returns.
Polling a running task needs no write. Work takes a 4-minute lease on the job doc (a generation-match write),
so racing advancers never start a stage twice (tests/pipeline/queue.test.mjs runs two at once). A
`GENERATION_CONCURRENCY_LIMIT_EXCEEDED` answer (for example while the library script runs) leaves the stage
pending and retries every 15 s, for up to 20 minutes. An active job that has not moved for 30 minutes is
dropped from the queue.

## Cost per job (credits, live quote Nov 9 2026)

| job | stages | credits |
| --- | --- | --- |
| photo object | image-to-3D Turbo 1 + part-split 30 | 31 (1 if < 12 cm) |
| text object | text-to-3D Turbo 13 + part-split 30 | 43 (13 without split) |
| pedestrian | text-to-3D 13 + rig 15 + retarget 6 | 34 |
| articulated | text-to-3D 13 + articulation 28 | 41 |

G1 instead of Turbo costs 20 for either generator. Multi-format export is 1.

## Measured (Nov 9 2026)

- Turbo generation ≈ 80 s; part-split ≈ 80 s; OUS upload of a 7 MB GLB a few seconds.
- Processing: chair (8 parts, 18k tris, 7.3 MB) → 395 KB visual + 23 KB parts in 0.7 s; sneaker (305k tris,
  19 MB) → 751 KB, 24k tris in 1.8 s.
- See scripts/library-log.json for per-item stage timings, sizes and the measured credit change.

## Environment

| var | use |
| --- | --- |
| `AHOLO_API_KEY` | Lux3D key (raw, sent as the Authorization header). Never logged. |
| `GCS_BUCKET` | use Google Cloud Storage; unset = local files under `web/.data` (or `DATA_DIR`). On Vercel without it, data lives in `/tmp` and is lost between instances. |
| `GCS_WIF_AUDIENCE` | `//iam.googleapis.com/projects/<n>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`; the function's Vercel OIDC token is exchanged at Google STS (no key). Needs OIDC federation on the Vercel project and `roles/storage.objectAdmin` on the bucket for the project's principal. |
| `GCS_AUTH=gcloud` / `GCS_ACCESS_TOKEN` | scripts on a laptop (library-sync). |
| `CRON_SECRET` | required by `GET /api/tick` (Vercel sends it as a Bearer token). |
| `LIMIT_PER_IP_HOUR` (3), `LIMIT_PER_DAY` (40), `LIMIT_MIN_CREDITS` (300) | public limits; new jobs are refused under the credit floor. |
| `PIPELINE_PAUSED=1` | refuse new jobs (kill switch). |
| `LUX_VERSION` (G1-Turbo), `LUX_FACES` (20000), `SPLIT_MIN_DIM` (0.12) | generation knobs. |
| `IP_SALT` | salt for hashed IPs in `limits/`. |
| `DATA_DIR` | local store root (dev). |

## Failure modes

| what | what happens |
| --- | --- |
| Lux3D busy (another task on the account) | stage stays pending, retried every 15 s; the UI shows "Waiting for a free Lux3D slot". |
| Task fails or is cancelled | part-split falls back to the whole mesh; any other stage fails the job with a plain sentence. |
| Task runs > 15 min | treated as failed. |
| Output link expired before collection | generation runs once more (costs the generation again). |
| Lux3D unreachable | reads retry 3× (30 s timeout each); the next poll tries again. |
| Out of credits / under the floor | `POST /api/make` answers 503; the library keeps working. |
| Function dies mid-stage | the lease expires after 4 min and the next poll carries on. |
| Request body > 4.5 MB | Vercel rejects it before our code runs: downscale photos in the browser first. |

## Scripts

- `scripts/library-generate.mjs`: pre-generates `scripts/library-list.json` through this pipeline, one task at a
  time, resumable, with a 2,500-credit budget and a 600-credit floor. `--only a,b`, `--limit N`, `--dry`,
  `--version G1 --suffix -g1` (comparison copies).
- `scripts/library-seed.mjs`: adds the two Nov 9 probe models at no cost.
- `scripts/library-sync.mjs`: copies the local library into the bucket.
- Tests: `npm run test:pipeline` (mocked Lux3D); `LIVE_LUX=1 npm run test:pipeline:live` (balance + an OUS
  upload, free); add `LIVE_LUX_GENERATE=1` for one image-to-3D Turbo task (1 credit).
