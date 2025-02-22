import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from '$lib/types';
import { fit, IS_TAURI } from '$lib/utils';
import { Capacitor } from '@capacitor/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { EventBus } from './EventBus';

const start = (parent: string, sceneConfig: Config | null) => {
  const parentElement = document.getElementById(parent)!;

  const config: Types.Core.GameConfig = {
    type: WEBGL,
    width: parentElement.clientWidth * window.devicePixelRatio,
    height: parentElement.clientHeight * window.devicePixelRatio,
    scale: {
      mode: Scale.EXPAND,
      autoCenter: Scale.CENTER_BOTH,
    },
    antialias: true,
    backgroundColor: '#000000',
    scene: [MainGame],
    input: {
      activePointers: 10,
    },
  };

  if (sceneConfig) {
    localStorage.setItem('player', JSON.stringify(sceneConfig));
    if (
      Capacitor.getPlatform() !== 'web' ||
      sceneConfig.preferences.aspectRatio !== null ||
      (sceneConfig.record && sceneConfig.recorderOptions.overrideResolution !== null)
    ) {
      if (
        sceneConfig.recorderOptions.overrideResolution &&
        (!sceneConfig.recorderOptions.overrideResolution[0] ||
          !sceneConfig.recorderOptions.overrideResolution[1])
      )
        sceneConfig.recorderOptions.overrideResolution = null;
      let dimensions: { width: number; height: number } = { width: 0, height: 0 };
      if (Capacitor.getPlatform() !== 'web') {
        dimensions = {
          width: Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio,
          height: Math.min(window.screen.width, window.screen.height) * window.devicePixelRatio,
        };
      }
      if (sceneConfig.preferences.aspectRatio !== null) {
        const ratio = sceneConfig.preferences.aspectRatio;
        dimensions = fit(
          ratio[0],
          ratio[1],
          Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio,
          Math.min(window.screen.width, window.screen.height) * window.devicePixelRatio,
          true,
        );
      }
      if (sceneConfig.record && sceneConfig.recorderOptions.overrideResolution !== null) {
        dimensions = {
          width: sceneConfig.recorderOptions.overrideResolution[0],
          height: sceneConfig.recorderOptions.overrideResolution[1],
        };
      }
      config.width = dimensions.width;
      config.height = dimensions.height;
      config.scale = {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
      };
    }
    if (IS_TAURI && sceneConfig.newTab) {
      if (sceneConfig.metadata.title && sceneConfig.metadata.level) {
        getCurrentWindow().setTitle(
          `${sceneConfig.metadata.title} [${
            sceneConfig.metadata.level !== null && sceneConfig.metadata.difficulty !== null
              ? `${sceneConfig.metadata.level} ${sceneConfig.metadata.difficulty?.toFixed(0)}`
              : sceneConfig.metadata.level
          }]`,
        );
      } else {
        EventBus.on('metadata', (metadata: { title: string; level: string }) => {
          getCurrentWindow().setTitle(`${metadata.title} [${metadata.level}]`);
        });
      }
    }
  }
  const game = new Game({ ...config, parent });
  // @ts-expect-error - globalThis is not defined in TypeScript
  globalThis.__PHASER_GAME__ = game;
  game.scene.start('MainGame');
  if (!config.scale || config.scale.mode === Scale.EXPAND) {
    new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        try {
          game.scale.resize(
            entries[0].contentBoxSize[0].inlineSize * window.devicePixelRatio,
            entries[0].contentBoxSize[0].blockSize * window.devicePixelRatio,
          );
        } catch (e) {
          console.warn(e);
        }
      });
    }).observe(parentElement);
  }
  return game;
};

export default start;
