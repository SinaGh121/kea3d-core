import type { LoadProgress, ModelInfo, RendererInfoSnapshot } from '@/viewer/types';

export const loadMetricEventName = 'kea3d:load-metric';

export type LoadMetricStatus = 'success' | 'cancelled' | 'failure';

export interface LoadMetric {
  fileName: string;
  fileBytes: number;
  status: LoadMetricStatus;
  totalMs: number;
  stagesMs: Partial<Record<LoadProgress['stage'], number>>;
  cadCache?: 'hit' | 'miss';
  model?: Pick<ModelInfo, 'meshes' | 'vertices' | 'triangles' | 'materials'>;
  renderer?: RendererInfoSnapshot;
}

type MetricEmitter = (metric: LoadMetric) => void;

function emitLoadMetric(metric: LoadMetric): void {
  window.dispatchEvent(new CustomEvent<LoadMetric>(loadMetricEventName, { detail: metric }));
}

export function createLoadMetricTracker(
  fileName: string,
  fileBytes: number,
  now: () => number = () => performance.now(),
  emit: MetricEmitter = emitLoadMetric,
) {
  const startedAt = now();
  const stagesMs: LoadMetric['stagesMs'] = {};
  let activeStage: LoadProgress['stage'] | null = null;
  let stageStartedAt = startedAt;
  let cadCache: LoadMetric['cadCache'];
  let finished = false;

  const closeActiveStage = (endedAt: number) => {
    if (!activeStage) return;
    stagesMs[activeStage] = (stagesMs[activeStage] ?? 0) + Math.max(0, endedAt - stageStartedAt);
  };

  return {
    update(progress: LoadProgress): void {
      if (finished) return;
      if (progress.cadCache) cadCache = progress.cadCache;
      if (progress.stage === activeStage) return;
      const changedAt = now();
      closeActiveStage(changedAt);
      activeStage = progress.stage;
      stageStartedAt = changedAt;
    },
    finish(status: LoadMetricStatus, model?: ModelInfo, renderer?: RendererInfoSnapshot): LoadMetric {
      if (finished) throw new Error('Load metric tracker has already finished.');
      finished = true;
      const finishedAt = now();
      closeActiveStage(finishedAt);
      const metric: LoadMetric = {
        fileName,
        fileBytes,
        status,
        totalMs: Math.max(0, finishedAt - startedAt),
        stagesMs,
        ...(cadCache ? { cadCache } : {}),
        ...(model ? {
          model: {
            meshes: model.meshes,
            vertices: model.vertices,
            triangles: model.triangles,
            materials: model.materials,
          },
        } : {}),
        ...(renderer ? { renderer } : {}),
      };
      emit(metric);
      return metric;
    },
  };
}
