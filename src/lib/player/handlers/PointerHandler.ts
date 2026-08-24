import type { Game } from '../scenes/Game';

/**
 * Thin adapter between Phaser pointer events and the judgment handler's
 * finger tracking. All judgment logic lives in JudgmentHandler; this class
 * only forwards raw pointer state, so multi-touch costs nothing per frame.
 */
export class PointerHandler {
  constructor(scene: Game) {
    scene.input.on('pointerdown', (pointer: { id: number; x: number; y: number }) => {
      scene.judgment.pointerDown(pointer.id, pointer.x, pointer.y);
    });
    scene.input.on('pointermove', (pointer: { id: number; x: number; y: number }) => {
      scene.judgment.pointerMove(pointer.id, pointer.x, pointer.y);
    });
    scene.input.on('pointerup', (pointer: { id: number }) => {
      scene.judgment.pointerUp(pointer.id);
    });
    scene.input.on('pointerupoutside', (pointer: { id: number }) => {
      scene.judgment.pointerUp(pointer.id);
    });
  }

  reset() {
    // Fingers are reset through the judgment handler on restart/seek.
  }
}
