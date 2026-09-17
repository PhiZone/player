import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from '$lib/types';
import { fit, getRenderDpr, IS_ANDROID_OR_IOS, IS_TAURI, IS_TAURI_LIKE } from '$lib/utils';
import { Capacitor } from '@capacitor/core';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { EventBus } from './EventBus';
import { scaleConfigImages } from './utils';

const start = async (parent: string, sceneConfig: Config) => {
  const parentElement = document.getElementById(parent)!;
  const renderDpr = getRenderDpr();
  const width = Math.max(1, Math.round(parentElement.clientWidth * renderDpr));
  const height = Math.max(1, Math.round(parentElement.clientHeight * renderDpr));

  const config: Types.Core.GameConfig = {
    type: WEBGL,
    width,
    height,
    fps: {
      smoothStep: !(IS_TAURI_LIKE && sceneConfig.render),
    },
    // Scale.NONE: keep a fixed backing store and let CSS stretch the canvas.
    // EXPAND/FIT + ResizeObserver re-creates GL resources whenever iOS Safari
    // collapses its toolbar, which showed up as 100ms+ JS frames.
    scale: {
      mode: Scale.NONE,
      autoCenter: Scale.NO_CENTER,
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

  const canvas = game.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';

  // Only rebuild the backing store on real layout changes (rotation / split
  // view). iOS Safari toolbar collapse must not resize the GL canvas.
  if (config.scale?.mode === Scale.NONE) {
    let lastW = parentElement.clientWidth;
    let lastH = parentElement.clientHeight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    new ResizeObserver(() => {
      const w = parentElement.clientWidth;
      const h = parentElement.clientHeight;
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 80) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        lastW = parentElement.clientWidth;
        lastH = parentElement.clientHeight;
        try {
          game.scale.resize(
            Math.max(1, Math.round(lastW * renderDpr)),
            Math.max(1, Math.round(lastH * renderDpr)),
          );
        } catch (e) {
          console.warn(e);
        }
      }, 250);
    }).observe(parentElement);
  }
  return game;
};

export default start;
