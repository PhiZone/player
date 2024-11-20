import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from './types';
import { fit } from './utils';

const config: Types.Core.GameConfig = {
  type: WEBGL,
  width: window.screen.width * window.devicePixelRatio,
  height: window.screen.height * window.devicePixelRatio,
  scale: {
    mode: Scale.RESIZE,
  },
  backgroundColor: '#000000',
  scene: [MainGame],
  input: {
    activePointers: 10,
  },
};

const start = (parent: string, sceneConfig: Config | null) => {
  if (sceneConfig) {
    if (sceneConfig.preferences.aspectRatio !== null) {
      const ratio = sceneConfig.preferences.aspectRatio;
      const dimensions = fit(
        ratio[0],
        ratio[1],
        window.screen.width * window.devicePixelRatio,
        window.screen.height * window.devicePixelRatio,
        true,
      );
      config.width = dimensions.width;
      config.height = dimensions.height;
      config.scale = {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
      };
    }
    localStorage.setItem('player', JSON.stringify(sceneConfig));
  }
  const game = new Game({ ...config, parent });
  game.scene.start('MainGame');
  return game;
};

export default start;
