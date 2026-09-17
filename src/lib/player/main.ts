import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from '$lib/types';
import { fit, IS_ANDROID_OR_IOS, IS_TAURI, IS_TAURI_LIKE } from '$lib/utils';
import { Capacitor } from '@capacitor/core';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { EventBus } from './EventBus';
import { scaleConfigImages } from './utils';

/**
 * Backing-store scale. Full devicePixelRatio (often 3) with MSAA is fill-rate
 * bound on phones — residual present time sits just above a 60Hz vsync and
 * produces continuous ~50fps jank even when JS is only a few ms.
 */
const RENDER_DPR_CAP = 1.5;

const getRenderDpr = () => {
  const dpr = window.devicePixelRatio || 1;
  return IS_ANDROID_OR_IOS ? Math.min(dpr, RENDER_DPR_CAP) : dpr;
};

const start = async (parent: string, sceneConfig: Config) => {
  const parentElement = document.getElementById(parent)!;
  const renderDpr = getRenderDpr();

  const config: Types.Core.GameConfig = {
    type: WEBGL,
    width: parentElement.clientWidth * renderDpr,
    height: parentElement.clientHeight * renderDpr,
    fps: {
      smoothStep: !(IS_TAURI_LIKE && sceneConfig.render),
    },
    scale: {
      mode: Scale.EXPAND,
      autoCenter: Scale.CENTER_BOTH,
    },
    antialias: !IS_ANDROID_OR_IOS,
    backgroundColor: '#000000',
    loader: {
      crossOrigin: 'anonymous',
    },
    scene: [MainGame],
    input: {
      activePointers: 10,
    },
    render: {
      powerPreference: 'high-performance',
      antialias: false,
    },
  };

  if (Capacitor.getPlatform() !== 'web') {
    await scaleConfigImages(sceneConfig);
  }
  localStorage.setItem('player', JSON.stringify(sceneConfig));
  if (
    Capacitor.getPlatform() !== 'web' ||
    sceneConfig.preferences.aspectRatio !== null ||
    (IS_TAURI_LIKE && sceneConfig.render)
  ) {
    if (
      sceneConfig.mediaOptions.overrideResolution &&
      (!sceneConfig.mediaOptions.overrideResolution[0] ||
        !sceneConfig.mediaOptions.overrideResolution[1])
    )
      sceneConfig.mediaOptions.overrideResolution = null;

    let dimensions: { width: number; height: number } = { width: 0, height: 0 };

    if (Capacitor.getPlatform() !== 'web') {
      dimensions = {
        width: Math.max(window.screen.width, window.screen.height) * renderDpr,
        height: Math.min(window.screen.width, window.screen.height) * renderDpr,
      };
    }

    if (sceneConfig.preferences.aspectRatio !== null) {
      const ratio = sceneConfig.preferences.aspectRatio;
      dimensions = fit(
        ratio[0],
        ratio[1],
        Math.max(window.screen.width, window.screen.height) * renderDpr,
        Math.min(window.screen.width, window.screen.height) * renderDpr,
        true,
      );
    }

    if (IS_TAURI_LIKE && sceneConfig.render) {
      if (sceneConfig.mediaOptions.overrideResolution !== null) {
        dimensions = {
          width: sceneConfig.mediaOptions.overrideResolution[0],
          height: sceneConfig.mediaOptions.overrideResolution[1],
        };
      } else {
        const ratio = sceneConfig.preferences.aspectRatio;
        let monitorSize: { width: number; height: number } | null = null;
        if (IS_TAURI) {
          const monitor = await currentMonitor();
          if (monitor) monitorSize = monitor.size;
        }
        if (!monitorSize) {
          monitorSize = {
            width: window.screen.width * window.devicePixelRatio,
            height: window.screen.height * window.devicePixelRatio,
          };
        }
        if (ratio) {
          dimensions = fit(ratio[0], ratio[1], monitorSize.width, monitorSize.height, true);
        } else {
          dimensions = monitorSize;
        }
      }
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

  const game = new Game({ ...config, parent });
  // @ts-expect-error - globalThis is not defined in TypeScript
  globalThis.__PHASER_GAME__ = game;
  game.scene.start('MainGame');
  if (!config.scale || config.scale.mode === Scale.EXPAND) {
    new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        try {
          game.scale.resize(
            entries[0].contentBoxSize[0].inlineSize * renderDpr,
            entries[0].contentBoxSize[0].blockSize * renderDpr,
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
