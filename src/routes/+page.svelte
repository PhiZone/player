<script lang="ts">
  import JSZip from 'jszip';
  import mime from 'mime/lite';
  import { onMount } from 'svelte';
  import queryString from 'query-string';
  import { fileTypeFromBlob } from 'file-type';
  import type { Config, Metadata, RecorderOptions, RpeJson } from '../player/types';
  import { clamp, inferLevelType, isZip } from '../player/utils';
  import PreferencesModal from '$lib/components/Preferences.svelte';
  import { goto } from '$app/navigation';
    import { Capacitor } from '@capacitor/core';

  interface FileEntry {
    id: number;
    file: File;
    url?: string;
  }

  interface ChartBundle {
    id: number;
    song: number;
    chart: number;
    illustration: number;
    metadata: Metadata;
  }

  const VERSION = '0.0.2';
  const REPO_LINK = 'https://github.com/PhiZone/player';

  let showCollapse = false;
  let showRecorderCollapse = false;
  let overrideResolution = false;
  let directoryInput: HTMLInputElement;

  let progress = -1;
  let progressDetail = '';
  let showProgress = true;
  let done = false;

  let selectedChart = -1;
  let selectedSong = -1;
  let selectedIllustration = -1;
  let selectedBundle = -1;
  let currentBundle: ChartBundle;
  let preferences = {
    aspectRatio: null,
    backgroundBlur: 1,
    backgroundLuminance: 0.5,
    chartFlipping: 0,
    chartOffset: 0,
    fcApIndicator: true,
    goodJudgment: 160,
    hitSoundVolume: 1,
    musicVolume: 1,
    noteSize: 1,
    perfectJudgment: 80,
    simultaneousNoteHint: true,
  };
  let toggles = {
    autostart: false,
    autoplay: false,
    practice: false,
    adjustOffset: false,
    record: false,
    newTab: false,
    fullscreen: true,
  };
  let recorderOptions: RecorderOptions = {
    frameRate: 60,
    overrideResolution: [1620, 1080],
    endingLoopsToRecord: 1,
    outputFormat: 'mp4',
    videoBitrate: 6000,
    audioBitrate: 320,
  };
  let recorderResolutionWidth = 1620;
  let recorderResolutionHeight = 1080;

  let chartFiles: FileEntry[] = [];
  let audioFiles: FileEntry[] = [];
  let imageFiles: FileEntry[] = [];
  let assets: {
    id: number;
    type: number;
    file: File;
    included: boolean;
  }[] = [];
  let chartBundles: ChartBundle[] = [];

  let timeouts: NodeJS.Timeout[] = [];

  onMount(() => {
    directoryInput.webkitdirectory = true;
    const pref = localStorage.getItem('preferences');
    const tgs = localStorage.getItem('toggles');
    const rec = localStorage.getItem('recorderOptions');
    if (pref) {
      preferences = JSON.parse(pref);
    }
    if (tgs) {
      toggles = JSON.parse(tgs);
    }
    if (rec) {
      recorderOptions = JSON.parse(rec);
      if (recorderOptions.overrideResolution && recorderOptions.overrideResolution.length === 2) {
        overrideResolution = true;
        recorderResolutionWidth = recorderOptions.overrideResolution[0];
        recorderResolutionHeight = recorderOptions.overrideResolution[1];
      }
    }
  });

  const shareId = (a: FileEntry, b: FileEntry) =>
    a.file.name.split('.').slice(0, -1).join('.') === b.file.name.split('.').slice(0, -1).join('.');
  const isIncluded = (name: string) =>
    !name.toLowerCase().startsWith('autosave') && name !== 'createTime.txt';

  const resetProgress = () => {
    timeouts.forEach((id) => clearTimeout(id));
    showProgress = true;
    timeouts = [];
  };

  const decompress = async (blob: Blob) => {
    resetProgress();
    const zip = await JSZip.loadAsync(blob);
    const files: File[] = [];

    for (const [fileName, zipEntry] of Object.entries(zip.files)) {
      if (!zipEntry.dir) {
        const content = await zipEntry.async('blob', (metadata) => {
          progress = clamp(metadata.percent / 100, 0, 1);
          progressDetail = `Extracting ${fileName}`;
        });
        const file = new File([content], fileName);
        files.push(file);
      }
    }

    return files;
  };

  const getFileType = (mime: string | null, fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop() ?? '';
    const isGLSLShader = ['shader', 'glsl', 'frag', 'fsh', 'fs'].includes(extension);
    if (mime?.startsWith('image/')) {
      return 0;
    }
    if (mime?.startsWith('audio/')) {
      return 1;
    }
    if (mime?.startsWith('video/')) {
      return 2;
    }
    if (
      (!isGLSLShader && mime?.startsWith('text/')) ||
      mime === 'application/json' ||
      ['yml', 'yaml'].includes(extension)
    ) {
      return 3;
    }
    return isGLSLShader ? 4 : 5;
  };

  const createBundle = async (
    chartFile: FileEntry,
    songFile?: FileEntry,
    illustrationFile?: FileEntry,
    infoId?: number,
    fallback: boolean = false,
    silent: boolean = true,
  ) => {
    songFile ??= audioFiles.find((file) => shareId(file, chartFile));
    if (songFile === undefined) {
      if (!fallback) {
        if (!silent) alert('No song found for chart ' + chartFile.file.name + '!');
        return;
      }
      songFile = audioFiles[0];
    }
    illustrationFile ??= imageFiles.find((file) => shareId(file, chartFile));
    if (illustrationFile === undefined) {
      if (!fallback) {
        if (!silent) alert('No illustration found for chart ' + chartFile.file.name + '!');
        return;
      }
      illustrationFile = imageFiles[0];
    }
    const chart = JSON.parse(await chartFile.file.text()) as RpeJson;
    const bundle = {
      id: Date.now(),
      song: songFile.id,
      chart: chartFile.id,
      illustration: illustrationFile.id,
      metadata: {
        title: chart.META.name,
        composer: chart.META.composer,
        charter: chart.META.charter,
        illustrator: chart.META.illustration ?? null,
        level: chart.META.level,
        levelType: inferLevelType(chart.META.level),
        difficulty: null,
      },
    };
    chartBundles.push(bundle);
    chartBundles = chartBundles;
    if (infoId) {
      assets = assets.filter(
        (a) =>
          a.id !== chartFile.id &&
          a.id !== songFile?.id &&
          a.id !== illustrationFile?.id &&
          a.id !== infoId,
      );
    }
    return bundle;
  };

  const handleFiles = async (files: File[] | null) => {
    if (!files || files.length === 0) {
      return;
    }
    resetProgress();
    progressDetail = 'Processing files';
    await Promise.all(
      files.map(async (file, i) => {
        const id = Date.now() + i;
        let mimeType: string | null = null;
        try {
          mimeType = (await fileTypeFromBlob(file))?.mime.toString() ?? mime.getType(file.name);
        } catch (e) {
          console.error(e);
          mimeType = mime.getType(file.name);
        }
        const type = getFileType(mimeType, file.name);
        if (mimeType === 'application/json') {
          try {
            const json = JSON.parse(await file.text());
            if (json.META) {
              chartFiles.push({ id, file });
            }
          } catch {}
        } else if (type === 0) {
          imageFiles.push({ id, file, url: URL.createObjectURL(file) });
        } else if (type === 1) {
          audioFiles.push({ id, file });
        }
        assets.push({ id, type, file, included: isIncluded(file.name) });
      }),
    );
    const fields = ['Song:', 'Picture:', 'Chart:'];
    progressDetail = 'Seeking for charts';
    const textAssets = assets.filter((asset) => asset.type === 3);
    for (let i = 0; i < textAssets.length; i++) {
      progress = i / textAssets.length;
      const asset = textAssets[i];
      const lines = (await asset.file.text()).split(/\r?\n/);
      if (
        lines[0] === '#' &&
        fields.every((val) => lines.findIndex((line) => line.startsWith(val)) !== -1)
      ) {
        const values = fields.map((field) =>
          lines
            .find((line) => line.startsWith(field))!
            .slice(field.length)
            .trim(),
        );
        const chartFile = chartFiles.find((file) => file.file.name === values[2]);
        const songFile = audioFiles.find((file) => file.file.name === values[0]);
        const illustrationFile = imageFiles.find((file) => file.file.name === values[1]);
        if (!chartFile) continue;
        await createBundle(chartFile, songFile, illustrationFile, asset.id);
      }
    }
    if (
      chartBundles.length === 0 &&
      chartFiles.length > 0 &&
      audioFiles.length > 0 &&
      imageFiles.length > 0
    ) {
      await createBundle(chartFiles[0], undefined, undefined, undefined, true);
    }
    if (chartBundles.length > 0 && selectedBundle === -1) {
      currentBundle = chartBundles[0];
      selectedBundle = currentBundle.id;
      selectedSong = currentBundle.song;
      selectedChart = currentBundle.chart;
      selectedIllustration = currentBundle.illustration;
    }
    chartFiles = chartFiles;
    audioFiles = audioFiles;
    imageFiles = imageFiles;
    assets = assets;
    chartBundles = chartBundles;
    done = true;
    progress = 1;
    progressDetail = 'Finished';
    timeouts.push(
      setTimeout(() => {
        showProgress = false;
        timeouts.push(
          setTimeout(() => {
            progress = -1;
            progressDetail = '';
          }, 1000),
        );
      }, 1000),
    );
  };

  const getURL = (blob: Blob | undefined) => (blob ? URL.createObjectURL(blob) : null);

  const humanizeFileSize = (size: number) => {
    var i = size == 0 ? 0 : clamp(Math.floor(Math.log(size) / Math.log(1024)), 0, 4);
    return +(size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };
</script>

<div
  class="relative overflow-hidden before:absolute before:top-0 before:start-1/2 before:bg-[url('/landing/polygon-bg-element.svg')] dark:before:bg-[url('/landing/polygon-bg-element-dark.svg')] before:bg-no-repeat before:bg-top before:bg-cover before:size-full before:-z-[1] before:transform before:-translate-x-1/2"
>
  <div
    class="max-w-[85rem] min-h-screen mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-10 flex flex-col gap-5"
  >
    <div class="max-w-2xl text-center mx-auto">
      <h1
        class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200"
      >
        PhiZone
        <span class="bg-clip-text bg-gradient-to-tl from-blue-600 to-violet-600 text-transparent">
          Player
        </span>
      </h1>
    </div>

    <div class="max-w-3xl text-center mx-auto">
      <p class="text-xs sm:text-sm md:text-base lg:text-lg text-gray-600 dark:text-neutral-400">
        Play your favorites anywhere, anytime.
      </p>
    </div>

    <div class="mt-3 gap-3 flex justify-center">
      <button
        type="button"
        class="inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
        on:click={() => {
          showCollapse = !showCollapse;
        }}
      >
        Get started
        <span class="transition {showCollapse ? '-rotate-180' : 'rotate-0'}">
          <i class="fa-solid fa-angle-down fa-sm"></i>
        </span>
      </button>
      <a
        href={REPO_LINK}
        target="_blank"
        class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
      >
        View on GitHub
        <i class="fa-brands fa-github fa-xl"></i>
      </a>
    </div>

    <div
      class="collapse h-0 -mt-5 border hover:shadow-sm rounded-xl dark:border-neutral-700 dark:shadow-neutral-700/70 bg-base-200 bg-opacity-30 backdrop-blur-2xl collapse-transition"
      class:collapse-open={showCollapse}
      class:min-h-fit={showCollapse}
      class:h-full={showCollapse}
      class:mt-0={showCollapse}
      class:opacity-0={!showCollapse}
    >
      <div
        class="collapse-content flex flex-col gap-4 items-center pt-0 transition-[padding] duration-300"
        class:pt-4={showCollapse}
      >
        <div class="flex flex-col lg:flex-row">
          <label class="form-control w-full max-w-xs">
            <div class="label pt-0">
              <span class="label-text">Pick an archive (or some files)</span>
            </div>
            <input
              type="file"
              multiple
              accept=".pez,.yml,.yaml,.shader,.glsl,.frag,.fsh,.fs,application/zip,application/json,image/*,video/*,audio/*,text/*"
              class="file-input file-input-bordered w-full max-w-xs file:btn dark:file:btn-neutral file:no-animation border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600"
              on:input={async (e) => {
                const files = e.currentTarget.files;
                if (!files || files.length === 0) return;
                const fileArray = Array.from(files);
                const zipArchives = fileArray.filter(isZip);
                const regularFiles = fileArray.filter((file) => !isZip(file));
                (await Promise.all(zipArchives.map(decompress)))
                  .flat()
                  .forEach((file) => regularFiles.push(file));
                await handleFiles(regularFiles);
              }}
            />
          </label>
          <div class="divider mb-1 lg:divider-horizontal">OR</div>
          <label class="form-control w-full max-w-xs">
            <div class="label pt-0">
              <span class="label-text">Choose a folder</span>
            </div>
            <input
              bind:this={directoryInput}
              type="file"
              multiple
              class="file-input file-input-bordered w-full max-w-xs file:btn dark:file:btn-neutral file:no-animation border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600"
              on:input={async () =>
                await handleFiles(directoryInput.files ? Array.from(directoryInput.files) : null)}
            />
          </label>
        </div>
        <div
          class="w-full sm:w-5/6 md:w-3/4 lg:w-2/3 opacity-0 transition"
          class:opacity-100={progress >= 0 && showProgress}
        >
          <div class="mb-2 flex justify-between items-center">
            <h3 class="text-sm font-semibold text-gray-800 dark:text-white">
              {progressDetail ?? 'Loading'}
            </h3>
            <span class="text-sm text-gray-800 dark:text-white">
              {progress.toLocaleString(undefined, {
                style: 'percent',
                minimumFractionDigits: 0,
              })}
            </span>
          </div>
          <div
            class="flex w-full h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-neutral-700"
            role="progressbar"
            aria-valuenow={progress * 100}
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="flex flex-col justify-center rounded-full overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-blue-500"
              style="width: {progress * 100}%"
            ></div>
          </div>
        </div>
        <div
          class="w-full flex flex-col md:flex-row gap-4 opacity-0 transition"
          class:opacity-100={done}
          class:pointer-events-none={!done}
        >
          <div class="flex md:w-2/3 flex-col gap-3">
            <div class="carousel-with-bar rounded-box w-fit">
              {#key chartBundles}
                {#each chartBundles as bundle}
                  <button
                    class="carousel-item relative transition hover:brightness-75"
                    on:click={() => {
                      currentBundle = bundle;
                      selectedBundle = bundle.id;
                      selectedChart = bundle.chart;
                      selectedSong = bundle.song;
                      selectedIllustration = bundle.illustration;
                    }}
                  >
                    <img
                      class="h-48 transition"
                      src={imageFiles.find((file) => file.id === bundle.illustration)?.url}
                      class:brightness-50={selectedBundle === bundle.id}
                      alt="Illustration"
                    />
                    <div
                      class="absolute inset-0 opacity-0 transition flex justify-center items-center gap-2"
                      class:opacity-100={selectedBundle === bundle.id}
                    >
                      <span class="btn btn-xs btn-circle btn-success no-animation">
                        <i class="fa-solid fa-check"></i>
                      </span>
                      <p class="text-success">SELECTED</p>
                    </div>
                  </button>
                {/each}
              {/key}
              <button
                class="carousel-item relative w-48 h-48 bg-neutral-200 dark:bg-neutral transition hover:brightness-75"
                on:click={async () => {
                  const chart = chartFiles.find((file) => file.id === selectedChart);
                  const song = audioFiles.find((file) => file.id === selectedSong);
                  const illustration = imageFiles.find((file) => file.id === selectedIllustration);
                  if (chart && song && illustration) {
                    const bundle = await createBundle(chart, song, illustration);
                    if (!bundle) return;
                    currentBundle = bundle;
                    selectedBundle = bundle.id;
                    selectedSong = bundle.song;
                    selectedChart = bundle.chart;
                    selectedIllustration = bundle.illustration;
                  }
                }}
              >
                <div class="absolute inset-0 flex justify-center items-center gap-2">
                  <span class="btn btn-xs btn-circle btn-outline btn-active no-animation">
                    <i class="fa-solid fa-plus"></i>
                  </span>
                  <p>NEW</p>
                </div>
              </button>
            </div>
            {#if selectedBundle !== -1}
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">Title</span>
                  <div class="relative">
                    <input
                      type="text"
                      bind:value={currentBundle.metadata.title}
                      class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    />
                  </div>
                </div>
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">Composer</span>
                  <div class="relative">
                    <input
                      type="text"
                      bind:value={currentBundle.metadata.composer}
                      class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    />
                  </div>
                </div>
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">
                    Illustration designer
                  </span>
                  <div class="relative">
                    <input
                      type="text"
                      bind:value={currentBundle.metadata.illustrator}
                      class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    />
                  </div>
                </div>
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">Chart designer</span>
                  <div class="relative">
                    <input
                      type="text"
                      bind:value={currentBundle.metadata.charter}
                      class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    />
                  </div>
                </div>
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">Level type</span>
                  <div class="relative">
                    <select
                      bind:value={currentBundle.metadata.levelType}
                      class="py-3 px-4 pe-9 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    >
                      {#each ['EZ', 'HD', 'IN', 'AT', 'SP'] as levelType, i}
                        <option value={i} selected={currentBundle.metadata.levelType === i}>
                          {levelType}
                        </option>
                      {/each}
                    </select>
                  </div>
                </div>
                <div>
                  <span class="block text-sm font-medium mb-1 dark:text-white">Level</span>
                  <div class="relative">
                    <input
                      type="text"
                      bind:value={currentBundle.metadata.level}
                      class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    />
                  </div>
                </div>
              </div>
            {/if}
            {#if assets.length > 0}
              <div class="flex flex-col">
                <div class="-m-1.5 p-1.5 inline-block align-middle">
                  <table
                    class="table-fixed w-full divide-y divide-gray-200 dark:divide-neutral-700"
                  >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          class="px-3 py-2 w-1/2 sm:w-1/3 md:w-2/5 text-ellipsis overflow-hidden whitespace-nowrap text-start text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                        >
                          Asset Name
                        </th>
                        <th
                          scope="col"
                          class="px-3 py-2 w-1/4 md:w-1/5 text-ellipsis overflow-hidden whitespace-nowrap text-start text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                        >
                          Asset Type
                        </th>
                        <th
                          scope="col"
                          class="hidden sm:table-cell px-3 py-2 w-1/6 text-ellipsis overflow-hidden whitespace-nowrap text-start text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                        >
                          File Size
                        </th>
                        <th
                          scope="col"
                          class="px-3 py-2 text-ellipsis overflow-hidden whitespace-nowrap text-end text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-neutral-700">
                      {#each assets as asset}
                        <tr>
                          <td
                            class="px-3 py-3 text-ellipsis overflow-hidden whitespace-nowrap text-sm font-medium text-gray-800 dark:text-neutral-200 transition"
                            class:opacity-30={!asset.included}
                          >
                            {asset.file.name}
                          </td>
                          <td
                            class="px-2 py-3 md:min-w-fit w-1/6 text-gray-800 dark:text-neutral-200 transition"
                            class:opacity-30={!asset.included}
                          >
                            <div class="relative">
                              <select
                                bind:value={asset.type}
                                class="py-1 px-2 pe-8 block border-gray-200 rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                              >
                                {#each ['Image', 'Audio', 'Video', 'Config', 'Shader', 'Other'] as assetType, i}
                                  <option value={i} selected={asset.type === i}>
                                    {assetType}
                                  </option>
                                {/each}
                              </select>
                            </div>
                          </td>
                          <td
                            class="px-3 py-3 hidden sm:table-cell md:min-w-fit w-1/12 text-ellipsis overflow-hidden whitespace-nowrap text-sm text-gray-800 dark:text-neutral-200 transition"
                            class:opacity-30={!asset.included}
                          >
                            {humanizeFileSize(asset.file.size)}
                          </td>
                          <td class="px-3 py-3 min-w-fit text-end text-sm font-medium">
                            <button
                              type="button"
                              class="inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg transition border border-transparent text-blue-600 hover:text-blue-800 focus:outline-none focus:text-blue-800 disabled:opacity-50 disabled:pointer-events-none dark:text-blue-500 dark:hover:text-blue-400 dark:focus:text-blue-400"
                              on:click={() => {
                                asset.included = !asset.included;
                              }}
                            >
                              {asset.included ? 'Exclude' : 'Include'}
                            </button>
                            <button
                              type="button"
                              class="inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg transition border border-transparent text-blue-600 hover:text-blue-800 focus:outline-none focus:text-blue-800 disabled:opacity-50 disabled:pointer-events-none dark:text-blue-500 dark:hover:text-blue-400 dark:focus:text-blue-400"
                              on:click={() => {
                                assets = assets.filter((a) => a.id !== asset.id);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}
          </div>
          <div class="flex md:w-1/3 flex-col gap-2">
            <div class="relative">
              <select
                class="peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
                value={selectedChart}
                on:input={(e) => {
                  selectedChart = parseInt(e.currentTarget.value);
                  currentBundle.chart = selectedChart;
                  chartBundles = chartBundles;
                }}
              >
                {#each chartFiles as file}
                  <option value={file.id} selected={selectedChart == file.id}>
                    {file.file.name}
                  </option>
                {/each}
              </select>
              <span
                class="absolute top-0 start-0 p-4 h-full truncate pointer-events-none transition ease-in-out duration-100 border border-transparent dark:text-white peer-disabled:opacity-50 peer-disabled:pointer-events-none
                peer-focus:text-sm
                peer-focus:-translate-y-1.5
                peer-focus:text-gray-500 dark:peer-focus:text-neutral-500
                peer-[:not(:placeholder-shown)]:text-sm
                peer-[:not(:placeholder-shown)]:-translate-y-1.5
                peer-[:not(:placeholder-shown)]:text-gray-500 dark:peer-[:not(:placeholder-shown)]:text-neutral-500"
              >
                Chart
              </span>
            </div>
            <div class="relative">
              <select
                class="peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
                value={selectedSong}
                on:input={(e) => {
                  selectedSong = parseInt(e.currentTarget.value);
                  currentBundle.song = selectedSong;
                  chartBundles = chartBundles;
                }}
              >
                {#each audioFiles as file}
                  <option value={file.id} selected={selectedSong == file.id}>
                    {file.file.name}
                  </option>
                {/each}
              </select>
              <span
                class="absolute top-0 start-0 p-4 h-full truncate pointer-events-none transition ease-in-out duration-100 border border-transparent dark:text-white peer-disabled:opacity-50 peer-disabled:pointer-events-none
                peer-focus:text-sm
                peer-focus:-translate-y-1.5
                peer-focus:text-gray-500 dark:peer-focus:text-neutral-500
                peer-[:not(:placeholder-shown)]:text-sm
                peer-[:not(:placeholder-shown)]:-translate-y-1.5
                peer-[:not(:placeholder-shown)]:text-gray-500 dark:peer-[:not(:placeholder-shown)]:text-neutral-500"
              >
                Song
              </span>
            </div>
            <div class="relative">
              <select
                class="peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
                value={selectedIllustration}
                on:input={(e) => {
                  selectedIllustration = parseInt(e.currentTarget.value);
                  currentBundle.illustration = selectedIllustration;
                  chartBundles = chartBundles;
                }}
              >
                {#each imageFiles as file}
                  <option value={file.id} selected={selectedIllustration == file.id}>
                    {file.file.name}
                  </option>
                {/each}
              </select>
              <span
                class="absolute top-0 start-0 p-4 h-full truncate pointer-events-none transition ease-in-out duration-100 border border-transparent dark:text-white peer-disabled:opacity-50 peer-disabled:pointer-events-none
                peer-focus:text-sm
                peer-focus:-translate-y-1.5
                peer-focus:text-gray-500 dark:peer-focus:text-neutral-500
                peer-[:not(:placeholder-shown)]:text-sm
                peer-[:not(:placeholder-shown)]:-translate-y-1.5
                peer-[:not(:placeholder-shown)]:text-gray-500 dark:peer-[:not(:placeholder-shown)]:text-neutral-500"
              >
                Illustration
              </span>
            </div>
            <div class="grid space-y-3">
              <div class="relative flex items-start">
                <div class="flex items-center h-5 mt-1">
                  <input
                    id="autoplay"
                    name="autoplay"
                    type="checkbox"
                    class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                    aria-describedby="autoplay-description"
                    checked={toggles.autoplay}
                    on:input={(e) => {
                      toggles.autoplay = e.currentTarget.checked;
                      if (toggles.autoplay) {
                        toggles.practice = false;
                      }
                    }}
                  />
                </div>
                <label for="autoplay" class="ms-3">
                  <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                    Autoplay
                  </span>
                  <span
                    id="autoplay-description"
                    class="block text-sm text-gray-600 dark:text-neutral-500"
                  >
                    Notes are automatically given Perfect judgments.
                  </span>
                </label>
              </div>
              <div class="relative flex items-start">
                <div class="flex items-center h-5 mt-1">
                  <input
                    id="practice"
                    name="practice"
                    type="checkbox"
                    class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                    aria-describedby="practice-description"
                    bind:checked={toggles.practice}
                    disabled={toggles.autoplay}
                  />
                </div>
                <label for="practice" class="ms-3 transition" class:opacity-50={toggles.autoplay}>
                  <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                    Practice
                  </span>
                  <span
                    id="practice-description"
                    class="block text-sm text-gray-600 dark:text-neutral-500"
                  >
                    Both inputs and playback controls are enabled.
                  </span>
                </label>
              </div>
              <div class="flex flex-col">
                <div class="relative flex items-start">
                  <div class="flex items-center h-5 mt-1">
                    <input
                      id="record"
                      name="record"
                      type="checkbox"
                      class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                      aria-describedby="record-description"
                      bind:checked={toggles.record}
                    />
                  </div>
                  <label for="record" class="ms-3">
                    <button
                      class="flex items-center gap-1 text-sm font-semibold text-gray-800 dark:text-neutral-300"
                      on:click={() => {
                        showRecorderCollapse = !showRecorderCollapse;
                      }}
                    >
                      <p>Record</p>
                      <span class="transition {showRecorderCollapse ? '-rotate-180' : 'rotate-0'}">
                        <i class="fa-solid fa-angle-down fa-sm"></i>
                      </span>
                    </button>
                    <span
                      id="record-description"
                      class="block text-sm text-gray-600 dark:text-neutral-500"
                    >
                      The canvas will be recorded and saved as a video file.
                      <br />
                      Note that this feature is still work in progress.
                    </span>
                  </label>
                </div>
                <div
                  class="collapse h-0 border hover:shadow-sm rounded-xl dark:border-neutral-700 dark:shadow-neutral-700/70 bg-base-200 bg-opacity-30 backdrop-blur-2xl collapse-transition"
                  class:collapse-open={showRecorderCollapse}
                  class:min-h-fit={showRecorderCollapse}
                  class:h-full={showRecorderCollapse}
                  class:mt-2={showRecorderCollapse}
                  class:opacity-0={!showRecorderCollapse}
                >
                  <div
                    class="collapse-content flex flex-col gap-4 items-center pt-0 transition-[padding] duration-300"
                    class:pt-4={showRecorderCollapse}
                  >
                    <div class="grid sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-3">
                      <div>
                        <span class="block text-sm font-medium mb-1 dark:text-white">
                          Frame rate
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={recorderOptions.frameRate}
                            class="py-3 px-4 pe-12 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">FPS</span>
                          </div>
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <div class="flex justify-between items-center">
                          <span class="block text-sm font-medium mb-1 dark:text-white">
                            Override resolution
                          </span>
                          <input
                            type="checkbox"
                            class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                            bind:checked={overrideResolution}
                          />
                        </div>
                        <div class="flex rounded-lg shadow-sm">
                          <input
                            type="number"
                            class="py-3 px-4 block w-full border-gray-200 shadow-sm -ms-px first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg text-sm relative focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                            disabled={!overrideResolution}
                            bind:value={recorderResolutionWidth}
                          />
                          <span
                            class="py-3 px-2 inline-flex items-center min-w-fit border border-gray-200 text-sm text-gray-500 -ms-px w-auto first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg bg-base-100 dark:border-neutral-700 dark:text-neutral-400"
                            class:opacity-50={!overrideResolution}
                          >
                            <i class="fa-solid fa-xmark"></i>
                          </span>
                          <input
                            type="number"
                            class="py-3 px-4 block w-full border-gray-200 shadow-sm -ms-px first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg text-sm relative focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                            disabled={!overrideResolution}
                            bind:value={recorderResolutionHeight}
                          />
                        </div>
                      </div>
                      <div>
                        <span class="block text-sm font-medium mb-1 dark:text-white">
                          Output format
                        </span>
                        <div class="relative">
                          <input
                            type="text"
                            value="webm"
                            disabled
                            class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <!-- <input
                            type="text"
                            bind:value={recorderOptions.outputFormat}
                            class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          /> -->
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-sm font-medium mb-1 dark:text-white">
                          Video bitrate
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={recorderOptions.videoBitrate}
                            class="py-3 px-4 pe-14 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">Kbps</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <span class="block text-sm font-medium mb-1 dark:text-white">
                          Ending loops
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            bind:value={recorderOptions.endingLoopsToRecord}
                            class="py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-sm font-medium mb-1 dark:text-white">
                          Audio bitrate
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={recorderOptions.audioBitrate}
                            class="py-3 px-4 pe-14 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">Kbps</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="relative flex items-start">
                <div class="flex items-center h-5 mt-1">
                  <input
                    id="autostart"
                    name="autostart"
                    type="checkbox"
                    class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                    aria-describedby="autostart-description"
                    bind:checked={toggles.autostart}
                  />
                </div>
                <label for="autostart" class="ms-3">
                  <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                    Autostart
                  </span>
                  <span
                    id="autostart-description"
                    class="block text-sm text-gray-600 dark:text-neutral-500"
                  >
                    The player will attempt to start playing automatically.
                  </span>
                </label>
              </div>
              {#if '__TAURI_INTERNALS__' in window}
                <!-- <div class="relative flex items-start">
                  <div class="flex items-center h-5 mt-1">
                    <input
                      id="fullscreen"
                      name="fullscreen"
                      type="checkbox"
                      class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                      aria-describedby="fullscreen-description"
                      bind:checked={toggles.fullscreen}
                    />
                  </div>
                  <label for="fullscreen" class="ms-3">
                    <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                      Fullscreen
                    </span>
                    <span
                      id="fullscreen-description"
                      class="block text-sm text-gray-600 dark:text-neutral-500"
                    >
                      The player will be opened in fullscreen.
                    </span>
                  </label>
                </div> -->
              {:else if Capacitor.getPlatform() === 'web'}
                <div class="relative flex items-start">
                  <div class="flex items-center h-5 mt-1">
                    <input
                      id="newtab"
                      name="newtab"
                      type="checkbox"
                      class="transition border-gray-200 rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                      aria-describedby="newtab-description"
                      bind:checked={toggles.newTab}
                    />
                  </div>
                  <label for="newtab" class="ms-3">
                    <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                      New tab
                    </span>
                    <span
                      id="newtab-description"
                      class="block text-sm text-gray-600 dark:text-neutral-500"
                    >
                      The player will be opened in a new tab.
                    </span>
                  </label>
                </div>
              {/if}
            </div>
            <div class="flex gap-2">
              <PreferencesModal bind:preferences class="w-1/2" />
              <button
                class="w-1/2 inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
                on:click={() => {
                  localStorage.setItem('preferences', JSON.stringify(preferences));
                  localStorage.setItem('toggles', JSON.stringify(toggles));
                  if (toggles.record) {
                    localStorage.setItem('recorderOptions', JSON.stringify(recorderOptions));
                    if (overrideResolution) {
                      recorderOptions.overrideResolution = [
                        recorderResolutionWidth,
                        recorderResolutionHeight,
                      ];
                    } else {
                      recorderOptions.overrideResolution = null;
                    }
                  }
                  const assetsIncluded = assets.filter((asset) => asset.included);
                  const params = queryString.stringify(
                    {
                      song: getURL(audioFiles.find((file) => file.id === currentBundle.song)?.file),
                      chart: getURL(
                        chartFiles.find((file) => file.id === currentBundle.chart)?.file,
                      ),
                      illustration: imageFiles.find(
                        (file) => file.id === currentBundle.illustration,
                      )?.url,
                      assetNames: assetsIncluded.map((asset) => asset.file.name),
                      assetTypes: assetsIncluded.map((asset) => asset.type),
                      assets: assetsIncluded.map((asset) => getURL(asset.file)),
                      ...currentBundle.metadata,
                      ...preferences,
                      ...toggles,
                      ...(toggles.record ? recorderOptions : []),
                    },
                    {
                      arrayFormat: 'none',
                      skipEmptyString: true,
                      skipNull: true,
                      sort: false,
                    },
                  );
                  let url = '/play';
                  if (params.length <= 15360) {
                    url = `/play?${params}`;
                  } else {
                    const config: Config = {
                      resources: {
                        song:
                          getURL(audioFiles.find((file) => file.id === currentBundle.song)?.file) ??
                          '',
                        chart:
                          getURL(
                            chartFiles.find((file) => file.id === currentBundle.chart)?.file,
                          ) ?? '',
                        illustration:
                          imageFiles.find((file) => file.id === currentBundle.illustration)?.url ??
                          '',
                        assetNames: assetsIncluded.map((asset) => asset.file.name),
                        assetTypes: assetsIncluded.map((asset) => asset.type),
                        assets: assetsIncluded.map((asset) => getURL(asset.file) ?? ''),
                      },
                      metadata: currentBundle.metadata,
                      preferences,
                      recorderOptions,
                      ...toggles,
                    };
                    localStorage.setItem('player', JSON.stringify(config));
                  }
                  if ('__TAURI_INTERNALS__' in window && toggles.fullscreen) {
                    // TODO Command not found
                    // getCurrentWindow().setFullscreen(true);
                  } else if (Capacitor.getPlatform() === 'web' && toggles.newTab) {
                    window.open(url);
                    return;
                  }
                  goto(url);
                }}
              >
                Play
                <i class="fa-solid fa-angle-right fa-sm"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-center items-center gap-x-1 sm:gap-x-3">
      <span class="text-sm text-gray-600 dark:text-neutral-400">Version</span>
      <span class="text-sm font-bold text-gray-900 dark:text-white">
        {VERSION}
      </span>
      <svg
        class="size-5 text-gray-300 dark:text-neutral-600"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M6 13L10 3" stroke="currentColor" stroke-linecap="round" />
      </svg>
      <a
        class="inline-flex items-center gap-x-1 text-sm text-blue-600 decoration-2 hover:underline focus:outline-none focus:underline font-medium dark:text-blue-500"
        href="{REPO_LINK}/issues/new"
        target="_blank"
      >
        File an issue
        <i class="fa-solid fa-angle-right fa-sm"></i>
      </a>
    </div>
  </div>
</div>

<style>
  .collapse-transition {
    transition-property: grid-template-rows, height, opacity, border-color, shadow, margin-top;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 300ms, 300ms, 300ms, 150ms, 150ms, 300ms;
  }
  .carousel-with-bar {
    display: inline-flex;
    overflow-x: auto;
    scroll-behavior: smooth;
  }
</style>
