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
  import { EventBus, setAutostartBlocked } from './EventBus';
  import { GameStatus, type Config, type StoredChart } from '$lib/types';
  import {
    clamp,
    getParams,
    IS_ANDROID_OR_IOS,
    IS_IFRAME,
    IS_TAURI,
    IS_TAURI_LIKE,
    notify,
    showPerformance,
    fromRichText,
    triggerDownload,
    uuid,
  } from '$lib/utils';
  import { convertTime } from './utils';
  import WaveSurfer, { type WaveSurferOptions } from 'wavesurfer.js';
  import Minimap from 'wavesurfer.js/dist/plugins/minimap.esm.js';
  import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import { NOTE_PRIORITIES } from './constants';
  import { equal } from 'mathjs';
  import mime from 'mime/lite';
  import { base } from '$app/paths';
  import { Capacitor } from '@capacitor/core';
  import StatsJS from 'stats-js';
  import { m } from '$lib/paraglide/messages';
  import { tauriInvoke } from '$lib/services/tauriIpc';
  import { pathSep, openPath } from '$lib/services/tauriFsBridge';
  import { Button } from '$lib/components/ui/button';
  import FileIcon from '@lucide/svelte/icons/file';
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
  import XIcon from '@lucide/svelte/icons/x';
  import HouseIcon from '@lucide/svelte/icons/house';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
  import PlayIcon from '@lucide/svelte/icons/play';
  import SaveIcon from '@lucide/svelte/icons/save';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import MinusIcon from '@lucide/svelte/icons/minus';
  import ChevronsLeftIcon from '@lucide/svelte/icons/chevrons-left';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronsRightIcon from '@lucide/svelte/icons/chevrons-right';
  import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
  import {
    computeChartChecksum,
    loadAllChartSummaries,
    syncChart,
  } from '$lib/services/chartStorage';

  export let gameRef: GameReference;
  export let config: Config | null = null;
  export let currentActiveScene: (scene: GameScene) => void | undefined = () => {};

  config ??= getParams();
  if (!config) {
    goto(`${base}/${IS_TAURI_LIKE || Capacitor.getPlatform() !== 'web' ? `?t=${Date.now()}` : ''}`);
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
  let lastWaveformUpdate = -100;

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

  const isPortrait = () => window.matchMedia('(orientation: portrait)').matches;

  let orientationPortrait = isPortrait();
  let rotationPromptDismissed = false;

  $: rotationPromptVisible =
    status === GameStatus.LOADING &&
    IS_ANDROID_OR_IOS &&
    orientationPortrait &&
    !rotationPromptDismissed;

  $: {
    setAutostartBlocked(rotationPromptVisible);
    if (!rotationPromptVisible) EventBus.emit('autostart-unblocked');
  }

  const handleResize = () => {
    orientationPortrait = isPortrait();
  };

  const dismissRotationPrompt = () => {
    rotationPromptDismissed = true;
  };

  let performanceEnabled = showPerformance();
  let performanceStats: StatsJS | undefined;

  const handleContextMenu = (e: PointerEvent) => {
    e.preventDefault();
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  };

  onMount(async () => {
    if (!config) return;
    gameRef.game = await start('player', config);
    timeout = setTimeout(() => {
      stillLoading = true;
    }, 10000);

    addEventListener('contextmenu', handleContextMenu, { passive: false });
    addEventListener('wheel', handleWheel, { passive: false });
    addEventListener('resize', handleResize);
    addEventListener('orientationchange', handleResize);

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
      if (IS_TAURI && renderingPercent - lastProgressBarPercent >= 0.01) {
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
            getCurrentWebviewWindow().setProgressBar({
              status: ProgressBarStatus.Normal,
              progress: Math.round(renderingPercent * 100),
            });
          });
        });
        lastProgressBarPercent = renderingPercent;
      }
    });

    EventBus.on('video-rendering-finished', () => {
      showProgress = false;
      if (IS_TAURI) {
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
            getCurrentWebviewWindow().setProgressBar({
              status: ProgressBarStatus.Indeterminate,
            });
          });
        });
      }
    });

    EventBus.on('rendering-finished', async (output: string) => {
      renderingOutput = output;
      showProgress = true;
      renderingPercent = 1;
      if (IS_TAURI) {
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
            getCurrentWebviewWindow().setProgressBar({
              status: ProgressBarStatus.None,
            });
          });
        });
      }
      const separator = await pathSep();
      notify(m.rendering_saved({ path: output }), 'success', async () => {
        if (IS_TAURI_LIKE) {
          await openPath(output.split(separator).slice(0, -1).join(separator));
        }
      });
      wakeLock?.release().then(() => {
        wakeLock = null;
      });
      if (config.automate) tauriInvoke('close');
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
        const predominantBpm = scene.timeUtil.findPredominantBpm(duration);
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
      if (t === duration) {
        if (timeSec !== t) {
          wavesurfer?.setTime(t);
          timeSec = t;
        }
        if (enableOffsetHelper && !isOffsetAdjustedChartExported) {
          saveOffsetAdjustedChart();
        }
        return;
      }
      if (t !== timeSec && IS_TAURI && !render) {
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
            getCurrentWebviewWindow().setProgressBar({
              status:
                status === GameStatus.PLAYING ? ProgressBarStatus.Normal : ProgressBarStatus.Paused,
              progress: Math.round((t * 100) / duration),
            });
          });
        });
      }
      const now = performance.now();
      if (now - lastWaveformUpdate > 100) {
        wavesurfer?.setTime(t);
        lastWaveformUpdate = now;
      }
      if (Math.abs(t - timeSec) >= 0.1) {
        timeSec = t;
      }
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
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
            getCurrentWebviewWindow().setProgressBar({
              status: ProgressBarStatus.None,
            });
          });
        });
      }
    });
  });

  onDestroy(async () => {
    gameRef.scene?.destroy();
    gameRef.game?.destroy(true);
    removeEventListener('contextmenu', handleContextMenu);
    removeEventListener('wheel', handleWheel);
    removeEventListener('resize', handleResize);
    removeEventListener('orientationchange', handleResize);
    if (performanceStats) {
      gameRef.scene?.events.off('preupdate', performanceStats.begin);
      gameRef.scene?.events.off('render', performanceStats.end);
      document.body.removeChild(performanceStats.dom);
    }
  });

  const exit = () => {
    localStorage.removeItem('player');
    if (IS_TAURI) {
      import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
        import('@tauri-apps/api/window').then(({ ProgressBarStatus }) => {
          getCurrentWebviewWindow().setProgressBar({
            status: ProgressBarStatus.None,
          });
        });
      });
    }
    if (!config || config.newTab) {
      if (IS_TAURI) {
        import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
          getCurrentWebviewWindow().close();
        });
      } else {
        window.close();
      }
    } else {
      goto(
        `${base}/${IS_TAURI_LIKE || Capacitor.getPlatform() !== 'web' ? `?t=${Date.now()}` : ''}`,
      );
    }
  };

  const updateMarkers = () => {
    if (regions && gameRef.scene) {
      regions.clearRegions();
      const timeUtil = gameRef.scene.timeUtil;
      [...gameRef.scene.notes]
        .sort((a, b) =>
          a.note.type === b.note.type
            ? a.note.startBeat - b.note.startBeat
            : NOTE_PRIORITIES[a.note.type] - NOTE_PRIORITIES[b.note.type],
        )
        .forEach((note) => {
          regions?.addRegion({
            start: timeUtil.getTimeSec(note.note.startBeat) + offset / 1000,
            end:
              timeUtil.getTimeSec(
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

  /**
   * Recover the original name of a song/illustration file for storage.
   *
   * The config carries the import-time name when known (`resources.songName`
   * / `resources.illustrationName`); otherwise fall back to the chart's own
   * `META` file name. Never derive it from a blob URL — that yields the
   * random UUID that re-exports would otherwise ship. When the chosen name
   * has no extension, one is appended from the actual blob MIME type.
   */
  const resolveResourceName = (
    preferred: string | undefined,
    metaName: string | undefined,
    blob: Blob,
    fallback: string,
  ) => {
    const extensionFor = (type: string) => {
      const overrides: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
      return overrides[type] ?? mime.getExtension(type) ?? undefined;
    };
    const base = (preferred || metaName)?.split(/[\\/]/).pop()?.trim();
    if (base) {
      if (/\.[A-Za-z0-9]{1,5}$/.test(base)) return base;
      const ext = extensionFor(blob.type);
      return ext ? `${base}.${ext}` : base;
    }
    const ext = extensionFor(blob.type);
    return ext ? `${fallback}.${ext}` : fallback;
  };

  /**
   * Serialize the current chart, optionally overriding the baked-in
   * `META.offset` (the live scene keeps the displayed value either way).
   */
  const serializeChart = (bakedOffset?: number): string => {
    const chart = gameRef.scene?.chart;
    if (!chart) return '';
    const displayedOffset = chart.META.offset;
    if (bakedOffset !== undefined && bakedOffset !== displayedOffset) {
      chart.META.offset = bakedOffset;
    }
    try {
      return JSON.stringify(chart, (key, value) => {
        if (
          key === 'startBeat' ||
          key === 'endBeat' ||
          key === 'startTimeSec' ||
          key === 'endTimeSec' ||
          // Runtime-only precomputed fields (see processEvents in
          // player/utils.ts): eased-evaluation constants, sample tables and
          // speed-integral tables. They are derived from the chart at load
          // time and must never be persisted into an exported chart.
          key.startsWith('__')
        ) {
          return undefined;
        }
        return value;
      });
    } finally {
      chart.META.offset = displayedOffset;
    }
  };

  const saveOffsetAdjustedChart = async () => {
    const resources = config?.resources;
    const c = config;
    if (!resources || !c || !gameRef.scene?.chart) return;
    // In an embedded iframe the parent site explicitly asks for the file.
    if (IS_IFRAME) {
      triggerDownload(
        new Blob([serializeChart()], { type: 'application/json' }),
        `${title} [${level}] (offset ${offset >= 0 ? '+' : '-'}${Math.abs(offset).toFixed(0)}).json`,
        'adjustedOffset',
      );
      isOffsetAdjustedChartExported = true;
      return;
    }
    try {
      const fetchBlob = async (url: string) => await (await fetch(url)).blob();
      const [songBlob, illustrationBlob] = await Promise.all([
        fetchBlob(resources.song),
        fetchBlob(resources.illustration),
      ]);
      const assetFiles = await Promise.all(
        resources.assets.map(async (url, i) => ({
          name: resources.assetNames[i],
          type: resources.assetTypes[i],
          file: new File([await fetchBlob(url)], resources.assetNames[i]),
          included: true,
        })),
      );
      const chartName = `${(title ?? 'chart').replaceAll(/[\\/:*?"<>|]/g, '')} [${level ?? ''}].json`;
      const chart = gameRef.scene.chart;
      const songName = resolveResourceName(c.resources.songName, chart.META.song, songBlob, 'song');
      const illustrationName = resolveResourceName(
        c.resources.illustrationName,
        chart.META.background,
        illustrationBlob,
        'illustration',
      );
      // The offset helper calibrates the total audible offset, while normal
      // playback adds the global chartOffset preference on top of the chart's
      // baked-in META.offset. Store the value without the preference so that
      // reopening the chart reproduces exactly what was calibrated.
      const bakedOffset = chart.META.offset - (c.preferences.chartOffset ?? 0);
      const stored: StoredChart = {
        id: c.chartId ?? uuid(),
        createdAt: c.chartCreatedAt ?? Date.now(),
        updatedAt: Date.now(),
        sourceName: c.sourceName,
        metadata: c.metadata,
        resources: {
          chart: new File([serializeChart(bakedOffset)], chartName, { type: 'application/json' }),
          song: new File([songBlob], songName, { type: songBlob.type }),
          illustration: new File([illustrationBlob], illustrationName, {
            type: illustrationBlob.type,
          }),
        },
        assets: assetFiles,
      };
      stored.checksum = await computeChartChecksum(stored);
      // Charts opened from a URL have no storage id; repeated saves of the
      // same adjustment should update the existing record instead of piling
      // up copies in storage.
      if (!c.chartId) {
        const existing = (await loadAllChartSummaries()).find(
          (summary) => summary.checksum === stored.checksum,
        );
        if (existing) {
          stored.id = existing.id;
          stored.createdAt = existing.createdAt;
        }
      }
      await syncChart(stored);
      // Tell the landing page to reload this chart (it may be open in
      // another window), so reopening it applies the adjusted offset
      // instead of the stale original.
      localStorage.setItem('reloadChartId', stored.id);
      isOffsetAdjustedChartExported = true;
      notify(m.offset_adjusted_saved(), 'success');
    } catch (e) {
      console.warn('Failed to save offset-adjusted chart:', e);
      notify(String(e), 'failure');
    }
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
      class="player-action-surface p-3 flex flex-col gap-3 justify-center items-center uppercase"
    >
      {#if renderingOutput}
        {#if IS_TAURI_LIKE}
          <div class="flex w-full max-w-sm gap-2">
            <Button
              variant="ghost"
              size="lg"
              class="player-action flex-1"
              onclick={async () => {
                await openPath(renderingOutput);
              }}
            >
              <FileIcon class="size-5" />
              {m.open_file()}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              class="player-action flex-1"
              onclick={async () => {
                const separator = await pathSep();
                await openPath(renderingOutput.split(separator).slice(0, -1).join(separator));
              }}
            >
              <FolderOpenIcon class="size-5" />
              {m.open_folder()}
            </Button>
          </div>
        {/if}
      {:else}
        <Button
          variant="ghost"
          size="lg"
          class="player-action"
          onclick={async () => {
            await gameRef.scene?.chartRenderer.cancel();
          }}
        >
          <XIcon class="size-5" />
          {m.cancel()}
        </Button>
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
    <Button
      variant="ghost"
      size="lg"
      class="player-action h-12 px-6 text-lg"
      onclick={() => {
        setTimeout(() => {
          showStart = false;
        }, 500);
        gameRef.scene?.start();
      }}
    >
      <PlayIcon class="size-6 fill-current" />
      {m.start()}
    </Button>
  {:else if showPause}
    <div class="flex flex-col gap-4 items-center">
      <h2
        class="bg-gradient-to-r from-violet-200 via-white to-fuchsia-200 bg-clip-text text-6xl font-bold uppercase text-transparent"
      >
        {m.paused()}
      </h2>
      <div class="player-action-surface flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="player-action player-action-icon trans"
          aria-label={!config || config.newTab ? m.close() : 'Home'}
          onclick={exit}
        >
          {#if !config || config.newTab}
            <XIcon class="size-6" />
          {:else}
            <HouseIcon class="size-6" />
          {/if}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          class="player-action trans"
          onclick={() => {
            setTimeout(() => {
              showPause = false;
            }, 500);
            status = GameStatus.LOADING;
            gameRef.scene?.restart();
          }}
        >
          <RotateCwIcon class="size-5" />
          {m.restart()}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          class="player-action trans"
          onclick={() => {
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
          <PlayIcon class="size-5 fill-current" />
          {m.resume()}
        </Button>
      </div>
    </div>
  {/if}
</div>

{#if rotationPromptVisible}
  <div
    class="absolute inset-0 z-50 flex flex-col justify-center items-center gap-6 p-8 text-center bg-black/70 backdrop-blur-2xl"
  >
    <Button
      variant="ghost"
      size="icon"
      class="player-action player-action-icon absolute top-5 right-5"
      aria-label={m.close()}
      onclick={dismissRotationPrompt}
    >
      <XIcon class="size-6" />
    </Button>
    <div class="rotate-device-animation text-7xl">
      <SmartphoneIcon class="size-24" />
    </div>
    <h2 class="text-4xl font-bold">{m.rotate_device()}</h2>
    <span class="text-xl opacity-70">{m.rotate_device_description()}</span>
  </div>
{/if}

{#if allowSeek}
  <div
    class="progress-area absolute bottom-5 px-4 py-2 w-[75vw] flex flex-col gap-4 opacity-0 trans {enableOffsetHelper
      ? 'rounded-3xl'
      : 'rounded-full'}"
    class:progress-area-active={progressBarHeld}
    class:progress-area-hoverable={enableOffsetHelper}
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
            onpointerdown={() => {
              gameRef.scene?.pause(true);
            }}
            role="complementary"
          ></div>
        </div>
        <div class="flex flex-col gap-2 items-center min-w-fit" bind:this={offsetElement}>
          <span class="offset-text offset-without-ms">
            {offset >= 0 ? '+' : '-'}{Math.abs(offset).toFixed(0)}
          </span>
          <span class="offset-text offset-with-ms">
            {offset >= 0 ? '+' : '-'}{Math.abs(offset).toFixed(0)} ms
          </span>
          <div
            class="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-1 shadow-lg backdrop-blur-xl"
          >
            <div class="player-segment-group">
              {#each Array(6) as _, i}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="player-segment border-r border-white/10 last:border-r-0"
                  aria-label={[
                    'Decrease offset by 50 milliseconds',
                    'Decrease offset by 10 milliseconds',
                    'Decrease offset by 1 millisecond',
                    'Increase offset by 1 millisecond',
                    'Increase offset by 10 milliseconds',
                    'Increase offset by 50 milliseconds',
                  ][i]}
                  onclick={() => {
                    offset += [-50, -10, -1, 1, 10, 50][i];
                    isOffsetAdjustedChartExported = false;
                    EventBus.emit('offset-adjusted', offset);
                    updateMarkers();
                  }}
                  onmousedown={(e) => {
                    e.preventDefault();
                  }}
                >
                  {#if i === 0}
                    <ChevronsLeftIcon class="size-4" />
                  {:else if i === 1}
                    <ChevronLeftIcon class="size-4" />
                  {:else if i === 2}
                    <MinusIcon class="size-4" />
                  {:else if i === 3}
                    <PlusIcon class="size-4" />
                  {:else if i === 4}
                    <ChevronRightIcon class="size-4" />
                  {:else if i === 5}
                    <ChevronsRightIcon class="size-4" />
                  {/if}
                </Button>
              {/each}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              class="player-segment-action"
              aria-label={m.save_offset_chart()}
              title={m.save_offset_chart()}
              onclick={() => {
                saveOffsetAdjustedChart();
              }}
              onmousedown={(e) => {
                e.preventDefault();
              }}
            >
              <SaveIcon class="size-4" />
            </Button>
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
        class="range cursor-default w-full"
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
        onpointerdown={() => {
          progressBarHeld = true;
          if (!keyboardSeeking && !showPause) {
            pausedByBar = true;
            gameRef.scene?.pause(true);
          }
        }}
        onpointerup={() => {
          progressBarHeld = false;
          if (pausedByBar) {
            pausedByBar = false;
            gameRef.scene?.resume();
          }
        }}
        oninput={(e) => {
          gameRef.scene?.setSeek(Math.max(0, parseFloat(e.currentTarget.value)));
        }}
      />
      <span class="text-3xl min-w-24 text-right">{convertTime(duration, true)}</span>
    </div>
  </div>
  <div
    class="player-speed-surface absolute right-5 opacity-0 trans"
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
    <Button
      variant="ghost"
      size="icon"
      class="player-speed-button"
      aria-label="Speed up"
      onclick={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = Math.min(9.9, gameRef.scene.timeScale + 0.1);
        if (wavesurferOptions) {
          wavesurferOptions.minPxPerSec /= gameRef.scene.timeScale;
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      onmousedown={(e) => {
        e.preventDefault();
      }}
    >
      <PlusIcon class="size-6" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="player-speed-button text-base font-semibold tabular-nums"
      aria-label="Reset to normal speed"
      onclick={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = 1;
        if (wavesurferOptions) {
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      onmousedown={(e) => {
        e.preventDefault();
      }}
    >
      {gameRef.scene &&
      !equal(gameRef.scene.timeScale, parseFloat(gameRef.scene.timeScale.toFixed(1)))
        ? '~'
        : '×'}
      {gameRef.scene ? gameRef.scene.timeScale.toFixed(1) : '?'}
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="player-speed-button"
      aria-label="Speed down"
      onclick={() => {
        if (!gameRef.scene) return;
        if (wavesurferOptions) wavesurferOptions.minPxPerSec *= gameRef.scene.timeScale;
        gameRef.scene.timeScale = Math.max(0.1, gameRef.scene.timeScale - 0.1);
        if (wavesurferOptions) {
          wavesurferOptions.minPxPerSec /= gameRef.scene.timeScale;
          wavesurfer?.setOptions(wavesurferOptions);
        }
      }}
      onmousedown={(e) => {
        e.preventDefault();
      }}
    >
      <MinusIcon class="size-6" />
    </Button>
  </div>
{/if}

{#if timeSec === duration}
  <div
    class="absolute bottom-5 right-5 opacity-0 trans flex flex-col gap-4"
    class:opacity-100={status === GameStatus.FINISHED || stillLoading}
    class:pointer-events-none={status !== GameStatus.FINISHED && !stillLoading}
  >
    {#if status === GameStatus.FINISHED && !config?.render}
      <Button
        variant="ghost"
        size="icon"
        class="player-action player-action-icon"
        aria-label="Restart"
        onclick={() => {
          status = GameStatus.LOADING;
          gameRef.scene?.restart();
        }}
      >
        <RotateCwIcon class="size-6" />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="player-action player-action-icon"
      aria-label={!config || config.newTab ? 'Close' : 'Home'}
      onclick={exit}
    >
      {#if !config || config.newTab}
        <XIcon class="size-6" />
      {:else}
        <HouseIcon class="size-6" />
      {/if}
    </Button>
  </div>
{/if}

<div id="player" class="w-full h-full"></div>

<style lang="postcss">
  @reference "tailwindcss";
  :global(canvas) {
    @apply touch-none;
  }
  .trans {
    transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
    @apply transition duration-300;
  }
  .player-action-surface {
    @apply rounded-2xl border border-white/10 bg-black/20 p-1.5 shadow-xl backdrop-blur-xl;
  }
  :global(.player-action) {
    @apply h-10 rounded-full border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white/90 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/10 hover:text-white hover:shadow-lg focus-visible:ring-2 focus-visible:ring-white/40;
  }
  :global(.player-action-icon) {
    @apply h-10 w-10 p-0;
  }
  :global(.player-segment-group) {
    @apply flex overflow-hidden rounded-xl border border-white/10 bg-white/5;
  }
  :global(.player-segment) {
    @apply h-8 w-8 rounded-none p-0 text-white/70 hover:bg-white/10 hover:text-white;
  }
  :global(.player-segment-action) {
    @apply h-8 w-8 rounded-xl border border-white/10 bg-white/5 p-0 text-white/70 hover:bg-white/10 hover:text-white;
  }
  :global(.player-speed-surface) {
    @apply flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/20 p-1 shadow-xl backdrop-blur-xl;
  }
  :global(.player-speed-button) {
    @apply h-9 w-12 rounded-xl p-0 text-white/80 hover:bg-white/10 hover:text-white;
  }
  .progress-area {
    @apply bg-black/10 shadow-lg shadow-black/10;
    border: 1px solid transparent;
    transition-property:
      backdrop-filter,
      -webkit-backdrop-filter,
      border-color,
      background-color,
      box-shadow,
      opacity;
    transition-duration: 300ms;
    transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
  }
  .progress-area-active,
  .progress-area-hoverable:hover {
    border-color: rgb(255 255 255 / 0.16);
  }
  .rotate-device-animation {
    animation: rotate-device 2s ease-in-out infinite;
  }
  @keyframes rotate-device {
    0% {
      transform: rotate(-90deg);
    }
    50% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(-90deg);
    }
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
