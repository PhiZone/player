import type { GameObject } from '$lib/types';

export class Node {
  name: string;
  object: GameObject;
  depth: number;
  treeDepth: number;
  children: Node[];
  parent: Node;

  constructor(name: string, object: GameObject, depth: number, parent: Node, treeDepth?: number) {
    this.name = name;
    this.object = object;
    this.depth = depth;
    this.treeDepth = parent ? parent.treeDepth + 1 : (treeDepth ?? 1);
    this.parent = parent;
    this.children = [];
  }

  updateDepth() {
    this.treeDepth = this.parent.treeDepth + 1;
    this.children.forEach((child) => {
      child.updateDepth();
    });
  }

  addChild(child: Node) {
    child.parent = this;
    child.updateDepth();
    this.children.push(child);
  }

  removeChild(child: Node) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      child.parent = ROOT;
      child.updateDepth();
      this.children.splice(index, 1);
    }
  }

  removeAll() {
    this.children.forEach((child) => {
      child.parent = ROOT;
      child.updateDepth();
    });
    this.children = [];
  }
}

export const ROOT = new Node('__ROOT__', null!, null!, null!, 0);
