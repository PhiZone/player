<script context="module" lang="ts">
  import type { Game } from 'phaser';
  import type { Game as GameScene } from './scenes/Game';

  export type GameReference = {
    game: Game | null;
    scene: GameScene | null;
  };
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import start from './main';
  import { EventBus } from './EventBus';
  import { GameStatus, type Config } from './types';
  import { convertTime, getParams, outputRecording } from './utils';
  import { goto } from '$app/navigation';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

  export let gameRef: GameReference;

  export let config: Config | null = null;

  export let currentActiveScene: (scene: GameScene) => void | undefined = () => {};

  config ??= getParams();
  if (!config) {
    goto('/');
  }

  let progress = 0;
  let fileProgress = '';

  let status = GameStatus.LOADING;
  let duration = 0;
  let timeSec = 0;

  let title: string | null = null;
  let level: string | null = null;
  let credits: string[] = [];

  let showStart = false;
  let showPause = false;
  let keyboardSeeking = false;
  let allowSeek = false;
  let progressBarHeld = false;
  let countdown = 0;
  let stillLoading = false;
  let counter: NodeJS.Timeout;
  let timeout: NodeJS.Timeout;

  let gameStart: number;
  let videoRecorder: MediaRecorder | null = null;
  let audioRecorder: MediaRecorder | null = null;
  let video: Blob;
  let audio: Blob;

  onMount(() => {
    if (!config) return;
    gameRef.game = start('player', config);
    timeout = setTimeout(() => {
      stillLoading = true;
    }, 10000);

    if (config.record) {
      const videoStream = gameRef.game.canvas.captureStream();
      const peerConnection = new RTCPeerConnection();
      videoStream.getTracks().forEach((track) => peerConnection.addTrack(track, videoStream));
      videoRecorder = new MediaRecorder(videoStream, {
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: config.recorderOptions.videoBitrate * 1000,
      });
      videoRecorder.ondataavailable = (e) => {
        video = e.data;
        if (audio) {
          outputRecording(
            video,
            audio,
            Date.now() - gameStart,
            // config.recorderOptions,
          );
        }
      };
      if ('context' in gameRef.game.sound) {
        const audioDest = gameRef.game.sound.context.createMediaStreamDestination();
        gameRef.game.sound.destination.connect(audioDest);
        audioRecorder = new MediaRecorder(audioDest.stream, {
          mimeType: 'audio/webm; codecs=opus',
          audioBitsPerSecond: config.recorderOptions.audioBitrate
            ? config.recorderOptions.audioBitrate * 1000
            : undefined,
        });
        audioRecorder.ondataavailable = (e) => {
          audio = e.data;
          if (video) {
            outputRecording(
              video,
              audio,
              Date.now() - gameStart,
              // config.recorderOptions,
            );
          }
        };
      }
    }

    EventBus.on('loading', (p: number) => {
      progress = p;
    });

    EventBus.on('loading-detail', (p: string) => {
      fileProgress = p;
    });

    EventBus.on('current-scene-ready', (scene: GameScene) => {
      clearTimeout(timeout);
      stillLoading = false;
      gameRef.scene = scene;
      status = scene.status;
      duration = scene.song.duration;
      showStart = status === GameStatus.READY;
      allowSeek = scene.autoplay || scene.practice;
      const metadata = scene.metadata;
      title = metadata.title;
      level = metadata.level;
      [metadata.composer, metadata.charter, metadata.illustrator].forEach((credit) => {
        credits.push(credit ?? '');
      });
      videoRecorder?.start();
      audioRecorder?.start();
      gameStart = Date.now();

      if (currentActiveScene) {
        currentActiveScene(scene);
      }
    });
  });

  EventBus.on('update', (t: number) => {
    timeSec = t;
  });

  EventBus.on('paused', (emittedBySpace: boolean) => {
    status = GameStatus.PAUSED;
    showPause = !emittedBySpace;
    keyboardSeeking = emittedBySpace;
  });

  EventBus.on('resumed', () => {
    status = GameStatus.PLAYING;
    keyboardSeeking = false;
  });

  EventBus.on('error', () => {
    stillLoading = true;
  });

  EventBus.on('finished', () => {
    status = GameStatus.FINISHED;
  });

  EventBus.on('recording-stop', () => {
    videoRecorder?.stop();
    audioRecorder?.stop();
  });

  onDestroy(() => {
    videoRecorder?.stop();
    audioRecorder?.stop();
    gameRef.scene?.destroy();
    gameRef.game?.destroy(true);
  });

  const exit = () => {
    if (!config || config.newTab) {
      if ('__TAURI_INTERNALS__' in window) {
        getCurrentWebviewWindow().close();
      } else {
        window.close();
      }
    } else {
      goto('/');
    }
  };
</script>

<svelte:head>
  <title>
    {config?.metadata.title} [{config?.metadata.level !== null &&
    config?.metadata.difficulty !== null
      ? `${config?.metadata.level} ${config?.metadata.difficulty?.toFixed(0)}`
      : config?.metadata.level}] | PhiZone Player
  </title>
</svelte:head>

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
      {progress.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 0,
      })}
    </span>
    {#if fileProgress}
      <span class="text-xs">{fileProgress}</span>
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
        status = GameStatus.PLAYING;
        gameRef.scene?.start();
      }}
    >
      START
    </button>
  {:else if showPause}
    <div class="flex flex-col gap-4 items-center">
      <h2 class="text-6xl font-bold">PAUSED</h2>
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
            status = GameStatus.PLAYING;
            gameRef.scene?.restart();
          }}
        >
          RESTART
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
          RESUME
        </button>
      </div>
    </div>
  {/if}
</div>

{#if allowSeek}
  <div
    class="absolute bottom-5 px-4 py-2 w-[75vw] flex items-center opacity-0 trans rounded-full"
    class:opacity-50={(keyboardSeeking || showPause) &&
      status !== GameStatus.PLAYING &&
      status !== GameStatus.FINISHED}
    class:hover:opacity-100={(keyboardSeeking || showPause) &&
      status !== GameStatus.PLAYING &&
      status !== GameStatus.FINISHED}
    class:backdrop-blur-2xl={progressBarHeld}
    class:backdrop-brightness-75={progressBarHeld}
    class:pointer-events-none={status === GameStatus.PLAYING || status === GameStatus.FINISHED}
  >
    <span class="text-3xl min-w-24">{convertTime(timeSec, true)}</span>
    <input
      type="range"
      min="0"
      max={duration}
      value={timeSec}
      step="0.001"
      class="range cursor-default"
      class:hover:cursor-pointer={(keyboardSeeking || showPause) &&
        status !== GameStatus.PLAYING &&
        status !== GameStatus.FINISHED}
      disabled={(!keyboardSeeking && !showPause) ||
        status === GameStatus.PLAYING ||
        status === GameStatus.FINISHED}
      on:pointerdown={() => {
        progressBarHeld = true;
      }}
      on:pointerup={() => {
        progressBarHeld = false;
      }}
      on:input={(e) => {
        gameRef.scene?.setSeek(Math.max(0, parseFloat(e.currentTarget.value)));
      }}
    />
    <span class="text-3xl min-w-24 text-right">{convertTime(duration, true)}</span>
  </div>
{/if}

{#if timeSec === duration}
  <div
    class="absolute bottom-5 right-5 opacity-0 trans flex flex-col gap-4"
    class:opacity-100={status === GameStatus.FINISHED || stillLoading}
    class:pointer-events-none={status !== GameStatus.FINISHED && !stillLoading}
  >
    <button
      class="btn btn-outline border-2 btn-lg btn-circle"
      aria-label="Restart"
      on:click={() => {
        status = GameStatus.PLAYING;
        gameRef.scene?.restart();
      }}
    >
      <i class="fa-solid fa-arrow-rotate-right fa-xl"></i>
    </button>
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

<div id="player"></div>

<style lang="postcss">
  .trans {
    transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
    @apply transition duration-300;
  }
</style>
