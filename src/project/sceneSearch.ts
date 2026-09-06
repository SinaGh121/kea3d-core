import type { SceneNode } from '@/viewer/types';

export type SceneFilter = 'all' | 'hidden' | 'anchors';

// Keep ancestor context, but never include unrelated children of a matching group.
export function searchScene(nodes: SceneNode[], query: string, filter: SceneFilter): { nodes: SceneNode[]; matches: number } {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let matches = 0;
  const visit = (items: SceneNode[], parentVisible: boolean): SceneNode[] => items.flatMap(node => {
    const visible = parentVisible && node.visible;
    const children = visit(node.children, visible);
    const match = terms.every(term => node.name.toLocaleLowerCase().includes(term))
      && (filter === 'all' || (filter === 'anchors' ? node.type === 'anchor' : !visible));
    if (match) matches++;
    return match || children.length ? [{ ...node, children }] : [];
  });
  return { nodes: visit(nodes, true), matches };
}
