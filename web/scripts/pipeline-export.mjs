// Runs Lux3D exports for one object through the shared queue and reports time and size per format.
//   node --env-file=.env.local --import tsx scripts/pipeline-export.mjs <objectId> stl,3mf,usdz,fbx_zip,obj_zip
import { exportKey, runToCompletion, startExport } from "../src/lib/pipeline/jobs.ts";
import { store } from "../src/lib/storage.ts";

const [id, list = "stl"] = process.argv.slice(2);
for (const f of list.split(",")) {
  const t0 = Date.now();
  const { jobId } = await startExport(id, f, { store: store(), now: Date.now });
  const j = await runToCompletion(jobId, { budgetMs: 60_000 }, 4000);
  const g = j.status === "done" ? await store().get(exportKey(id, f)) : null;
  const ex = j.stages.find((s) => s.name === "export");
  console.log(`${f.padEnd(8)} ${j.status} ${j.error ?? ""} total ${Math.round((Date.now() - t0) / 1000)} s, export task ${ex?.startedAt && ex?.endedAt ? Math.round((ex.endedAt - ex.startedAt) / 1000) : "?"} s, ${g ? Math.round(g.body.length / 1024) + " KB" : "-"}, outputs ${JSON.stringify(j.work.outputs?.export ?? [])}`);
}
