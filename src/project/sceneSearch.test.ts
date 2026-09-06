import { describe, expect, it } from 'vitest';
import { searchScene } from './sceneSearch';
import type { SceneNode } from '@/viewer/types';

const tree: SceneNode[] = [{ id: 'root', name: 'Assembly', type: 'group', visible: false, children: [
  { id: 'a', name: 'Left Mount', type: 'anchor', visible: true, children: [] },
  { id: 'b', name: 'Red Cover', type: 'mesh', visible: true, children: [] },
] }];
describe('scene search', () => {
  it('keeps ancestors and matches case-insensitive terms', () => {
    const result = searchScene(tree, ' MOUNT left ', 'anchors');
    expect(result.matches).toBe(1);
    expect(result.nodes[0]?.children.map(n => n.id)).toEqual(['a']);
    expect(tree[0]?.children).toHaveLength(2);
  });
  it('includes descendants hidden by a parent', () => {
    expect(searchScene(tree, '', 'hidden').matches).toBe(3);
  });
  it('does not include unrelated descendants or invent results', () => {
    expect(searchScene(tree, 'Assembly', 'all').nodes[0]?.children).toEqual([]);
    expect(searchScene(tree, 'missing', 'all')).toEqual({ nodes: [], matches: 0 });
  });
});
