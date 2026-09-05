import type { AnimationClip, Object3D } from 'three';
import type { LinearUnit, UpAxis } from './types';

export interface PreparedModelSource {
  scene: Object3D;
  animations: AnimationClip[];
  totalSize: number;
  sourceUnit: LinearUnit;
  upAxis: UpAxis;
}

const preparedModels = new WeakMap<File, PreparedModelSource>();

export function registerPreparedModel(file: File, model: PreparedModelSource): void {
  preparedModels.set(file, model);
}

export function consumePreparedModel(files: readonly File[]): { file: File; model: PreparedModelSource } | null {
  for (const file of files) {
    const model = preparedModels.get(file);
    if (!model) continue;
    preparedModels.delete(file);
    return { file, model };
  }
  return null;
}
