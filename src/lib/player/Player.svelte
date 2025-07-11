<script context="module" lang="ts">
  import { type Game } from 'phaser';
  import type { Game as GameScene } from './scenes/Game';

  export type GameReference = {
    game: Game | null;
    scene: GameScene | null;
  };
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import start from './main';
  import { EventBus } from './EventBus';
  import { GameStatus, type Config } from '$lib/types';
  import {
    clamp,
    getParams,
    IS_TAURI,
    notify,
    showPerformance,
    fromRichText,
    triggerDownload,
  } from '$lib/utils';
  import { convertTime, findPredominantBpm, getTimeSec } from './utils';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { ProgressBarStatus } from '@tauri-apps/api/window';
  import WaveSurfer, { type WaveSurferOptions } from 'wavesurfer.js';
  import Minimap from 'wavesurfer.js/dist/plugins/minimap.esm.js';
  import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import { NOTE_PRIORITIES } from './constants';
  import { equal } from 'mathjs';
  import { base } from '$app/paths';
  import { Capacitor } from '@capacitor/core';
  import StatsJS from 'stats-js';
  import { openPath } from '@tauri-apps/plugin-opener';
  import { sep } from '@tauri-apps/api/path';
  import { m } from '$lib/paraglide/messages';

  export let gameRef: GameReference;

  export let config: Config | null = null;

  export let currentActiveScene: (scene: GameScene) => void | undefined = () => {};

  config ??= getParams();
  if (!config) {
    goto(`${base}/${IS_TAURI || Capacitor.getPlatform() !== 'web' ? `?t=${Date.now()}` : ''}`);
  }

  let loadingProgress = 0;
  let loadingDetail = '';

  let renderingStarted: number;
  let renderingProgress = 0;
  let renderingPercent = 0;
  let renderingTotal = 0;
  let renderingETA = 0;
  let showProgress = true;
  let renderingDetail = '';
  let renderingOutput = '';
  let lastProgressBarPercent = 0;

  let wakeLock: WakeLockSentinel | null = null;

  let status = GameStatus.LOADING;
  let duration = 0;
  let timeSec = 0;

  let title: string | null = config?.metadata.title ?? null;
  let level: string | null =
    config && config.metadata.level !== null && config.metadata.difficulty !== null
      ? `${config.metadata.level} ${config.metadata.difficulty?.toFixed(0)}`
      : (config?.metadata.level ?? null);
  let credits: string[] = [];

  let showStart = false;
  let showPause = false;
  let keyboardSeeking = false;
  let allowSeek = true;
  let render = false;
  let enableOffsetHelper = true;
  let offset = 0;
  let progressBarHeld = false;
  let pausedByBar = false;
  let countdown = 0;
  let stillLoading = false;
  let counter: NodeJS.Timeout;
  let timeout: NodeJS.Timeout;

  let offsetHelperElement: HTMLDivElement;
  let waveformElement: HTMLDivElement;
  let minimapElement: HTMLDivElement;
  let offsetElement: HTMLDivElement;
  let wavesurferOptions:
    | (Omit<WaveSurferOptions, 'minPxPerSec'> & { minPxPerSec: number })
    | undefined;
  let wavesurfer: WaveSurfer | undefined;
  let regions: Regions | undefined;
  let isOffsetAdjustedChartExported = false;

  let performanceEnabled = showPerformance();
  let performanceStats: StatsJS | undefined;

  onMount(async () => {
    if (!config) return;
    gameRef.game = await start('player', config);
    timeout = setTimeout(() => {
      stillLoading = true;
    }, 10000);

    EventBus.on('loading', (p: number) => {
      loadingProgress = p;
    });

    EventBus.on('loading-detail', (p: string) => {
      loadingDetail = p;
    });

    EventBus.on('rendering', (p: number) => {
      renderingProgress = p;
      renderingPercent = clamp(p / renderingTotal, 0, 1);
      renderingETA =
        ((Date.now() - renderingStarted) / 1000 / Math.min(renderingProgress, renderingTotal)) *
        Math.max(renderingTotal - renderingProgress, 0);
      if (renderingPercent - lastProgressBarPercent >= 0.01) {
        getCurrentWebviewWindow().setProgressBar({
          status: ProgressBarStatus.Normal,
          progress: Math.round(renderingPercent * 100),
        });
        lastProgressBarPercent = renderingPercent;
      }
    });

    EventBus.on('video-rendering-finished', () => {
      showProgress = false;
      getCurrentWebviewWindow().setProgressBar({
        status: ProgressBarStatus.Indeterminate,
      });
    });

    EventBus.on('rendering-finished', (output: string) => {
      renderingOutput = output;
      showProgress = true;
      renderingPercent = 1;
      getCurrentWebviewWindow().setProgressBar({
        status: ProgressBarStatus.None,
      });
      notify(m.rendering_saved({ path: output }), 'success', async () => {
        await openPath(output.split(sep()).slice(0, -1).join(sep()));
      });
      wakeLock?.release().then(() => {
        wakeLock = null;
      });
    });

    EventBus.on('rendering-detail', (p: string) => {
      renderingDetail = p;
    });

    EventBus.on('current-scene-ready', (scene: GameScene) => {
      clearTimeout(timeout);
      stillLoading = false;
      gameRef.scene = scene;
      status = scene.status;
      render = scene.render;
      duration = scene.song.duration;
      offset = scene.chart.META.offset;
      showStart = status === GameStatus.READY;
      allowSeek = (scene.autoplay || scene.practice) && !render;
      enableOffsetHelper = scene.adjustOffset;
      const metadata = scene.metadata;
      title = metadata.title;
      level = metadata.level;
      [metadata.composer, metadata.charter, metadata.illustrator].forEach((credit) => {
        credits.push(fromRichText(credit ?? ''));
      });

      if (render) {
        renderingStarted = Date.now();
        renderingTotal = Math.ceil(scene.chartRenderer.length * scene.mediaOptions.frameRate);
        navigator.wakeLock.request('screen').then((wl) => {
          wakeLock = wl;
        });
      }

      if (enableOffsetHelper) {
        const predominantBpm = findPredominantBpm(scene.bpmList, duration);
        regions = Regions.create();
        wavesurferOptions = {
          container: waveformElement,
          height: 'auto' as const,
          width: offsetHelperElement.clientWidth - offsetElement.offsetWidth - 8,
          waveColor: '#eee',
          cursorColor: '#bbb',
          progressColor: '#999',
          minPxPerSec: (200 * predominantBpm) / 60,
          cursorWidth: 200 / 64,
          hideScrollbar: true,
          autoCenter: false,
          url: scene.songUrl,
          plugins: [
            regions,
            Minimap.create({
              container: minimapElement,
              height: 16,
              waveColor: '#aaa',
              cursorColor: '#888',
              progressColor: '#666',
            }),
          ],
        };
        wavesurfer = WaveSurfer.create(wavesurferOptions);
        wavesurfer.on('ready', () => {
          updateMarkers();
        });
        wavesurfer.on('interaction', (t) => {
          gameRef.scene?.setSeek(Math.max(0, t));
        });
        new ResizeObserver((_) => {
          try {
            wavesurferOptions!.width =
              offsetHelperElement.clientWidth - offsetElement.offsetWidth - 8;
            wavesurfer!.setOptions(wavesurferOptions!);
          } catch (e) {
            console.warn(e);
          }
        }).observe(offsetHelperElement);
      }

      if (currentActiveScene) {
        currentActiveScene(scene);
      }

      if (performanceStats) {
        scene.events.on('preupdate', performanceStats.begin);
        scene.events.on('render', performanceStats.end);
      }
    });

    if (performanceEnabled) {
      performanceStats = new StatsJS();
      performanceStats.dom.style.top = '50%';
      performanceStats.dom.style.transform = 'translateY(-50%)';
      document.body.appendChild(performanceStats.dom);
    }

    EventBus.on('update', (t: number) => {
      if (t !== timeSec) {
        if (IS_TAURI && !render && t < duration) {
          getCurrentWebviewWindow().setProgressBar({
            status:
              status === GameStatus.PLAYING ? ProgressBarStatus.Normal : ProgressBarStatus.Paused,
            progress: Math.round((t * 100) / duration),
          });
        }
        wavesurfer?.setTime(t);
        if (t === duration && enableOffsetHelper && !isOffsetAdjustedChartExported) {
          exportOffsetAdjustedChart();
        }
      }
      timeSec = t;
    });

    EventBus.on('paused', (emittedBySpace: boolean) => {
      status = GameStatus.PAUSED;
      showPause = !emittedBySpace;
      keyboardSeeking = emittedBySpace;
    });

    EventBus.on('started', () => {
      status = GameStatus.PLAYING;
      keyboardSeeking = false;
      stillLoading = false;
    });

    EventBus.on('error', () => {
      stillLoading = true;
    });

    EventBus.on('finished', () => {
      status = GameStatus.FINISHED;
      if (IS_TAURI && !render) {
        getCurrentWebviewWindow().setProgressBar({
          status: ProgressBarStatus.None,
        });
      }
    });
  });

  onDestroy(async () => {
    gameRef.scene?.destroy();
    gameRef.game?.destroy(true);
    if (performanceStats) {
      gameRef.scene?.events.off('preupdate', performanceStats.begin);
      gameRef.scene?.events.off('render', performanceStats.end);
      document.body.removeChild(performanceStats.dom);
    }
  });

  const exit = () => {
    localStorage.removeItem('player');
    if (IS_TAURI) {
      getCurrentWebviewWindow().setProgressBar({
        status: ProgressBarStatus.None,
      });
    }
    if (!config || config.newTab) {
      if (IS_TAURI) {
        getCurrentWebviewWindow().close();
      } else {
        window.close();
      }
    } else {
      goto(`${base}/${IS_TAURI || Capacitor.getPlatform() !== 'web' ? `?t=${Date.now()}` : ''}`);
    }
  };

  const updateMarkers = () => {
    if (regions && gameRef.scene) {
      regions.clearRegions();
      const bpmList = gameRef.scene.bpmList;
      [...gameRef.scene.notes]
        .sort((a, b) =>
          a.note.type === b.note.type
            ? a.note.startBeat - b.note.startBeat
            : NOTE_PRIORITIES[a.note.type] - NOTE_PRIORITIES[b.note.type],
        )
        .forEach((note) => {
          regions?.addRegion({
            start: getTimeSec(bpmList, note.note.startBeat) + offset / 1000,
            end:
              getTimeSec(
                bpmList,
                note.note.type === 2 ? note.note.endBeat : note.note.startBeat + 1 / 64,
              ) +
              offset / 1000,
            color:
              note.note.type === 1
                ? 'rgba(10, 195, 255, 0.5)'
                : note.note.type === 2
                  ? 'rgba(153, 231, 253, 0.5)'
                  : note.note.type === 3
                    ? 'rgba(254, 67, 101, 0.5)'
                    : 'rgba(240, 237, 105, 0.5)',
            drag: false,
            resize: false,
          });
        });
    }
  };

  const exportOffsetAdjustedChart = () => {
    const content = JSON.stringify(gameRef.scene?.chart, (key, value) => {
      if (
        key === 'startBeat' ||
        key === 'endBeat' ||
        key === 'startTimeSec' ||
        key === 'endTimeSec'
      ) {
        return undefined;
      }
      return value;
    });
    triggerDownload(
      new Blob([content], { type: 'application/json' }),
      `${title} [${level}] (offset ${offset >= 0 ? '+' : '-'}${Math.abs(offset).toFixed(0)}).json`,
      'adjustedOffset',
    );
    isOffsetAdjustedChartExported = true;
  };
</script>

<svelte:head>
  <title>
    {title && level ? `${title} [${level}] | ${m.app_title()}` : m.app_title()}
  </title>
</svelte:head>

{#if render}
  <div class="absolute inset-0 flex justify-center items-center">
    <div
      class="p-5 min-w-80 flex flex-col gap-3 justify-center items-center rounded-[32px] backdrop-blur-2xl backdrop-brightness-[60%] hover:backdrop-blur-3xl hover:backdrop-brightness-[35%] trans"
    >
      <span class="text-7xl font-bold uppercase">{m.rendering()}</span>
      <div class="flex flex-col gap-1 w-full">
        {#if showProgress}
          <progress class="progress w-full" value={renderingPercent}></progress>
        {:else}
          <progress class="progress w-full"></progress>
        {/if}
        <div class="flex justify-center text-md w-full relative">
          <span class="absolute left-0 trans" class:opacity-0={!showProgress}>
            {renderingPercent.toLocaleString(undefined, {
              style: 'percent',
              minimumFractionDigits: 2,
            })}
          </span>
          <span>
            {renderingDetail}
          </span>
          <span class="absolute right-0 trans" class:opacity-0={!showProgress}>
            {convertTime(renderingETA, true)}
          </span>
        </div>
      </div>
    </div>
  </div>
  <div class="absolute bottom-5">
    <div
      class="p-3 flex flex-col gap-3 justify-center items-center rounded-full backdrop-blur-2xl backdrop-brightness-[60%] hover:backdrop-blur-3xl hover:backdrop-brightness-[35%] trans uppercase"
    >
      {#if renderingOutput}
        <div class="flex gap-2 w-96">
          <button
            class="btn btn-outline border-2 btn-success text-xl rounded-full flex-1"
            on:click={async () => {
              await openPath(renderingOutput);
            }}
          >
            {m.open_file()}
          </button>
          <button
            class="btn btn-outline border-2 btn-info text-xl rounded-full flex-1"
            on:click={async () => {
              await openPath(renderingOutput.split(sep()).slice(0, -1).join(sep()));
            }}
          >
            {m.open_folder()}
          </button>
        </div>
      {:else}
        <button
          class="btn btn-outline border-2 btn-error text-xl rounded-full"
          on:click={async () => {
            await gameRef.scene?.chartRenderer.cancel();
          }}
        >
          {m.cancel()}
        </button>
      {/if}
    </div>
  </div>
{/if}

<div class="absolute inset-0 flex justify-center items-center pointer-events-none">
  <div
    class="w-28 h-28 flex justify-center items-center rounded-3xl opacity-0 backdrop-blur-xl backdrop-brightness-90 trans"
    class:opacity-100={countdown > 0 && status === GameStatus.PLAYING}
  >
    <span class="text-7xl font-bold">
      {countdown}
    </span>
  </div>
</div>

<div
  class="absolute flex flex-col justify-center items-center gap-1 w-full h-full trans backdrop-blur-2xl backdrop-brightness-75"
  class:opacity-0={status === GameStatus.PLAYING ||
    status === GameStatus.FINISHED ||
    progressBarHeld ||
    keyboardSeeking}
  class:pointer-events-none={status === GameStatus.PLAYING ||
    status === GameStatus.FINISHED ||
    keyboardSeeking}
>
  {#if status === GameStatus.LOADING}
    <span class="loading loading-spinner w-24"></span>
    <span class="text-4xl">
      {loadingProgress.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 0,
      })}
    </span>
    {#if loadingDetail}
      <span class="text-xs">{loadingDetail}</span>
    {/if}
  {:else if showStart}
    {#if title && level}
      <div class="m-4 flex flex-col items-center whitespace-pre">
        <h2 class="text-6xl font-bold">
          {title}
        </h2>
        <h4 class="text-3xl opacity-70">
          {level}
        </h4>
        {#if credits.length > 0}
          <div class="flex items-center gap-1 my-4">
            {#each credits as credit, i}
              {#if credit}
                <div
                  class="tooltip tooltip-bottom"
                  data-tip={['Composer', 'Chart designer', 'Illustration designer'][i]}
                >
                  <span class="badge badge-lg opacity-70 hover:badge-outline hover:opacity-100">
                    {credit}
                  </span>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <button
      class="btn btn-outline border-2 btn-lg rounded-full text-2xl w-fit"
      on:click={() => {
        setTimeout(() => {
          showStart = false;
        }, 500);
        gameRef.scene?.start();
      }}
    >
      {m.start()}
    </button>
  {:else if showPause}
    <div class="flex flex-col gap-4 items-center">
      <h2 class="text-6xl font-bold uppercase">{m.paused()}</h2>
      <div class="flex gap-2">
        <button class="btn btn-outline border-2 btn-lg btn-circle trans" on:click={exit}>
          {#if !config || config.newTab}
            <i class="fa-solid fa-xmark fa-xl"></i>
          {:else}
            <i class="fa-solid fa-house fa-xl"></i>
          {/if}
        </button>
        <button
          class="btn btn-outline border-2 btn-lg rounded-full text-2xl w-fit trans"
          on:click={() => {
            setTimeout(() => {
              showPause = false;
            }, 500);
            status = GameStatus.LOADING;
            gameRef.scene?.restart();
          }}
        >
          {m.restart()}
        </button>
        <button
          class="btn btn-outline border-2 btn-lg rounded-full text-2xl w-fit trans"
          on:click={() => {
            setTimeout(() => {
              showPause = false;
            }, 500);
            status = GameStatus.PLAYING;
            if (gameRef.scene?.autoplay) {
              gameRef.scene?.resume();
            } else {
              countdown = 3;
              counter = setInterval(() => {
                countdown--;
                if (countdown === 0) {
                  clearInterval(counter);
                  gameRef.scene?.resume();
                }
              }, 1000);
            }
          }}
        >
          {m.resume()}
        </button>
      </div>
    </div>
  {/if}
</div>

{#if allowSeek}
  <div
    class="absolute bottom-5 px-4 py-2 w-[75vw] flex flex-col gap-4 opacity-0 trans {enableOffsetHelper
      ? 'rounded-3xl'
      : 'rounded-full'}"
    class:opacity-50={!enableOffsetHelper &&
      (keyboardSeeking || showPause) &&
      status !== GameStatus.PLAYING &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(timeSec === duration)}
    class:opacity-100={enableOffsetHelper &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(status === GameStatus.PLAYING && timeSec === duration)}
    class:hover:opacity-100={(enableOffsetHelper ||
      ((keyboardSeeking || showPause) && status !== GameStatus.PLAYING)) &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(status === GameStatus.PLAYING && timeSec === duration)}
    class:backdrop-blur-2xl={progressBarHeld}
    class:backdrop-brightness-75={progressBarHeld}
    class:hover:backdrop-blur-2xl={enableOffsetHelper}
    class:hover:backdrop-brightness-75={enableOffsetHelper}
    class:hover:backdrop-brightness-50={enableOffsetHelper && status !== GameStatus.PLAYING}
    class:pointer-events-none={(!enableOffsetHelper && status === GameStatus.PLAYING) ||
      status === GameStatus.LOADING ||
      status === GameStatus.READY ||
      status === GameStatus.FINISHED ||
      (status === GameStatus.PLAYING && timeSec === duration)}
  >
    {#if enableOffsetHelper}
      <div class="flex gap-2 h-[10vh] justify-between items-center" bind:this={offsetHelperElement}>
        <div class="flex flex-col h-full">
          <div class="waveform-height" bind:this={waveformElement}></div>
          <div
            class="h-4"
            bind:this={minimapElement}
            on:pointerdown={() => {
              gameRef.scene?.pause(true);
            }}
          ></div>
        </div>
        <div class="flex flex-col gap-2 items-center min-w-fit" bind:this={offsetElement}>
          <span class="offset-text offset-without-ms">
            {offset >= 0 ? '+' : '-'}{Math.abs(offset).toFixed(0)}
          </span>
          <span class="offset-text offset-with-ms">
            {offset >= 0 ? '+' : '-'}{Math.abs(offset).toFixed(0)} ms
          </span>
          <div class="flex gap-2">
            <div class="join rounded-full">
              {#each Array(6) as _, i}
                <button
                  class="btn btn-sm btn-square btn-outline join-item"
                  on:click={() => {
                    offset += [-50, -10, -1, 1, 10, 50][i];
                    isOffsetAdjustedChartExported = false;
                    EventBus.emit('offset-adjusted', offset);
                    updateMarkers();
                  }}
                  on:mousedown|preventDefault
                >
                  {#if i === 0}
                    <i class="fa-solid fa-angles-left"></i>
                  {:else if i === 1}
                    <i class="fa-solid fa-angle-left"></i>
                  {:else if i === 2}
                    <i class="fa-solid fa-minus"></i>
                  {:else if i === 3}
                    <i class="fa-solid fa-plus"></i>
                  {:else if i === 4}
                    <i class="fa-solid fa-angle-right"></i>
                  {:else if i === 5}
                    <i class="fa-solid fa-angles-right"></i>
                  {/if}
                </button>
              {/each}
            </div>
            <button
              class="btn btn-sm btn-circle btn-outline"
              aria-label="Export offset-adjusted chart"
              on:click={() => {
                exportOffsetAdjustedChart();
              }}
              on:mousedown|preventDefault
            >
              <i class="fa-solid fa-file-export"></i>
            </button>
          </div>
        </div>
      </div>
    {/if}
    <div class="flex items-center">
      <span class="text-3xl min-w-24">{convertTime(timeSec, true)}</span>
      <input
        type="range"
        min="0"
        max={duration}
        value={timeSec}
        step="0.001"
        class="range cursor-default"
        class:hover:cursor-pointer={(keyboardSeeking || showPause) &&
          status !== GameStatus.LOADING &&
          status !== GameStatus.READY &&
          status !== GameStatus.PLAYING &&
          status !== GameStatus.FINISHED &&
          !(timeSec === duration)}
        disabled={(!keyboardSeeking && !showPause) ||
          status === GameStatus.LOADING ||
          status === GameStatus.READY ||
          status === GameStatus.PLAYING ||
          status === GameStatus.FINISHED ||
          timeSec === duration}
        on:pointerdown={() => {
          progressBarHeld = true;
          if (!keyboardSeeking && !showPause) {
            pausedByBar = true;
            gameRef.scene?.pause(true);
          }
        }}
        on:pointerup={() => {
          progressBarHeld = false;
          if (pausedByBar) {
            pausedByBar = false;
            gameRef.scene?.resume();
          }
        }}
        on:input={(e) => {
          gameRef.scene?.setSeek(Math.max(0, parseFloat(e.currentTarget.value)));
        }}
      />
      <span class="text-3xl min-w-24 text-right">{convertTime(duration, true)}</span>
    </div>
  </div>
  <div
    class="absolute right-5 px-2 py-2 join join-vertical opacity-0 trans rounded-full backdrop-blur-lg hover:backdrop-blur-2xl hover:backdrop-brightness-75"
    class:opacity-50={!enableOffsetHelper &&
      (keyboardSeeking || showPause) &&
      status !== GameStatus.PLAYING &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(timeSec === duration)}
    class:opacity-100={enableOffsetHelper &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(status === GameStatus.PLAYING && timeSec === duration)}
    class:hover:opacity-100={(enableOffsetHelper ||
      ((keyboardSeeking || showPause) && status !== GameStatus.PLAYING)) &&
      status !== GameStatus.LOADING &&
      status !== GameStatus.READY &&
      status !== GameStatus.FINISHED &&
      !(status === GameStatus.PLAYING && timeSec === duration)}
    class:hover:backdrop-brightness-50={enableOffsetHelper && status !== GameStatus.PLAYING}
    class:pointer-events-none={(!enableOffsetHelper && status === GameStatus.PLAYING) ||
      status === GameStatus.LOADING ||
      status === GameStatus.READY ||
      status === GameStatus.FINISHED ||
      (status === GameStatus.PLAYING && timeSec === duration)}
  >
    <button
      class="btn btn-outline join-item"
      aria-label="Speed up"
      on:click={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = Math.min(9.9, gameRef.scene.timeScale + 0.1);
        if (wavesurferOptions) {
          wavesurferOptions.minPxPerSec /= gameRef.scene.timeScale;
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      on:mousedown|preventDefault
    >
      <i class="fa-solid fa-plus fa-xl"></i>
    </button>
    <button
      class="btn w-16 h-16 btn-outline join-item text-2xl whitespace-nowrap"
      aria-label="Reset to normal speed"
      on:click={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = 1;
        if (wavesurferOptions) {
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      on:mousedown|preventDefault
    >
      {gameRef.scene &&
      !equal(gameRef.scene.timeScale, parseFloat(gameRef.scene.timeScale.toFixed(1)))
        ? '~'
        : '×'}
      {gameRef.scene ? gameRef.scene.timeScale.toFixed(1) : '?'}
    </button>
    <button
      class="btn btn-outline join-item"
      aria-label="Speed down"
      on:click={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = Math.max(0.1, gameRef.scene.timeScale - 0.1);
        if (wavesurferOptions) {
          wavesurferOptions.minPxPerSec /= gameRef.scene.timeScale;
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      on:mousedown|preventDefault
    >
      <i class="fa-solid fa-minus fa-xl"></i>
    </button>
  </div>
{/if}

{#if timeSec === duration}
  <div
    class="absolute bottom-5 right-5 opacity-0 trans flex flex-col gap-4"
    class:opacity-100={status === GameStatus.FINISHED || stillLoading}
    class:pointer-events-none={status !== GameStatus.FINISHED && !stillLoading}
  >
    {#if status === GameStatus.FINISHED && !config?.render}
      <button
        class="btn btn-outline border-2 btn-lg btn-circle"
        aria-label="Restart"
        on:click={() => {
          status = GameStatus.LOADING;
          gameRef.scene?.restart();
        }}
      >
        <i class="fa-solid fa-arrow-rotate-right fa-xl"></i>
      </button>
    {/if}
    <button
      class="btn btn-outline border-2 btn-lg btn-circle"
      aria-label={!config || config.newTab ? 'Close' : 'Home'}
      on:click={exit}
    >
      {#if !config || config.newTab}
        <i class="fa-solid fa-xmark fa-xl"></i>
      {:else}
        <i class="fa-solid fa-house fa-xl"></i>
      {/if}
    </button>
  </div>
{/if}

<div id="player" class="w-full h-full"></div>

<style lang="postcss">
  .trans {
    transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
    @apply transition duration-300;
  }
  .waveform-height {
    height: calc(100% - 16px);
  }
  .offset-text {
    font-size: calc(9vh - 38px);
    line-height: calc(9vh - 38px);
    @apply font-bold;
  }
  .offset-with-ms {
    display: inline;
    @media (min-height: 1080px) {
      display: none;
    }
  }
  .offset-without-ms {
    display: none;
    @media (min-height: 1080px) {
      display: inline;
    }
  }
</style>
