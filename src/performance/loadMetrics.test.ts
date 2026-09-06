import { describe, expect, it } from 'vitest';
import { createLoadMetricTracker, type LoadMetric } from './loadMetrics';

describe('load performance metrics', () => {
  it('accumulates repeated stages and emits one successful result', () => {
    const timestamps = [10, 20, 35, 50, 80, 100];
    const emitted: LoadMetric[] = [];
    const tracker = createLoadMetricTracker(
      'sample.glb',
      123,
      () => timestamps.shift() ?? 100,
      (metric) => emitted.push(metric),
    );

    tracker.update({ stage: 'preparing' });
    tracker.update({ stage: 'reading', value: 0 });
    tracker.update({ stage: 'decoding' });
    tracker.update({ stage: 'reading', value: 1 });
    const metric = tracker.finish('success', {
      fileName: 'sample.glb', fileSize: 123, meshes: 2, vertices: 30,
      triangles: 10, materials: 1, dimensions: [1, 2, 3],
    });

    expect(metric).toEqual({
      fileName: 'sample.glb',
      fileBytes: 123,
      status: 'success',
      totalMs: 90,
      stagesMs: { preparing: 15, reading: 35, decoding: 30 },
      model: { meshes: 2, vertices: 30, triangles: 10, materials: 1 },
    });
    expect(emitted).toEqual([metric]);
  });

  it('records a failed load without model statistics', () => {
    const timestamps = [0, 5, 12];
    const emitted: LoadMetric[] = [];
    const tracker = createLoadMetricTracker('broken.stl', 44, () => timestamps.shift() ?? 12, (metric) => emitted.push(metric));
    tracker.update({ stage: 'reading' });

    expect(tracker.finish('failure')).toMatchObject({
      status: 'failure', totalMs: 12, stagesMs: { reading: 7 },
    });
    expect(() => tracker.finish('failure')).toThrow('already finished');
    expect(emitted).toHaveLength(1);
  });
});
