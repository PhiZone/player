<script lang="ts">
  import JSZip from 'jszip';
  import mime from 'mime/lite';
  import { onMount } from 'svelte';
  import queryString from 'query-string';
  import { fileTypeFromBlob } from 'file-type';
  import type {
    BlobInputMessage,
    Config,
    IncomingMessage,
    Metadata,
    Preferences,
    RecorderOptions,
    Release,
    RpeJson,
    UrlInputMessage,
  } from '$lib/types';
  import {
    clamp,
    fit,
    getParams,
    haveSameKeys,
    inferLevelType,
    IS_ANDROID_OR_IOS,
    IS_TAURI,
    isZip,
    notify,
    send,
    versionCompare,
  } from '$lib/utils';
  import PreferencesModal from '$lib/components/Preferences.svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
  import { currentMonitor, type Monitor } from '@tauri-apps/api/window';
  import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
  import { platform, arch } from '@tauri-apps/plugin-os';
  import { App, type URLOpenListenerEvent } from '@capacitor/app';
  import { page } from '$app/stores';
  import { REPO_API_LINK, REPO_LINK, VERSION } from '$lib';
  import { SendIntent } from 'send-intent';
  import { Filesystem } from '@capacitor/filesystem';
  import { tempDir } from '@tauri-apps/api/path';
  import { download as tauriDownload } from '@tauri-apps/plugin-upload';
  import { readFile, remove } from '@tauri-apps/plugin-fs';
  import { random } from 'mathjs';
  import { base } from '$app/paths';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';

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

  let showCollapse = false;
  let showRecorderCollapse = false;
  let overrideResolution = false;
  let modalMem = false;
  let directoryInput: HTMLInputElement;
  let modal: HTMLDialogElement;
  let monitor: Monitor | null = null;

  let progress = -1;
  let progressSpeed = -1;
  let progressDetail = '';
  let showProgress = true;
  let done = false;

  let selectedChart = -1;
  let selectedSong = -1;
  let selectedIllustration = -1;
  let selectedBundle = -1;
  let currentBundle: ChartBundle;
  let preferences: Preferences = {
    aspectRatio: null,
    backgroundBlur: 1,
    backgroundLuminance: 0.5,
    chartFlipping: 0,
    chartOffset: 0,
    fcApIndicator: true,
    goodJudgment: 160,
    hitSoundVolume: 1,
    lineThickness: 1,
    musicVolume: 1,
    noteSize: 1,
    perfectJudgment: 80,
    simultaneousNoteHint: true,
    timeScale: 1,
  };
  let toggles = {
    autostart: false,
    autoplay: false,
    practice: false,
    adjustOffset: false,
    record: false,
    newTab: false,
    inApp: IS_TAURI || Capacitor.getPlatform() !== 'web' ? 2 : 0,
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

  onMount(async () => {
    if (directoryInput) directoryInput.webkitdirectory = true;

    init();

    addEventListener('message', async (e: MessageEvent<IncomingMessage>) => {
      const message = e.data;
      if (!message || !message.type) return;
      if (message.type === 'play') {
        let config: Config;
        if ('resources' in message.payload) {
          config = message.payload;
        } else {
          const assetsIncluded = assets.filter((asset) => asset.included);
          const { preferences: pref, recorderOptions: rec, ...rest } = message.payload;
          for (const key in rest) {
            if (rest[key as keyof typeof rest]) {
              toggles[key as keyof typeof toggles] = rest[key as keyof typeof rest] as never;
            }
          }
          config = {
            resources: {
              song: getUrl(audioFiles.find((file) => file.id === currentBundle.song)?.file) ?? '',
              chart: getUrl(chartFiles.find((file) => file.id === currentBundle.chart)?.file) ?? '',
              illustration:
                imageFiles.find((file) => file.id === currentBundle.illustration)?.url ?? '',
              assetNames: assetsIncluded.map((asset) => asset.file.name),
              assetTypes: assetsIncluded.map((asset) => asset.type),
              assets: assetsIncluded.map((asset) => getUrl(asset.file) ?? ''),
            },
            metadata: currentBundle.metadata,
            preferences: pref ?? preferences,
            recorderOptions: rec ?? recorderOptions,
            ...toggles,
          };
        }
        handleParams(config);
      } else if (
        message.type === 'zipInput' ||
        message.type === 'fileInput' ||
        message.type === 'zipUrlInput' ||
        message.type === 'fileUrlInput'
      ) {
        showCollapse = true;
        const files: File[] = [];
        let replacee: number | undefined = undefined;
        if (message.type.includes('Url')) {
          const payload = (e.data as UrlInputMessage).payload;
          replacee = payload.replacee;
          if (message.type === 'zipUrlInput') {
            files.push(...(await decompressZipArchives(await downloadUrls(payload.input))));
          } else if (message.type === 'fileUrlInput') {
            files.push(...(await downloadUrls(payload.input)));
          }
        } else {
          const payload = (e.data as BlobInputMessage).payload;
          replacee = payload.replacee;
          if (message.type === 'zipInput') {
            files.push(
              ...(await decompressZipArchives(
                payload.input.map((blob) => new File([blob], 'archive.zip')),
              )),
            );
          } else if (message.type === 'fileInput') {
            files.push(...payload.input.map((blob) => new File([blob], 'file')));
          }
        }
        await handleFiles(files, replacee);
      }
    });

    if (IS_TAURI) {
      onOpenUrl((urls) => {
        handleRedirect(urls[0]);
      });
      listen('incoming-files', async (event) => {
        const filePaths = event.payload as string[];
        console.log(filePaths);
        await handleFilePaths(filePaths);
      });
      const result = await invoke('get_incoming_files');
      if (result) {
        console.log('Incoming files', result);
        await handleFilePaths(result as string[]);
      }
    }

    if (Capacitor.getPlatform() !== 'web') {
      App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
        handleRedirect(event.url);
      });
      SendIntent.checkSendIntentReceived()
        .then((result) => {
          if (result) {
            console.log('SendIntent received');
            console.log(JSON.stringify(result));
          }
          if (result.url) {
            let resultUrl = decodeURIComponent(result.url);
            Filesystem.readFile({ path: resultUrl })
              .then((content) => {
                decompress(content.data as Blob).then((files) => {
                  handleFiles(files);
                });
              })
              .catch((err) => console.error(err));
          }
        })
        .catch((err) => console.error(err));
    }

    send({
      type: 'event',
      payload: {
        name: 'ready',
      },
    });
  });

  const init = async () => {
    if (!$page.url.searchParams.get('t')) {
      const url = IS_TAURI ? (await getCurrent())?.at(0) : undefined;
      if (url) {
        const params = getParams(url, false);
        if (params) {
          handleParams(params);
          return;
        }
        const searchParams = new URL(url).searchParams;
        handleParamFiles(searchParams);
      }

      if (IS_TAURI || Capacitor.getPlatform() !== 'web') {
        const latestRelease = (await (
          await fetch(`${REPO_API_LINK}/releases/latest`)
        ).json()) as Release;
        if (versionCompare(latestRelease.tag_name.slice(1), VERSION) > 0) {
          const clickToDownload =
            (IS_TAURI && platform() === 'windows') ||
            platform() === 'macos' ||
            Capacitor.getPlatform() === 'android';
          notify(
            `A new version (${latestRelease.tag_name}) is available. ${clickToDownload ? 'Click to download.' : Capacitor.getPlatform() === 'ios' ? 'Please update the app via TestFlight.' : 'Click to go to the GitHub releases page.'}`,
            Capacitor.getPlatform() === 'ios'
              ? undefined
              : () => {
                  if (clickToDownload) {
                    const isWindows = platform() === 'windows';
                    const isX86 = arch().startsWith('x86');
                    const asset = latestRelease.assets.find((asset) =>
                      asset.name.endsWith(
                        Capacitor.getPlatform() === 'android'
                          ? '.apk'
                          : isWindows
                            ? isX86
                              ? 'x64-setup.exe'
                              : 'arm64-setup.exe'
                            : isX86
                              ? 'x64.dmg'
                              : 'aarch64.dmg',
                      ),
                    );
                    if (asset) {
                      window.location.href = asset?.browser_download_url;
                      return;
                    }
                  }
                  window.open(latestRelease.html_url);
                },
          );
        }
      }
    }

    let pref, tgs, rec;
    pref = localStorage.getItem('preferences');
    tgs = localStorage.getItem('toggles');
    rec = localStorage.getItem('recorderOptions');

    if (pref) {
      pref = JSON.parse(pref);
      if (haveSameKeys(pref, preferences)) preferences = pref;
    }
    if (tgs) {
      tgs = JSON.parse(tgs);
      if (haveSameKeys(tgs, toggles)) toggles = tgs;
    }
    if (rec) {
      rec = JSON.parse(rec);
      if (haveSameKeys(rec, recorderOptions)) recorderOptions = rec;
    }

    if (recorderOptions.overrideResolution && recorderOptions.overrideResolution.length === 2) {
      overrideResolution = true;
      recorderResolutionWidth = recorderOptions.overrideResolution[0];
      recorderResolutionHeight = recorderOptions.overrideResolution[1];
    }

    if (
      !IS_TAURI &&
      Capacitor.getPlatform() === 'web' &&
      ($page.url.searchParams.has('file') || $page.url.searchParams.has('zip'))
    ) {
      if (toggles.inApp === 0) {
        modal.showModal();
      } else if (toggles.inApp === 1) {
        window.open(
          `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${$page.url.search}`,
        );
      } else {
        handleParamFiles($page.url.searchParams);
      }
    }
  };

  const handleRedirect = (url: string) => {
    const params = getParams(url, false);
    if (params) {
      handleParams(params);
    } else {
      const searchParams = new URL(url).searchParams;
      handleParamFiles(searchParams);
    }
  };

  const handleFilePaths = async (filePaths: string[]) => {
    let promises = await Promise.allSettled(
      filePaths.map(async (filePath) => {
        const data = await readFile(filePath);
        return new File([data], filePath.split('/').pop() ?? filePath);
      }),
    );
    handleFiles(
      promises
        .filter((promise) => promise.status === 'fulfilled')
        .map((promise) => (promise as PromiseFulfilledResult<File>).value),
    );
  };

  const shareId = (a: FileEntry, b: FileEntry) =>
    a.file.name.split('.').slice(0, -1).join('.') === b.file.name.split('.').slice(0, -1).join('.');

  const isIncluded = (name: string) =>
    !name.toLowerCase().startsWith('autosave') && name !== 'createTime.txt';

  const resetProgress = () => {
    timeouts.forEach((id) => clearTimeout(id));
    showProgress = true;
    timeouts = [];
  };

  const download = async (url: string) => {
    progress = 0;
    progressSpeed = 0;
    progressDetail = `Downloading ${url.split('/').pop()}`;

    if (IS_TAURI && url.startsWith('https://')) {
      const filePath = (await tempDir()) + random(1e17, 1e18 - 1);
      await tauriDownload(url, filePath, (payload) => {
        console.log(payload);
        progress = clamp(payload.progressTotal / payload.total, 0, 1);
        progressSpeed = payload.transferSpeed;
      });
      const data = await readFile(filePath);
      await remove(filePath);
      return new File([data], url.split('/').pop() ?? url);
    } else {
      const response = await fetch(url);
      const contentLength = response.headers.get('content-length');
      if (!response.body) {
        throw new Error('Unable to fetch data.');
      }

      const totalSize = parseInt(contentLength ?? '-1');
      let loadedSize = 0;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      const speedWindow: { loadedSize: number; time: number }[] = [];
      const windowSize = 8;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loadedSize += value.length;
          progress = clamp(loadedSize / totalSize, 0, 1);

          const currentTime = Date.now();
          speedWindow.push({ loadedSize, time: currentTime });

          if (speedWindow.length > windowSize) {
            speedWindow.shift();
          }

          if (speedWindow.length > 1) {
            const firstSample = speedWindow[0];
            const lastSample = speedWindow[speedWindow.length - 1];
            const elapsedTime = (lastSample.time - firstSample.time) / 1000;
            const bytesTransferred = lastSample.loadedSize - firstSample.loadedSize;
            if (elapsedTime > 0) {
              progressSpeed = bytesTransferred / elapsedTime;
            }
          }
        }
      }

      progressSpeed = -1;
      return new File(chunks, url.split('/').pop() ?? url);
    }
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

  const decompressZipArchives = async (files: File[]) => {
    const result: File[] = [];
    (await Promise.all(files.map(decompress))).flat().forEach((file) => result.push(file));
    return result;
  };

  const handleFiles = async (files: File[] | null, replacee?: number) => {
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
              if (replacee !== undefined && replacee < chartBundles.length) {
                const replaceeBundle = chartBundles[replacee];
                selectedChart = id;
                replaceeBundle.chart = id;
              }
            }
          } catch (e) {
            console.debug('Chart is not a JSON file:', e);
          }
        } else if (type === 0) {
          imageFiles.push({ id, file, url: URL.createObjectURL(file) });
          if (replacee !== undefined && replacee < chartBundles.length) {
            const replaceeBundle = chartBundles[replacee];
            selectedIllustration = id;
            replaceeBundle.illustration = id;
          }
        } else if (type === 1) {
          audioFiles.push({ id, file });
          if (replacee !== undefined && replacee < chartBundles.length) {
            const replaceeBundle = chartBundles[replacee];
            selectedSong = id;
            replaceeBundle.song = id;
          }
        }
        assets.push({ id, type, file, included: isIncluded(file.name) });
      }),
    );
    const fields = ['Song:', 'Picture:', 'Chart:'];
    progressDetail = 'Seeking for charts';
    const textAssets = assets.filter((asset) => asset.type === 3);
    let bundlesResolved = 0;
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
        bundlesResolved++;
      }
    }
    if (
      chartBundles.length === 0 &&
      chartFiles.length > 0 &&
      audioFiles.length > 0 &&
      imageFiles.length > 0
    ) {
      await createBundle(chartFiles[0], undefined, undefined, undefined, true);
      bundlesResolved++;
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
    send({
      type: 'inputResponse',
      payload: {
        bundlesResolved,
      },
    });
  };

  const getUrl = (blob: Blob | undefined) => (blob ? URL.createObjectURL(blob) : null);

  const humanizeFileSize = (size: number) => {
    var i = size == 0 ? 0 : clamp(Math.floor(Math.log(size) / Math.log(1024)), 0, 4);
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };

  const handleParams = (params: Config) => {
    localStorage.setItem('player', JSON.stringify(params));
    preferences = params.preferences;
    recorderOptions = params.recorderOptions;
    toggles = {
      autostart: params.autostart,
      autoplay: params.autoplay,
      practice: params.practice,
      adjustOffset: params.adjustOffset,
      record: params.record,
      newTab: params.newTab,
      inApp: params.inApp,
    };
    send({
      type: 'bundle',
      payload: {
        metadata: params.metadata,
        resources: {
          song: audioFiles.find((file) => file.id === currentBundle.song)!.file,
          chart: chartFiles.find((file) => file.id === currentBundle.chart)!.file,
          illustration: imageFiles.find((file) => file.id === currentBundle.illustration)!.file,
          assets: params.resources.assetNames.map((name) => {
            const asset = assets.find((asset) => asset.file.name === name)!;
            return {
              name,
              type: asset.type,
              file: asset.file,
            };
          }),
        },
      },
    });
    const paramsString = queryString.stringify(params, {
      arrayFormat: 'none',
      skipEmptyString: true,
      skipNull: true,
      sort: false,
    });
    start(paramsString.length <= 15360 ? `${base}/play?${paramsString}` : `${base}/play`);
  };

  const downloadUrls = async (urls: string[]) => {
    const result = [];
    for (const url of urls) {
      result.push(await download(url));
    }
    return result;
  };

  const handleParamFiles = async (params: URLSearchParams) => {
    showCollapse = true;

    const zipArchives = await downloadUrls(params.getAll('zip'));
    const regularFiles = await downloadUrls(params.getAll('file'));
    await handleFiles((await decompressZipArchives(zipArchives)).concat(regularFiles));
  };

  const configureWebviewWindow = (webview: WebviewWindow) => {
    if (monitor) {
      const factor = 0.8;
      let { width, height } = preferences.aspectRatio
        ? fit(
            preferences.aspectRatio[0],
            preferences.aspectRatio[1],
            monitor.size.width,
            monitor.size.height,
            true,
          )
        : {
            width: monitor.size.width,
            height: monitor.size.height,
          };
      width = width * factor;
      height = height * factor;
      webview.setPosition(
        new PhysicalPosition(
          Math.round(monitor.position.x + (monitor.size.width - width) / 2),
          Math.round(monitor.position.y + (monitor.size.height - height) / 2),
        ),
      );
      webview.setSize(new PhysicalSize(Math.round(width), Math.round(height)));
    }
  };

  const start = async (url: string) => {
    if (IS_TAURI) {
      monitor = await currentMonitor();
      if (Capacitor.getPlatform() === 'web' && toggles.newTab) {
        const webview = new WebviewWindow(`player-${Date.now()}`, {
          url,
        });
        webview.once('tauri://created', () => {
          webview.setTitle('PhiZone Player');
          configureWebviewWindow(webview);
        });
        webview.once('tauri://error', (e) => {
          console.error(e);
        });
        return;
      } else {
        configureWebviewWindow(getCurrentWebviewWindow());
      }
    }
    if (Capacitor.getPlatform() === 'web' && toggles.newTab) {
      window.open(url);
    } else {
      goto(url);
    }
  };
</script>

<svelte:head>
  <title>PhiZone Player</title>
</svelte:head>

<div class="max-w-2xl text-center mx-auto">
  <h1 class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200">
    PhiZone
    <span class="bg-clip-text bg-gradient-to-tl from-blue-500 to-violet-600 text-transparent">
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
  {#if !IS_TAURI && Capacitor.getPlatform() === 'web'}
    <a
      href="{base}/app"
      target={chartFiles.length > 0 ||
      audioFiles.length > 0 ||
      imageFiles.length > 0 ||
      assets.length > 0 ||
      chartBundles.length > 0
        ? '_blank'
        : '_self'}
      class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
    >
      Get the app
      <i class="fa-solid fa-download"></i>
    </a>
    <dialog id="app" class="modal" bind:this={modal}>
      <div class="modal-box">
        <h3 class="text-lg font-bold">Use the app?</h3>
        <p class="py-4">
          It looks like some files can be resolved. You might want to proceed with the PhiZone
          Player app if you have it installed. Otherwise, you can either <a
            href="{base}/app"
            target="_blank"
            class="text-accent hover:underline"
          >
            download the app
          </a>
          or stay in the browser.
        </p>
        <div class="relative flex items-start">
          <div class="flex items-center h-5 mt-1">
            <input
              id="remember-app-preference"
              name="remember-app-preference"
              type="checkbox"
              class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
              aria-describedby="remember-app-preference-description"
              bind:checked={modalMem}
            />
          </div>
          <label for="remember-app-preference" class="ms-3 transition">
            <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
              Remember my choice
            </span>
            <span
              id="remember-app-preference-description"
              class="block text-sm text-gray-600 dark:text-neutral-500"
            >
              If toggled on, this dialog will not be shown again.
            </span>
          </label>
        </div>
        <div class="modal-action">
          <form method="dialog" class="gap-3 flex justify-center">
            <button
              class="inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
              on:click={() => {
                window.open(
                  `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${$page.url.search}`,
                );
                if (modalMem) {
                  toggles.inApp = 1;
                  localStorage.setItem('toggles', JSON.stringify(toggles));
                }
              }}
            >
              Open in the app
            </button>
            <button
              class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
              on:click={() => {
                handleParamFiles($page.url.searchParams);
                if (modalMem) {
                  toggles.inApp = 2;
                  localStorage.setItem('toggles', JSON.stringify(toggles));
                }
              }}
            >
              Proceed with browser
            </button>
          </form>
        </div>
      </div>
    </dialog>
  {:else}
    <a
      href={REPO_LINK}
      target="_blank"
      class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
    >
      View on GitHub
      <i class="fa-brands fa-github fa-xl"></i>
    </a>
  {/if}
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
          accept={IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web'
            ? null
            : '.pez,.yml,.yaml,.shader,.glsl,.frag,.fsh,.fs,application/zip,application/json,image/*,video/*,audio/*,text/*'}
          class="file-input file-input-bordered w-full max-w-xs file:btn dark:file:btn-neutral file:no-animation border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600"
          on:input={async (e) => {
            const fileList = e.currentTarget.files;
            if (!fileList || fileList.length === 0) return;
            const files = Array.from(fileList);
            const zipArchives = files.filter(isZip);
            const regularFiles = files
              .filter((file) => !isZip(file))
              .concat(await decompressZipArchives(zipArchives));
            await handleFiles(regularFiles);
          }}
        />
      </label>
      {#if !IS_ANDROID_OR_IOS && Capacitor.getPlatform() === 'web'}
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
      {/if}
    </div>
    <div
      class="w-full sm:w-5/6 md:w-3/4 lg:w-2/3 opacity-0 transition"
      class:opacity-100={progress >= 0 && showProgress}
    >
      <div class="mb-2 flex justify-between items-center">
        <div class="flex gap-3">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-white">
            {progressDetail ?? 'Loading'}
          </h3>
          <p class="text-sm text-gray-500 dark:text-gray-300">
            {#if progressSpeed >= 0}
              {humanizeFileSize(progressSpeed) + '/s'}
            {/if}
          </p>
        </div>
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
          class="flex flex-col justify-center rounded-full overflow-hidden bg-blue-500 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-blue-500"
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
              <table class="table-fixed w-full divide-y divide-gray-200 dark:divide-neutral-700">
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
                          class="inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg transition border border-transparent text-blue-500 hover:text-blue-800 focus:outline-none focus:text-blue-800 disabled:opacity-50 disabled:pointer-events-none dark:text-blue-500 dark:hover:text-blue-400 dark:focus:text-blue-400"
                          on:click={() => {
                            asset.included = !asset.included;
                          }}
                        >
                          {asset.included ? 'Exclude' : 'Include'}
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg transition border border-transparent text-blue-500 hover:text-blue-800 focus:outline-none focus:text-blue-800 disabled:opacity-50 disabled:pointer-events-none dark:text-blue-500 dark:hover:text-blue-400 dark:focus:text-blue-400"
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
                class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                aria-describedby="autoplay-description"
                checked={toggles.autoplay}
                on:input={(e) => {
                  toggles.autoplay = e.currentTarget.checked;
                  if (toggles.autoplay) {
                    toggles.practice = false;
                  } else {
                    toggles.adjustOffset = false;
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
                id="adjust-offset"
                name="adjust-offset"
                type="checkbox"
                class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                aria-describedby="adjust-offset-description"
                bind:checked={toggles.adjustOffset}
                disabled={!toggles.autoplay}
              />
            </div>
            <label for="adjust-offset" class="ms-3 transition" class:opacity-50={!toggles.autoplay}>
              <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                Adjust offset
              </span>
              <span
                id="adjust-offset-description"
                class="block text-sm text-gray-600 dark:text-neutral-500"
              >
                Enables realtime chart offset adjustment. The offset set in the preferences is
                ignored.
              </span>
            </label>
          </div>
          <div class="relative flex items-start">
            <div class="flex items-center h-5 mt-1">
              <input
                id="practice"
                name="practice"
                type="checkbox"
                class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
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
                  class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
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
                  Note that this feature is still a work in progress.
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
                    <span class="block text-sm font-medium mb-1 dark:text-white">Frame rate</span>
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
                        class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
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
                    <span class="block text-sm font-medium mb-1 dark:text-white">Ending loops</span>
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
                class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
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
          {#if Capacitor.getPlatform() === 'web'}
            <div class="relative flex items-start">
              <div class="flex items-center h-5 mt-1">
                <input
                  id="newtab"
                  name="newtab"
                  type="checkbox"
                  class="transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                  aria-describedby="newtab-description"
                  bind:checked={toggles.newTab}
                />
              </div>
              <label for="newtab" class="ms-3">
                <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                  New
                  {#if IS_TAURI}
                    window
                  {:else}
                    tab
                  {/if}
                </span>
                <span
                  id="newtab-description"
                  class="block text-sm text-gray-600 dark:text-neutral-500"
                >
                  The player will be opened in a new
                  {#if IS_TAURI}
                    window.
                  {:else}
                    tab.
                  {/if}
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
                  song: getUrl(audioFiles.find((file) => file.id === currentBundle.song)?.file),
                  chart: getUrl(chartFiles.find((file) => file.id === currentBundle.chart)?.file),
                  illustration: imageFiles.find((file) => file.id === currentBundle.illustration)
                    ?.url,
                  assetNames: assetsIncluded.map((asset) => asset.file.name),
                  assetTypes: assetsIncluded.map((asset) => asset.type),
                  assets: assetsIncluded.map((asset) => getUrl(asset.file)),
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
              let url = `${base}/play`;
              if (params.length <= 15360) {
                url = `${base}/play?${params}`;
              } else {
                const config = {
                  resources: {
                    song:
                      getUrl(audioFiles.find((file) => file.id === currentBundle.song)?.file) ?? '',
                    chart:
                      getUrl(chartFiles.find((file) => file.id === currentBundle.chart)?.file) ??
                      '',
                    illustration:
                      imageFiles.find((file) => file.id === currentBundle.illustration)?.url ?? '',
                    assetNames: assetsIncluded.map((asset) => asset.file.name),
                    assetTypes: assetsIncluded.map((asset) => asset.type),
                    assets: assetsIncluded.map((asset) => getUrl(asset.file) ?? ''),
                  },
                  metadata: currentBundle.metadata,
                  preferences,
                  recorderOptions,
                  ...toggles,
                };
                localStorage.setItem('player', JSON.stringify(config));
              }
              start(url);
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
