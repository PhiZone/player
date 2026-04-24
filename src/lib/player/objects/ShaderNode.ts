import type { ShaderNodeObject } from '$lib/types';
import { Node } from './Node';

export class ShaderNode extends Node {
  object: ShaderNodeObject;
  upperDepth: number;

  constructor(
    name: string,
    object: ShaderNodeObject,
    depth: number,
    upperDepth: number,
    parent: Node,
    treeDepth?: number,
  ) {
    super(name, object, depth, parent, treeDepth);
    this.object = object;
    this.upperDepth = upperDepth;
  }
}
