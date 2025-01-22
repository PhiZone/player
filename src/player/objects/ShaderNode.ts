import type { GameObjects } from 'phaser';
import { Node } from './Node';

export class ShaderNode extends Node {
  object: GameObjects.Container;
  upperDepth: number;

  constructor(
    name: string,
    object: GameObjects.Container,
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
