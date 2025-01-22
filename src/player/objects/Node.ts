import type { GameObject } from '../types';

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

  addChild(child: Node) {
    child.parent = this;
    child.treeDepth = this.treeDepth + 1;
    this.children.push(child);
  }

  removeChild(child: Node) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      child.parent = ROOT;
      child.treeDepth = 1;
      this.children.splice(index, 1);
    }
  }

  removeAll() {
    this.children.forEach((child) => {
      child.parent = ROOT;
      child.treeDepth = 1;
    });
    this.children = [];
  }
}

export const ROOT = new Node('__ROOT__', null!, null!, null!, 0);
