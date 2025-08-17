<script lang="ts">
  import JSZip from 'jszip';
  import mime from 'mime/lite';
  import { onDestroy, onMount } from 'svelte';
  import queryString from 'query-string';
  import { fileTypeFromBlob } from 'file-type';
  import type {
    BlobInputMessage,
    Config,
    IncomingMessage,
    Metadata,
    Preferences,
    MediaOptions,
    Release,
    RpeJson,
    UrlInputMessage,
    FFmpegEncoder,
    ResourcePack,
    ResourcePackWithId,
    Font,
    BitmapFont,
    NoteSkin,
    HitSound,
    GradeLetter,
    PhiraResourcePack,
    OrdinaryParticle,
  } from '$lib/types';
  import {
    clamp,
    convertRespackToURL,
    exportRespack,
    extractTgz,
    fit,
    getLines,
    getParams,
    haveSameKeys,
    inferLevelType,
    IS_ANDROID_OR_IOS,
    IS_TAURI,
    isPec,
    isZip,
    notify,
    readMetadataForChart,
    readMetadataForPhiraRespack,
    readMetadataForRespack,
    send,
    updateMetadata,
    versionCompare,
  } from '$lib/utils';
  import PreferencesModal from '$lib/components/Preferences.svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import { Network } from '@capacitor/network';
  import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
  import { currentMonitor, type Monitor } from '@tauri-apps/api/window';
  import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
  import { platform, arch } from '@tauri-apps/plugin-os';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { App, type URLOpenListenerEvent } from '@capacitor/app';
  import { Clipboard } from '@capacitor/clipboard';
  import { page } from '$app/state';
  import { REPO_API_LINK, REPO_LINK, VERSION } from '$lib';
  import { SendIntent, type Intent } from 'send-intent';
  import { Filesystem } from '@capacitor/filesystem';
  import { join, tempDir, videoDir } from '@tauri-apps/api/path';
  import { download as tauriDownload } from '@tauri-apps/plugin-upload';
  import { readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
  import { random } from 'mathjs';
  import { base } from '$app/paths';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import {
    getEncoders,
    getFFmpegDownloadLink,
    setFFmpegPath,
  } from '$lib/player/services/ffmpeg/tauri';
  import { open, ask } from '@tauri-apps/plugin-dialog';
  import { DEFAULT_RESOURCE_PACK, DEFAULT_RESOURCE_PACK_ID } from '$lib/player/constants';
  import { getFFmpeg, loadFFmpeg } from '$lib/player/services/ffmpeg';
  import { fetchFile } from '@ffmpeg/util';
  import { convertHoldAtlas, getImageDimensions } from '$lib/converters/phira/respack';
  import { hexToRgba } from '$lib/player/utils';
  import { m } from '$lib/paraglide/messages';
  import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';

  interface FileEntry {
    id: number;
    file: File;
    url?: string;
  }

  interface MetadataEntry {
    id?: number;
    name: string;
    song: string;
    picture: string;
    chart: string;
    composer: string;
    charter: string;
    illustration: string;
    level: string;
  }

  interface ChartBundle {
    id: number;
    song: number;
    chart: number;
    illustration: number;
    metadata: Metadata;
  }

  // let _respackDB = new Database<ResourcePack<File>>('resource_packs', RESPACK_DB_VERSION, {
  //   structures: [
  //     {
  //       name: 'id',
  //       options: { key: true, unique: true },
  //     },
  //     {
  //       name: 'name',
  //       options: { unique: false, index: true },
  //     },
  //     {
  //       name: 'date_added',
  //       options: { unique: false },
  //     },
  //   ],
  //   autoIncrement: true,
  // });

  let showCollapse = false;
  let showRespack = false;
  let showMediaCollapse = false;
  let overrideResolution = false;
  let modalMem = false;
  let directoryInput: HTMLInputElement;
  let appModal: HTMLDialogElement;
  let clipboardModal: HTMLDialogElement;
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
  let currentBundle: ChartBundle | undefined;
  let preferences: Preferences = {
    aspectRatio: null,
    backgroundBlur: 1,
    backgroundLuminance: 0.5,
    chartFlipping: 0,
    chartOffset: 0,
    fcApIndicator: true,
    goodJudgment: 160,
    hitSoundVolume: 0.75,
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
    render: false,
    newTab: Capacitor.getPlatform() === 'web',
    inApp: IS_TAURI || Capacitor.getPlatform() !== 'web' ? 2 : 0,
  };
  let mediaOptions: MediaOptions = {
    frameRate: 60,
    overrideResolution: [1620, 1080],
    resultsLoopsToRender: 1,
    videoCodec: 'libx264',
    videoBitrate: 6000,
    audioBitrate: 320,
    vsync: true,
    exportPath: undefined,
  };
  let mediaResolutionWidth = 1620;
  let mediaResolutionHeight = 1080;

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

  let selectedResourcePack = DEFAULT_RESOURCE_PACK_ID;
  let resourcePacks: (ResourcePackWithId<File> | ResourcePackWithId<string>)[] = [
    DEFAULT_RESOURCE_PACK as ResourcePackWithId<string>,
  ];

  let timeouts: NodeJS.Timeout[] = [];

  let isRenderingAvailable = true;
  let ffmpegEncoders: FFmpegEncoder[] | undefined;

  let isFirstLoad = !page.url.searchParams.get('t');

  let clipboardUrl: URL | undefined;
  let lastResolvedClipboardUrl: URL | undefined;

  let scheduledStart = false;

  const unlistens: UnlistenFn[] = [];

  onMount(async () => {
    const checkParam = (key: string, values: string[]) =>
      values.some((v) => v === page.url.searchParams.get(key));
    [
      { key: 'debug', name: m.debug_mode() },
      { key: 'performance', name: m.performance_metrics() },
    ].forEach((e) => {
      if (checkParam(e.key, ['1', 'true'])) {
        localStorage.setItem(e.key, 'true');
        notify(m.enabled({ name: e.name }), 'info');
      } else if (checkParam(e.key, ['0', 'false']) && localStorage.getItem(e.key)) {
        localStorage.removeItem(e.key);
        notify(m.disabled({ name: e.name }), 'info');
      }
    });
    if (directoryInput) directoryInput.webkitdirectory = true;

    await init();

    addEventListener('message', async (e: MessageEvent<IncomingMessage>) => {
      const message = e.data;
      if (!message || !message.type) return;
      if (message.type === 'play') {
        let config: Config;
        const { preferences: pref, mediaOptions: rec, ...rest } = message.payload;
        if (pref) preferences = pref;
        if (rec) mediaOptions = rec;
        for (const key in rest) {
          if (rest[key as keyof typeof rest] !== undefined) {
            toggles[key as keyof typeof toggles] = rest[key as keyof typeof rest] as never;
          }
        }
        if ('resources' in message.payload) {
          config = message.payload;
        } else {
          config = handleConfig();
        }
        await handleParams(config);
      } else if (
        message.type === 'zipInput' ||
        message.type === 'fileInput' ||
        message.type === 'zipUrlInput' ||
        message.type === 'fileUrlInput'
      ) {
        showCollapse = true;
        const bundleFileMatrix: File[][] = [];
        let replacee: number | undefined = undefined;
        if (message.type.includes('Url')) {
          const payload = (e.data as UrlInputMessage).payload;
          replacee = payload.replacee;
          if (message.type === 'zipUrlInput') {
            bundleFileMatrix.push(
              ...(await decompressZipArchives(await downloadUrls(payload.input))),
            );
          } else if (message.type === 'fileUrlInput') {
            bundleFileMatrix.push(await downloadUrls(payload.input));
          }
        } else {
          const payload = (e.data as BlobInputMessage).payload;
          replacee = payload.replacee;
          if (message.type === 'zipInput') {
            bundleFileMatrix.push(
              ...(await decompressZipArchives(
                payload.input.map((blob) => new File([blob], 'archive.zip')),
              )),
            );
          } else if (message.type === 'fileInput') {
            bundleFileMatrix.push(payload.input.map((blob) => new File([blob], 'file')));
          }
        }
        for (const files of bundleFileMatrix) {
          await handleFiles(files, replacee);
        }
      }
    });

    if (IS_TAURI) {
      onOpenUrl(async (urls) => {
        await handleRedirect(urls[0]);
      });
      const handler = async (path: string) => {
        const data = await readFile(path);
        return new File(
          [Uint8Array.from(data)],
          path.split('/').pop() ?? path.split('\\').pop() ?? path,
        );
      };
      listen('files-opened', async (event: { payload: string[] }) => {
        const filePaths = event.payload;
        await handleFilePaths(filePaths, handler);
      });
      if (isFirstLoad) {
        if (crossOriginIsolated) ffmpegEncoders = await getEncoders();
        const result: string[] = await invoke('get_files_opened');
        if (result) {
          await handleFilePaths(result, handler);
        }
      }
      unlistens.push(
        await getCurrentWindow().onFocusChanged(async ({ payload: focused }) => {
          if (focused) {
            await handleClipboard();
          }
        }),
      );
    } else {
      addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          await handleClipboard();
        }
      });
      window.onfocus = async () => {
        await handleClipboard();
      };
    }

    if (Capacitor.getPlatform() !== 'web') {
      App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
        handleRedirect(event.url);
      });
      if (isFirstLoad) await handleSendIntent();
      addEventListener('sendIntentReceived', handleSendIntent);
    }

    send({
      type: 'event',
      payload: {
        name: 'ready',
      },
    });

    if (scheduledStart) {
      await start(handleConfig());
    }
  });

  onDestroy(() => {
    unlistens.forEach((unlisten) => unlisten());
    timeouts.forEach((id) => clearTimeout(id));
  });

  const init = async () => {
    if (isFirstLoad) {
      const url = IS_TAURI ? (await getCurrent())?.at(0) : undefined;
      if (url) {
        const params = getParams(url, false);
        if (params) {
          await handleParams(params);
          return;
        }
        const searchParams = new URL(url).searchParams;
        await handleParamFiles(searchParams);
      }

      if (
        (IS_TAURI && navigator.onLine) ||
        (Capacitor.getPlatform() !== 'web' &&
          ((Capacitor.getPlatform() !== 'ios' && (await Network.getStatus()).connected) ||
            (Capacitor.getPlatform() === 'ios' && navigator.onLine)))
      ) {
        checkForUpdates();
      }
    }

    let pref, tgs, mopts;

    if (IS_TAURI) {
      const args: Record<string, string> = await invoke('get_cli_args');
      if (args['preferences']) pref = args['preferences'];
      if (args['toggles']) tgs = args['toggles'];
      if (args['mediaOptions']) mopts = args['mediaOptions'];
      scheduledStart = args['start'] === 'true' || args['play'] === 'true';
    }

    pref ??= localStorage.getItem('preferences');
    tgs ??= localStorage.getItem('toggles');
    mopts ??= localStorage.getItem('mediaOptions');

    if (pref) {
      pref = JSON.parse(pref);
      if (haveSameKeys(pref, preferences)) preferences = pref;
    }
    if (tgs) {
      tgs = JSON.parse(tgs);
      if (haveSameKeys(tgs, toggles)) toggles = tgs;
    }
    if (mopts) {
      mopts = JSON.parse(mopts);
      if (haveSameKeys(mopts, mediaOptions)) mediaOptions = mopts;
    }

    if (mediaOptions.overrideResolution && mediaOptions.overrideResolution.length === 2) {
      overrideResolution = true;
      mediaResolutionWidth = mediaOptions.overrideResolution[0];
      mediaResolutionHeight = mediaOptions.overrideResolution[1];
    }

    if (!mediaOptions.exportPath && IS_TAURI) {
      mediaOptions.exportPath = await join(await videoDir(), 'PhiZone Player');
    }

    if (
      !IS_TAURI &&
      Capacitor.getPlatform() === 'web' &&
      (page.url.searchParams.has('file') || page.url.searchParams.has('zip'))
    ) {
      if (toggles.inApp === 0) {
        appModal.showModal();
      } else if (toggles.inApp === 1) {
        window.open(`${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${page.url.search}`);
      } else {
        await handleParamFiles(page.url.searchParams);
      }
    }
  };

  const checkForUpdates = async () => {
    let success = false;
    try {
      const response = await fetch(`${REPO_API_LINK}/releases/latest`, {
        headers: {
          'User-Agent': 'PhiZone Player',
        },
      });
      success = response.ok;
      const latestRelease = (await response.json()) as Release;
      if (versionCompare(latestRelease.tag_name.slice(1), VERSION) > 0) {
        const clickToDownload =
          (IS_TAURI && platform() === 'windows') ||
          platform() === 'macos' ||
          Capacitor.getPlatform() === 'android';
        notify(
          m.new_version_available({
            version: latestRelease.tag_name,
            guidance: clickToDownload
              ? m['new_version_guidances.0']()
              : Capacitor.getPlatform() === 'ios'
                ? m['new_version_guidances.1']()
                : m['new_version_guidances.2'](),
          }),
          'info',
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
    } catch (e) {
      console.warn(e);
    }
    if (!success) {
      notify(m.version_check_failed(), 'warning');
    }
  };

  const handleConfig = () => {
    const assetsIncluded = assets.filter((asset) => asset.included);
    if (!currentBundle) {
      alert(m.no_bundle_available());
      throw new Error(m.no_bundle_available());
    }
    return {
      resources: {
        song: getUrl(audioFiles.find((file) => file.id === currentBundle!.song)?.file) ?? '',
        chart: getUrl(chartFiles.find((file) => file.id === currentBundle!.chart)?.file) ?? '',
        illustration: imageFiles.find((file) => file.id === currentBundle!.illustration)?.url ?? '',
        assetNames: assetsIncluded.map((asset) => asset.file.name),
        assetTypes: assetsIncluded.map((asset) => asset.type),
        assets: assetsIncluded.map((asset) => getUrl(asset.file) ?? ''),
      },
      metadata: currentBundle.metadata,
      preferences,
      mediaOptions,
      resourcePack: ensureRespackSerializable(
        resourcePacks.find((pack) => pack.id === selectedResourcePack)!,
      ),
      ...toggles,
    };
  };

  const handleRedirect = async (url: string) => {
    const params = getParams(url, false);
    if (params) {
      await handleParams(params);
    } else {
      const searchParams = new URL(url).searchParams;
      await handleParamFiles(searchParams);
    }
  };

  const resolveClipboardUrl = async (type: 'zip' | 'file') => {
    handleParamFiles(new URLSearchParams({ [type]: clipboardUrl!.href }));
    lastResolvedClipboardUrl = clipboardUrl;
  };

  const handleClipboard = async () => {
    if (!IS_TAURI && !document.hasFocus()) return;
    let text: string | undefined;
    try {
      if (Capacitor.getPlatform() === 'web') {
        text = await (IS_TAURI ? readText() : navigator.clipboard.readText());
      } else {
        const result = await Clipboard.read();
        if (['string', 'url'].includes(result.type)) {
          text = result.value;
        }
      }
    } catch (e) {
      console.warn('Failed to read clipboard:', e);
      return;
    }
    if (!text || (clipboardModal && clipboardModal.open)) return;
    try {
      const url = new URL(text);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (lastResolvedClipboardUrl && lastResolvedClipboardUrl.href === url.href) {
          return;
        }
        clipboardUrl = url;
        clipboardModal.showModal();
      }
    } catch (e) {
      console.debug('Not a URL:', e);
      return;
    }
  };

  const handleSendIntent = async () => {
    const result = await SendIntent.checkSendIntentReceived();
    if (result.url) {
      console.log('Send intent received:', JSON.stringify(result));
      await handleFilePaths([result], async (result: Intent) => {
        let resultUrl = decodeURIComponent(result.url!);
        const file = await Filesystem.readFile({ path: resultUrl });
        const blob =
          typeof file.data === 'string'
            ? new Blob([
                new Uint8Array(
                  atob(file.data as string)
                    .split('')
                    .map((char) => char.charCodeAt(0)),
                ),
              ])
            : file.data;
        return new File([blob], result.title ?? '');
      });
    }
  };

  // SvelteKit somehow does not support the lambda form of this function
  async function handleFilePaths<T>(paths: T[], handler: (path: T) => Promise<File>) {
    if (paths.length === 0) return;
    showCollapse = true;

    let promises = await Promise.allSettled(
      paths.map(async (filePath) => {
        return handler(filePath);
      }),
    );

    promises
      .filter((promise) => promise.status === 'rejected')
      .forEach((promise) => {
        console.error((promise as PromiseRejectedResult).reason);
      });

    const regularFiles: File[] = [];
    for (const file of promises
      .filter((promise) => promise.status === 'fulfilled')
      .map((promise) => (promise as PromiseFulfilledResult<File>).value)) {
      try {
        const files = await decompress(file);
        await handleFiles(files);
      } catch (e) {
        console.debug(`Cannot decompress ${file.name}`, e);
        regularFiles.push(file);
      }
    }
    await handleFiles(regularFiles);
  }

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
    const name = url.split('/').pop() ?? url.split('\\').pop() ?? url;

    progress = 0;
    progressSpeed = 0;
    progressDetail = m.downloading({ name });

    if (IS_TAURI && (url.startsWith('https://') || url.startsWith('http://'))) {
      const filePath = (await tempDir()) + random(1e17, 1e18 - 1);
      await tauriDownload(url, filePath, (payload) => {
        if (progressSpeed === -1) return;
        progress = clamp(payload.progressTotal / payload.total, 0, 1);
        progressSpeed = payload.transferSpeed;
      });
      const data = await readFile(filePath);
      await remove(filePath);
      progressSpeed = -1;
      return new File([Uint8Array.from(data)], name);
    } else {
      const response = await fetch(url);
      const contentLength = response.headers.get('content-length');
      if (!response.body) {
        throw new Error(`Failed to fetch from ${url}`);
      }

      const totalSize = parseInt(contentLength ?? '-1');
      let loadedSize = 0;
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];

      const speedWindow: { loadedSize: number; time: number }[] = [];
      const windowSize = 8;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(Uint8Array.from(value));
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
          progressDetail = m.extracting({ name: fileName });
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

  const getTypeOfRespack = (pack: ResourcePack<File> | ResourcePack<string>) =>
    typeof (
      pack.thumbnail ??
      pack.hitEffects?.spriteSheet ??
      pack.noteSkins.at(0)?.file ??
      pack.hitSounds.at(0)?.file ??
      pack.ending.grades.at(0)?.file ??
      pack.ending.music.at(0)?.file ??
      (pack.fonts.at(0)?.type === 'bitmap'
        ? (pack.fonts.at(0) as BitmapFont<string> | undefined)?.texture
        : (pack.fonts.at(0) as Font<string> | undefined)?.file)
    );

  const setupRendering = () => {
    if (!crossOriginIsolated) {
      isRenderingAvailable = false;
      ffmpegEncoders = [];
      alert(m.rendering_not_available());
      return false;
    }
    setupFFmpeg();
    return true;
  };

  const setupFFmpeg = async () => {
    if (ffmpegEncoders === undefined) {
      const link = getFFmpegDownloadLink();
      if (
        link &&
        (await ask('FFmpeg could not be found on your system. Do you want to install it?'))
      ) {
        resetProgress();
        const tgz = await download(link);
        progressDetail = m.extracting_files();
        const files = await extractTgz(tgz);
        const executable = files.filter((file) => file.name.includes('ffmpeg'))[0];
        const path = await join(await invoke('get_current_dir'), executable.name);
        progressDetail = m.setting_up({ name: 'FFmpeg' });
        await writeFile(path, new Uint8Array(await executable.arrayBuffer()));
        await setFFmpegPath(path);
        ffmpegEncoders = await getEncoders();
        declareFinished();
      } else {
        isRenderingAvailable = false;
      }
    }
  };

  const createBundle = async (
    chartFile: FileEntry,
    songFile?: FileEntry,
    illustrationFile?: FileEntry,
    metadataEntry?: MetadataEntry,
    metadata?: Metadata,
    fallback: boolean = false,
    silent: boolean = true,
  ) => {
    songFile ??= audioFiles.find((file) => shareId(file, chartFile));
    if (songFile === undefined) {
      if (!fallback) {
        if (!silent) alert(m.no_song_found({ name: chartFile.file.name }));
        return;
      }
      songFile = audioFiles[0];
    }
    illustrationFile ??= imageFiles.find((file) => shareId(file, chartFile));
    if (illustrationFile === undefined) {
      if (!fallback) {
        if (!silent) alert(m.no_illustration_found({ name: chartFile.file.name }));
        return;
      }
      illustrationFile = imageFiles[0];
    }
    if (!metadata && !metadataEntry) {
      if (!silent) alert(m.metadata_not_found());
      return;
    }
    const bundle = {
      id: Date.now(),
      song: songFile.id,
      chart: chartFile.id,
      illustration: illustrationFile.id,
      metadata: metadataEntry
        ? {
            title: metadataEntry.name,
            composer: metadataEntry.composer,
            charter: metadataEntry.charter,
            illustrator: metadataEntry.illustration ?? null,
            level: metadataEntry.level,
            levelType: inferLevelType(metadataEntry.level),
            difficulty: null,
          }
        : metadata!,
    };
    chartBundles.push(bundle);
    chartBundles = chartBundles;
    assets = assets.filter(
      (a) =>
        a.id !== chartFile.id &&
        a.id !== songFile?.id &&
        a.id !== illustrationFile?.id &&
        a.id !== metadataEntry?.id,
    );
    send({
      type: 'bundle',
      payload: {
        metadata: bundle.metadata,
        resources: {
          song: audioFiles.find((file) => file.id === bundle.song)!.file,
          chart: chartFiles.find((file) => file.id === bundle.chart)!.file,
          illustration: imageFiles.find((file) => file.id === bundle.illustration)!.file,
          assets: assets.map((asset) => {
            return {
              name: asset.file.name,
              type: asset.type,
              file: asset.file,
            };
          }),
        },
      },
    });
    return bundle;
  };

  const convertAudio = async (audio: File) => {
    progress = 0;
    const ffmpeg = getFFmpeg();
    ffmpeg.on('progress', (p) => {
      progress = clamp(p.progress, 0, 1);
    });
    if (!ffmpeg.loaded) {
      progressDetail = m.loading({ name: 'FFmpeg' });
      await loadFFmpeg();
    }
    try {
      progressDetail = m.converting({ name: audio.name });
      await ffmpeg.writeFile('input', await fetchFile(audio));
      await ffmpeg.exec('-i input -ar 44100 -ac 2 -f wav -y output'.split(' '));
      const data = await ffmpeg.readFile('output');
      return new File([(data as Uint8Array).buffer as ArrayBuffer], audio.name, {
        type: 'audio/wav',
      });
    } catch (e) {
      console.error(e);
      return audio;
    }
  };

  const importRespack = async (metadata: ResourcePackWithId<string>, panicOnNotFound = true) => {
    const filesLocated: FileEntry[] = [];
    const findFile = async (str: string) => {
      if (
        str.startsWith('/') ||
        str.startsWith('http://') ||
        str.startsWith('https://') ||
        str.startsWith('blob:')
      ) {
        const file = await download(str);
        return file;
      }
      const file = assets.find((file) => file.file.name === str);
      if (file) {
        filesLocated.push(file);
        return file.file;
      }
      if (!panicOnNotFound) {
        return undefined;
      }
      const message = m.error_respack_incomplete({
        filename: str,
        packname: metadata.name,
      });
      alert(message);
      throw new Error(message);
    };

    const resourcePack: ResourcePackWithId<File> = {
      id: metadata.id,
      name: metadata.name,
      author: metadata.author,
      description: metadata.description,
      thumbnail: metadata.thumbnail ? await findFile(metadata.thumbnail) : undefined,
      noteSkins: (
        await Promise.all(
          metadata.noteSkins.map(async (e) => ({
            name: e.name,
            file: await findFile(e.file),
          })),
        )
      ).filter((e) => e.file !== undefined) as NoteSkin<File>[],
      hitSounds: await (async () => {
        const results = [];
        for (const e of metadata.hitSounds) {
          const file = await findFile(e.file);
          if (!file) {
            continue;
          }
          results.push({
            name: e.name,
            file: await convertAudio(file),
          });
        }
        return results;
      })(),
      hitEffects: await (async () => {
        if (!metadata.hitEffects) {
          return undefined;
        }
        const file = await findFile(metadata.hitEffects.spriteSheet);
        return file
          ? {
              spriteSheet: file,
              frameWidth: metadata.hitEffects.frameWidth,
              frameHeight: metadata.hitEffects.frameHeight,
              frameRate: metadata.hitEffects.frameRate,
              particle: metadata.hitEffects.particle,
            }
          : undefined;
      })(),
      ending: {
        grades: (
          await Promise.all(
            metadata.ending.grades.map(async (e) => ({
              name: e.name,
              file: await findFile(e.file),
            })),
          )
        ).filter((e) => e.file !== undefined) as GradeLetter<File>[],
        music: await (async () => {
          const results = [];
          for (const e of metadata.ending.music) {
            const file = await findFile(e.file);
            if (!file) {
              continue;
            }
            results.push({
              levelType: e.levelType,
              beats: e.beats,
              bpm: e.bpm,
              file: await convertAudio(file),
            });
          }
          return results;
        })(),
      },
      fonts: (
        await Promise.all(
          metadata.fonts.map(async (e) =>
            e.type === 'bitmap'
              ? {
                  name: e.name,
                  type: e.type,
                  texture: await findFile(e.texture),
                  descriptor: await findFile(e.descriptor),
                }
              : {
                  name: e.name,
                  type: e.type,
                  file: await findFile(e.file),
                },
          ),
        )
      ).filter(
        (e) =>
          ('file' in e && e.file !== undefined) ||
          (e.texture !== undefined && e.descriptor !== undefined),
      ) as (Font<File> | BitmapFont<File>)[],
      options: {
        holdBodyRepeat: metadata.options?.holdBodyRepeat,
        holdCompact: metadata.options?.holdCompact,
        holdKeepHead: metadata.options?.holdKeepHead,
      },
    };

    audioFiles = audioFiles.filter((f) => !filesLocated.some((file) => file.id === f.id));
    imageFiles = imageFiles.filter((f) => !filesLocated.some((file) => file.id === f.id));
    assets = assets.filter((f) => !filesLocated.some((file) => file.id === f.id));
    declareFinished();
    return resourcePack;
  };

  const convertPhiraRespack = async (metadata: PhiraResourcePack) => {
    const filesLocated: FileEntry[] = [];
    const findImage = (str: string) => {
      const file =
        imageFiles?.find((file) => file.file.name === str) ??
        assets.find((file) => file.file.name === str);
      if (file) {
        filesLocated.push(file);
        return file.file;
      }
      const message = m.error_respack_incomplete_phira({
        filename: str,
        packname: metadata.name,
      });
      throw new Error(message);
    };
    const results = [
      ...(await convertHoldAtlas(findImage('hold.png'), metadata.holdAtlas, false)),
      ...(await convertHoldAtlas(findImage('hold_mh.png'), metadata.holdAtlasMH, true)),
    ];
    assets.push(
      ...results.map((result, i) => ({
        id: -i - 1,
        type: 0,
        file: result.file,
        included: false,
      })),
    );
    imageFiles = imageFiles.filter((f) => !filesLocated.some((file) => file.id === f.id));
    assets = assets.filter((f) => !filesLocated.some((file) => file.id === f.id));
    const { width, height } = await getImageDimensions(findImage('hit_fx.png'));
    const frameWidth = Math.floor(width / metadata.hitFx[0]);
    const frameHeight = Math.floor(height / metadata.hitFx[1]);
    return {
      id: crypto.randomUUID(),
      name: metadata.name,
      author: metadata.author,
      description: metadata.description,
      noteSkins: [
        ...results.map((e) => {
          return {
            name: e.name,
            file: e.file.name,
          };
        }),
        {
          name: 'Tap',
          file: 'click.png',
        },
        {
          name: 'TapHL',
          file: 'click_mh.png',
        },
        {
          name: 'Flick',
          file: 'flick.png',
        },
        {
          name: 'FlickHL',
          file: 'flick_mh.png',
        },
        {
          name: 'Drag',
          file: 'drag.png',
        },
        {
          name: 'DragHL',
          file: 'drag_mh.png',
        },
      ] as NoteSkin<string>[],
      hitSounds: [
        {
          name: 'Tap',
          file: 'click.ogg',
        },
        {
          name: 'Flick',
          file: 'flick.ogg',
        },
        {
          name: 'Drag',
          file: 'drag.ogg',
        },
      ] as HitSound<string>[],
      hitEffects: {
        spriteSheet: 'hit_fx.png',
        frameWidth,
        frameHeight,
        frameRate: (metadata.hitFx[0] * metadata.hitFx[1]) / (metadata.hitFxDuration ?? 0.5),
        colorPerfect: hexToRgba(metadata.colorPerfect),
        colorGood: hexToRgba(metadata.colorGood),
        particle: {
          count: metadata.hideParticles ? 0 : 4,
          style: 'square',
        } as OrdinaryParticle,
      },
      ending: {
        grades: [],
        music: [],
      },
      fonts: [],
      options: {
        holdBodyRepeat: metadata.holdRepeat,
        holdCompact: metadata.holdCompact,
        holdKeepHead: metadata.holdKeepHead,
      },
    };
  };

  const ensureRespackSerializable = (pack: ResourcePack<File> | ResourcePack<string>) => {
    return getTypeOfRespack(pack) === 'string'
      ? (pack as ResourcePack<string>)
      : convertRespackToURL(pack as ResourcePack<File>);
  };

  const decompressZipArchives = async (files: File[]) => {
    return await Promise.all(files.map(decompress));
  };

  const handleFiles = async (files: File[] | null, replacee?: number) => {
    if (!files || files.length === 0) {
      return;
    }
    resetProgress();
    progressDetail = m.processing_files();
    const now = Date.now();
    await Promise.all(
      files.map(async (file, i) => {
        const id = now + i;
        let mimeType: string | null = null;
        try {
          mimeType = (await fileTypeFromBlob(file))?.mime.toString() ?? mime.getType(file.name);
        } catch (e) {
          console.error(e);
          mimeType = mime.getType(file.name);
        }
        const type = getFileType(mimeType, file.name);
        let chartSuccess = false;
        const chartContent = await file.text();
        if (mimeType === 'application/json') {
          try {
            const json = JSON.parse(chartContent);
            if (json.META) {
              chartSuccess = true;
            }
          } catch (e) {
            console.debug('Chart is not a valid RPE JSON:', e);
          }
        }
        if (isPec(getLines(chartContent).slice(0, 2))) {
          chartSuccess = true;
        }
        if (chartSuccess) {
          chartFiles.push({ id, file });
          if (replacee !== undefined && replacee < chartBundles.length) {
            const replaceeBundle = chartBundles[replacee];
            selectedChart = id;
            replaceeBundle.chart = id;
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
    progressDetail = m.resolving_resources();
    const textAssets = assets.filter((asset) => asset.type === 3);
    let bundlesResolved = 0;
    let respacksResolved = 0;
    for (let i = 0; i < textAssets.length; i++) {
      progress = i / textAssets.length;
      const asset = textAssets[i];
      if (chartBundles.some((bundle) => bundle.chart === asset.id)) {
        continue;
      }
      const content = await asset.file.text();
      // chart
      {
        let metadata = readMetadataForChart(content);
        if (metadata) {
          const chartFile = chartFiles.find((file) => file.file.name === metadata.chart);
          const songFile = audioFiles.find((file) => file.file.name === metadata.song);
          const illustrationFile = imageFiles.find((file) => file.file.name === metadata.picture);
          if (chartFile) {
            try {
              const chartMeta = (JSON.parse(await chartFile.file.text()) as RpeJson).META;
              metadata = updateMetadata(metadata, chartMeta);
            } catch (e) {
              console.debug('Chart is not a valid RPE JSON:', e);
            }
            await createBundle(chartFile, songFile, illustrationFile, {
              id: asset.id,
              ...metadata,
            });
            bundlesResolved++;
            continue;
          }
        }
      }
      // resource pack (PhiZone format)
      {
        const metadata = readMetadataForRespack(content);
        if (metadata) {
          try {
            resourcePacks.push(await importRespack(metadata));
            resourcePacks = resourcePacks;
            assets = assets.filter((a) => a.id !== asset.id);
            respacksResolved++;
          } catch (e) {
            console.debug(e);
          }
          continue;
        }
      }
      // resource pack (Phira format)
      {
        const metadata = readMetadataForPhiraRespack(content);
        if (metadata) {
          try {
            resourcePacks.push(await importRespack(await convertPhiraRespack(metadata), false));
            resourcePacks = resourcePacks;
            assets = assets.filter((a) => a.id !== asset.id);
            respacksResolved++;
          } catch (e) {
            console.debug(e);
          }
          continue;
        }
      }
    }
    if (
      chartBundles.length === 0 &&
      chartFiles.length > 0 &&
      audioFiles.length > 0 &&
      imageFiles.length > 0
    ) {
      let metadata = {
        name: '',
        song: '',
        picture: '',
        chart: '',
        composer: '',
        charter: '',
        illustration: '',
        level: '',
      };
      try {
        metadata = readMetadataForChart(
          undefined,
          (JSON.parse(await chartFiles[0].file.text()) as RpeJson).META,
        );
      } catch (e) {
        console.debug('Chart is not a valid RPE JSON:', e);
      }
      await createBundle(chartFiles[0], undefined, undefined, metadata, undefined, true);
      bundlesResolved++;
    }
    if (chartBundles.length > 0 && selectedBundle === -1) {
      currentBundle = chartBundles[0];
      selectedBundle = currentBundle.id;
      selectedSong = currentBundle.song;
      selectedChart = currentBundle.chart;
      selectedIllustration = currentBundle.illustration;
    }
    if (resourcePacks.length > 1 && selectedResourcePack === DEFAULT_RESOURCE_PACK_ID) {
      selectedResourcePack = resourcePacks[1].id;
    }
    chartFiles = chartFiles;
    audioFiles = audioFiles;
    imageFiles = imageFiles;
    assets = assets;
    chartBundles = chartBundles;
    done = true;
    showRespack = respacksResolved > 0;
    declareFinished();
    send({
      type: 'inputResponse',
      payload: {
        bundlesResolved,
        respacksResolved,
      },
    });
  };

  const declareFinished = () => {
    if (!done) return;
    progress = 1;
    progressDetail = m.finished();
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

  const getUrl = (blob: Blob | undefined) => (blob ? URL.createObjectURL(blob) : null);

  const humanizeFileSize = (size: number) => {
    var i = size == 0 ? 0 : clamp(Math.floor(Math.log(size) / Math.log(1024)), 0, 4);
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };

  const handleParams = async (params: Config) => {
    preferences = params.preferences;
    mediaOptions = params.mediaOptions;
    toggles = {
      autostart: params.autostart,
      autoplay: params.autoplay,
      practice: params.practice,
      adjustOffset: params.adjustOffset,
      render: params.render,
      newTab: params.newTab,
      inApp: params.inApp,
    };
    send({
      type: 'bundle',
      payload: {
        metadata: params.metadata,
        resources: {
          song:
            audioFiles.find((file) => file.id === currentBundle?.song)?.file ??
            (await download(params.resources.song)),
          chart:
            chartFiles.find((file) => file.id === currentBundle?.chart)?.file ??
            (await download(params.resources.chart)),
          illustration:
            imageFiles.find((file) => file.id === currentBundle?.illustration)?.file ??
            (await download(params.resources.illustration)),
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
    start(params);
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
    for (const bundleFiles of await decompressZipArchives(zipArchives)) {
      await handleFiles(bundleFiles);
    }
    await handleFiles(regularFiles);
  };

  const configureWebviewWindow = (webview: WebviewWindow) => {
    if (monitor) {
      const factor = 0.8;
      let { width, height } =
        toggles.render && mediaOptions.overrideResolution
          ? fit(
              mediaOptions.overrideResolution[0],
              mediaOptions.overrideResolution[1],
              monitor.size.width,
              monitor.size.height,
              true,
            )
          : preferences.aspectRatio
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

  const start = async (config: Config) => {
    localStorage.setItem('player', JSON.stringify(config));

    const { resourcePack, metadata, preferences, resources, mediaOptions, ...rest } = config;

    const paramsString = queryString.stringify(
      {
        resourcePack:
          resourcePack === DEFAULT_RESOURCE_PACK
            ? null
            : encodeURIComponent(JSON.stringify(resourcePack)),
        ...metadata,
        ...preferences,
        ...resources,
        ...mediaOptions,
        ...rest,
      },
      {
        arrayFormat: 'none',
        skipEmptyString: true,
        skipNull: true,
        sort: false,
      },
    );
    const url = paramsString.length <= 15360 ? `${base}/play/?${paramsString}` : `${base}/play/`;

    if (IS_TAURI) {
      if (toggles.render) {
        await setupRendering();
      }
      monitor = await currentMonitor();
      if (Capacitor.getPlatform() === 'web' && toggles.newTab) {
        const webview = new WebviewWindow(`player-${Date.now()}`, {
          url,
        });
        webview.once('tauri://created', () => {
          webview.setTitle(m.app_title());
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
  <title>{m.app_title()}</title>
</svelte:head>

<dialog id="clipboard" class="modal" bind:this={clipboardModal}>
  <div class="modal-box max-w-3xl">
    <h3 class="text-lg font-bold">{m.resolve_url()}</h3>
    <p class="w-full py-4 inline-flex flex-col gap-2 text-center break-words">
      {m['resolve_url_description.0']()}
      <span class="font-semibold">{clipboardUrl?.href}</span>
      {m['resolve_url_description.1']()}
    </p>
    <div class="modal-action">
      <form method="dialog" class="gap-3 flex justify-center">
        <button
          class="inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
          onclick={() => {
            resolveClipboardUrl('zip');
          }}
        >
          {m.resolve_as_zip()}
        </button>
        <button
          class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
          onclick={() => {
            resolveClipboardUrl('file');
          }}
        >
          {m.resolve_as_file()}
        </button>
        <button
          class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
          onclick={async () => {
            clipboardModal.close();
            clipboardUrl = undefined;
          }}
        >
          {m.ignore()}
        </button>
      </form>
    </div>
  </div>
</dialog>

<div class="max-w-2xl text-center mx-auto">
  <h1 class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200">
    {m.app_title().split(' ').slice(0, -1).join(' ')}
    <span class="bg-clip-text bg-gradient-to-tl from-blue-500 to-violet-600 text-transparent">
      {m.app_title().split(' ').slice(-1).join(' ')}
    </span>
  </h1>
</div>

<div class="max-w-3xl text-center mx-auto">
  <p class="text-xs sm:text-sm md:text-base lg:text-lg text-gray-600 dark:text-neutral-400">
    {m.app_subtitle()}
  </p>
</div>

<div class="mt-3 gap-3 flex justify-center">
  <button
    type="button"
    class="inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
    onclick={() => {
      showCollapse = !showCollapse;
    }}
  >
    {m.get_started()}
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
      {m.download_app()}
      <i class="fa-solid fa-download"></i>
    </a>
    <dialog id="app" class="modal" bind:this={appModal}>
      <div class="modal-box">
        <h3 class="text-lg font-bold">{m.use_the_app()}</h3>
        <p class="py-4">
          {m['use_the_app_description.0']()}
          <a href="{base}/app" target="_blank" class="text-accent hover:underline">
            {m['use_the_app_description.1']()}
          </a>
          {m['use_the_app_description.2']()}
        </p>
        <div class="relative flex items-start">
          <div class="flex items-center h-5 mt-1">
            <input
              id="remember-app-preference"
              name="remember-app-preference"
              type="checkbox"
              class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
              aria-describedby="remember-app-preference-description"
              bind:checked={modalMem}
            />
          </div>
          <label for="remember-app-preference" class="ms-3 transition">
            <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
              {m.remember_choice()}
            </span>
            <span
              id="remember-app-preference-description"
              class="block text-sm text-gray-600 dark:text-neutral-500"
            >
              {m.remember_choice_description()}
            </span>
          </label>
        </div>
        <div class="modal-action">
          <form method="dialog" class="gap-3 flex justify-center">
            <button
              class="inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
              onclick={() => {
                window.open(
                  `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${page.url.search}`,
                );
                if (modalMem) {
                  toggles.inApp = 1;
                  localStorage.setItem('toggles', JSON.stringify(toggles));
                }
              }}
            >
              {m.open_in_app()}
            </button>
            <button
              class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
              onclick={async () => {
                await handleParamFiles(page.url.searchParams);
                if (modalMem) {
                  toggles.inApp = 2;
                  localStorage.setItem('toggles', JSON.stringify(toggles));
                }
              }}
            >
              {m.proceed_with_browser()}
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
      {m.view_on_github()}
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
  <label
    class="absolute top-5 left-5 swap swap-rotate text-center transition opacity-0"
    class:opacity-100={done}
    class:pointer-events-none={!done}
  >
    <input type="checkbox" bind:checked={showRespack} />
    <div class="swap-on">{m.switch_to_chart()}</div>
    <div class="swap-off">{m.switch_to_respack()}</div>
  </label>
  <div class="absolute top-4 right-4">
    <LanguageSwitcher />
  </div>
  <div
    class="collapse-content flex flex-col gap-4 items-center pt-0 transition-[padding] duration-300"
    class:pt-4={showCollapse}
  >
    <div class="flex flex-col lg:flex-row">
      <label class="form-control w-full max-w-xs">
        <div class="label pt-0">
          <span class="label-text">{m.load_files()}</span>
        </div>
        <input
          type="file"
          multiple
          accept={IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web'
            ? null
            : '.pez,.pec,.yml,.yaml,.shader,.glsl,.frag,.fsh,.fs,.ttf,.otf,.fnt,application/zip,application/json,image/*,video/*,audio/*,text/*'}
          class="file-input file-input-bordered w-full max-w-xs file:btn dark:file:btn-neutral file:no-animation border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600"
          oninput={async (e) => {
            const fileList = e.currentTarget.files;
            if (!fileList || fileList.length === 0) return;
            const files = Array.from(fileList);
            const zipArchives = files.filter(isZip);
            for (const bundleFiles of await decompressZipArchives(zipArchives)) {
              await handleFiles(bundleFiles);
            }
            await handleFiles(files.filter((file) => !isZip(file)));
          }}
        />
      </label>
      {#if !IS_ANDROID_OR_IOS && Capacitor.getPlatform() === 'web'}
        <div class="divider mb-1 lg:divider-horizontal">{m.or()}</div>
        <label class="form-control w-full max-w-xs">
          <div class="label pt-0">
            <span class="label-text">{m.load_directory()}</span>
          </div>
          <input
            bind:this={directoryInput}
            type="file"
            multiple
            class="file-input file-input-bordered w-full max-w-xs file:btn dark:file:btn-neutral file:no-animation border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600"
            oninput={async () =>
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
            {progressDetail ?? m.processing_files()}
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
    {#if !showRespack}
      <div
        class="w-full flex flex-col md:flex-row gap-4 opacity-0 transition"
        class:opacity-100={done}
        class:pointer-events-none={!done}
      >
        <div class="flex md:w-2/3 flex-col gap-3">
          <div class="carousel-with-bar rounded-box w-fit">
            {#key chartBundles}
              {#each chartBundles as bundle}
                <div class="carousel-item relative">
                  <button
                    class="transition hover:brightness-75"
                    onclick={() => {
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
                      <p class="text-success uppercase">{m.selected()}</p>
                    </div>
                  </button>
                  {#if chartBundles.length > 1}
                    <button
                      class="absolute bottom-1 right-1 btn btn-sm btn-circle btn-outline btn-error backdrop-blur-xl"
                      aria-label="Delete"
                      onclick={() => {
                        chartBundles = chartBundles.filter((b) => b.id !== bundle.id);
                        if (selectedBundle === bundle.id) {
                          currentBundle = chartBundles[0];
                          selectedBundle = chartBundles[0].id;
                          selectedChart = chartBundles[0].chart;
                          selectedSong = chartBundles[0].song;
                          selectedIllustration = chartBundles[0].illustration;
                        }
                        if (chartBundles.every((b) => b.chart !== bundle.chart)) {
                          chartFiles = chartFiles.filter((file) => file.id !== bundle.chart);
                        }
                        if (chartBundles.every((b) => b.song !== bundle.song)) {
                          audioFiles = audioFiles.filter((file) => file.id !== bundle.song);
                        }
                        if (chartBundles.every((b) => b.illustration !== bundle.illustration)) {
                          imageFiles = imageFiles.filter((file) => file.id !== bundle.illustration);
                        }
                      }}
                    >
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  {/if}
                </div>
              {/each}
            {/key}
            <button
              class="carousel-item relative w-48 h-48 bg-neutral-200 dark:bg-neutral transition hover:brightness-75"
              onclick={async () => {
                const chart = chartFiles.find((file) => file.id === selectedChart);
                const song = audioFiles.find((file) => file.id === selectedSong);
                const illustration = imageFiles.find((file) => file.id === selectedIllustration);
                if (chart && song && illustration) {
                  const bundle = await createBundle(
                    chart,
                    song,
                    illustration,
                    undefined,
                    currentBundle?.metadata ?? {
                      title: '',
                      composer: '',
                      charter: '',
                      illustrator: '',
                      levelType: 2,
                      level: '',
                      difficulty: null,
                    },
                  );
                  if (!bundle) return;
                  currentBundle = bundle;
                  selectedBundle = bundle.id;
                  selectedSong = bundle.song;
                  selectedChart = bundle.chart;
                  selectedIllustration = bundle.illustration;
                }
              }}
            >
              <div class="absolute inset-0 flex justify-center items-center gap-2 uppercase">
                <span class="btn btn-xs btn-circle btn-outline btn-active no-animation">
                  <i class="fa-solid fa-plus"></i>
                </span>
                <p>{m.new()}</p>
              </div>
            </button>
          </div>
          {#if selectedBundle !== -1 && currentBundle}
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.title']()}
                </span>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={currentBundle.metadata.title}
                    class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                  />
                </div>
              </div>
              <div>
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.composer']()}
                </span>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={currentBundle.metadata.composer}
                    class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                  />
                </div>
              </div>
              <div>
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.illustrator']()}
                </span>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={currentBundle.metadata.illustrator}
                    class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                  />
                </div>
              </div>
              <div>
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.charter']()}
                </span>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={currentBundle.metadata.charter}
                    class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                  />
                </div>
              </div>
              <div>
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.level_type']()}
                </span>
                <div class="relative">
                  <select
                    bind:value={currentBundle.metadata.levelType}
                    class="form-select py-3 px-4 pe-9 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
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
                <span class="block text-sm font-medium mb-1 dark:text-white">
                  {m['metadata.level']()}
                </span>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={currentBundle.metadata.level}
                    class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
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
                        {m['asset.name']()}
                      </th>
                      <th
                        scope="col"
                        class="px-3 py-2 w-1/4 md:w-1/5 text-ellipsis overflow-hidden whitespace-nowrap text-start text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                      >
                        {m['asset.type']()}
                      </th>
                      <th
                        scope="col"
                        class="hidden sm:table-cell px-3 py-2 w-1/6 text-ellipsis overflow-hidden whitespace-nowrap text-start text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                      >
                        {m['asset.size']()}
                      </th>
                      <th
                        scope="col"
                        class="px-3 py-2 text-ellipsis overflow-hidden whitespace-nowrap text-end text-xs font-medium text-gray-500 uppercase dark:text-neutral-500"
                      >
                        {m['asset.actions']()}
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
                              class="form-select py-1 px-2 pe-8 block border-gray-200 rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                            >
                              {#each Array(6) as _, i}
                                <option value={i} selected={asset.type === i}>
                                  {#if i === 0}
                                    {m['asset.types.0']()}
                                  {:else if i === 1}
                                    {m['asset.types.1']()}
                                  {:else if i === 2}
                                    {m['asset.types.2']()}
                                  {:else if i === 3}
                                    {m['asset.types.3']()}
                                  {:else if i === 4}
                                    {m['asset.types.4']()}
                                  {:else if i === 5}
                                    {m['asset.types.5']()}
                                  {/if}
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
                            onclick={() => {
                              asset.included = !asset.included;
                            }}
                          >
                            {asset.included ? m['asset.exclude']() : m['asset.include']()}
                          </button>
                          <button
                            type="button"
                            class="inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg transition border border-transparent text-blue-500 hover:text-blue-800 focus:outline-none focus:text-blue-800 disabled:opacity-50 disabled:pointer-events-none dark:text-blue-500 dark:hover:text-blue-400 dark:focus:text-blue-400"
                            onclick={() => {
                              assets = assets.filter((a) => a.id !== asset.id);
                            }}
                          >
                            {m.delete()}
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
              class="form-select peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
              value={selectedChart}
              oninput={(e) => {
                selectedChart = parseInt(e.currentTarget.value);
                if (currentBundle) currentBundle.chart = selectedChart;
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
              {m.chart()}
            </span>
          </div>
          <div class="relative">
            <select
              class="form-select peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
              value={selectedSong}
              oninput={(e) => {
                selectedSong = parseInt(e.currentTarget.value);
                if (currentBundle) currentBundle.song = selectedSong;
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
              {m.song()}
            </span>
          </div>
          <div class="relative">
            <select
              class="form-select peer p-4 pe-9 block w-full border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600
              focus:pt-6
              focus:pb-2
              [&:not(:placeholder-shown)]:pt-6
              [&:not(:placeholder-shown)]:pb-2
              autofill:pt-6
              autofill:pb-2"
              value={selectedIllustration}
              oninput={(e) => {
                selectedIllustration = parseInt(e.currentTarget.value);
                if (currentBundle) currentBundle.illustration = selectedIllustration;
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
              {m.illustration()}
            </span>
          </div>
          <div class="grid space-y-3">
            <div class="relative flex items-start">
              <div class="flex items-center h-5 mt-1">
                <input
                  id="autoplay"
                  name="autoplay"
                  type="checkbox"
                  class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                  aria-describedby="autoplay-description"
                  checked={toggles.autoplay}
                  oninput={(e) => {
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
                  {m.autoplay()}
                </span>
                <span
                  id="autoplay-description"
                  class="block text-sm text-gray-600 dark:text-neutral-500"
                >
                  {m.autoplay_description()}
                </span>
              </label>
            </div>
            <div class="relative flex items-start">
              <div class="flex items-center h-5 mt-1">
                <input
                  id="adjust-offset"
                  name="adjust-offset"
                  type="checkbox"
                  class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                  aria-describedby="adjust-offset-description"
                  bind:checked={toggles.adjustOffset}
                  disabled={!toggles.autoplay || (isRenderingAvailable && toggles.render)}
                />
              </div>
              <label
                for="adjust-offset"
                class="ms-3 transition"
                class:opacity-50={!toggles.autoplay || (isRenderingAvailable && toggles.render)}
              >
                <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                  {m.adjust_offset()}
                </span>
                <span
                  id="adjust-offset-description"
                  class="block text-sm text-gray-600 dark:text-neutral-500"
                >
                  {m.adjust_offset_description()}
                </span>
              </label>
            </div>
            <div class="relative flex items-start">
              <div class="flex items-center h-5 mt-1">
                <input
                  id="practice"
                  name="practice"
                  type="checkbox"
                  class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                  aria-describedby="practice-description"
                  bind:checked={toggles.practice}
                  disabled={toggles.autoplay || (isRenderingAvailable && toggles.render)}
                />
              </div>
              <label
                for="practice"
                class="ms-3 transition"
                class:opacity-50={toggles.autoplay || (isRenderingAvailable && toggles.render)}
              >
                <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                  {m.practice()}
                </span>
                <span
                  id="practice-description"
                  class="block text-sm text-gray-600 dark:text-neutral-500"
                >
                  {m.practice_description()}
                </span>
              </label>
            </div>
            {#if IS_TAURI}
              <div
                class="flex flex-col {!isRenderingAvailable && ffmpegEncoders === undefined
                  ? 'tooltip'
                  : overrideResolution &&
                      (mediaResolutionWidth % 2 === 1 || mediaResolutionHeight % 2 === 1)
                    ? 'tooltip tooltip-warning'
                    : ''}"
                data-tip={!isRenderingAvailable && ffmpegEncoders === undefined
                  ? m.ffmpeg_not_found()
                  : m.odd_dimensions_warning()}
              >
                <div class="relative flex items-start">
                  <div class="flex items-center h-5 mt-1">
                    <input
                      id="render"
                      name="render"
                      type="checkbox"
                      class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                      aria-describedby="render-description"
                      checked={toggles.render}
                      disabled={!isRenderingAvailable}
                      oninput={(e) => {
                        if (e.currentTarget.checked && !setupRendering()) {
                          e.currentTarget.checked = false;
                        }
                        toggles.render = e.currentTarget.checked;
                        if (toggles.render) {
                          toggles.autoplay = true;
                          toggles.adjustOffset = false;
                          toggles.practice = false;
                          toggles.autostart = true;
                        }
                      }}
                    />
                  </div>
                  <label for="render" class="ms-3" class:opacity-50={!isRenderingAvailable}>
                    <button
                      class="flex items-center gap-1 text-sm font-semibold text-gray-800 dark:text-neutral-300 disabled:pointer-events-none"
                      disabled={!isRenderingAvailable}
                      onclick={async () => {
                        showMediaCollapse = !showMediaCollapse;
                        await setupRendering();
                      }}
                    >
                      <p>{m.render()}</p>
                      <span class="transition {showMediaCollapse ? '-rotate-180' : 'rotate-0'}">
                        <i class="fa-solid fa-angle-down fa-sm"></i>
                      </span>
                    </button>
                    <span
                      id="render-description"
                      class="block text-sm text-gray-600 dark:text-neutral-500"
                    >
                      {m.render_description()}
                    </span>
                  </label>
                </div>
                <div
                  class="collapse h-0 border hover:shadow-sm rounded-xl dark:border-neutral-700 dark:shadow-neutral-700/70 bg-base-200 bg-opacity-30 backdrop-blur-2xl collapse-transition"
                  class:collapse-open={showMediaCollapse}
                  class:min-h-fit={showMediaCollapse}
                  class:h-full={showMediaCollapse}
                  class:mt-2={showMediaCollapse}
                  class:opacity-0={!showMediaCollapse}
                >
                  <div
                    class="collapse-content flex flex-col gap-4 items-center pt-0 transition-[padding] duration-300"
                    class:pt-4={showMediaCollapse}
                  >
                    <div class="grid sm:grid-cols-6 md:grid-cols-1 lg:grid-cols-6 gap-3">
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.frame_rate()}
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={mediaOptions.frameRate}
                            class="form-input py-3 px-4 pe-12 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">{m.fps()}</span>
                          </div>
                        </div>
                      </div>
                      <div class="sm:col-span-4 md:col-span-1 lg:col-span-4">
                        <div class="flex justify-between items-center">
                          <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                            {m.override_resolution()}
                          </span>
                          <input
                            type="checkbox"
                            class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                            bind:checked={overrideResolution}
                          />
                        </div>
                        <div class="flex rounded-lg shadow-sm">
                          <input
                            type="number"
                            min="2"
                            step="2"
                            class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm -ms-px first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg text-sm relative focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                            disabled={!overrideResolution}
                            bind:value={mediaResolutionWidth}
                          />
                          <span
                            class="py-3 px-2 inline-flex items-center min-w-fit border border-gray-200 text-sm text-gray-500 -ms-px w-auto first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg bg-base-100 dark:border-neutral-700 dark:text-neutral-400"
                            class:opacity-50={!overrideResolution}
                          >
                            <i class="fa-solid fa-xmark"></i>
                          </span>
                          <input
                            type="number"
                            min="2"
                            step="2"
                            class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm -ms-px first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg text-sm relative focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                            disabled={!overrideResolution}
                            bind:value={mediaResolutionHeight}
                          />
                        </div>
                      </div>
                      <div class="sm:col-span-3 md:col-span-1 lg:col-span-3">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.video_encoder()}
                        </span>
                        <div class="relative">
                          <select
                            bind:value={mediaOptions.videoCodec}
                            class="form-select py-3 px-4 pe-8 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          >
                            {#if ffmpegEncoders}
                              {#each ffmpegEncoders.filter((e) => e.codec !== null && ['h264', 'hevc', 'av1', 'mpeg4'].includes(e.codec)) as encoder}
                                <option value={encoder.name}>{encoder.displayName}</option>
                              {/each}
                            {/if}
                          </select>
                        </div>
                      </div>
                      <div class="sm:col-span-3 md:col-span-1 lg:col-span-3">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.video_bitrate()}
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={mediaOptions.videoBitrate}
                            class="form-input py-3 px-4 pe-14 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">{m.kbps()}</span>
                          </div>
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.vsync()}
                        </span>
                        <div class="relative">
                          <select
                            bind:value={mediaOptions.vsync}
                            class="form-select py-3 px-4 pe-8 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          >
                            <option value={true}>{m.on()}</option>
                            <option value={false}>{m.off()}</option>
                          </select>
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.results_loops()}
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            bind:value={mediaOptions.resultsLoopsToRender}
                            class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                        </div>
                      </div>
                      <div class="sm:col-span-2 md:col-span-1 lg:col-span-2">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.audio_bitrate()}
                        </span>
                        <div class="relative">
                          <input
                            type="number"
                            bind:value={mediaOptions.audioBitrate}
                            class="form-input py-3 px-4 pe-14 block w-full border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <div
                            class="absolute inset-y-0 end-0 flex items-center pointer-events-none z-20 pe-4"
                          >
                            <span class="text-gray-500 dark:text-neutral-500">{m.kbps()}</span>
                          </div>
                        </div>
                      </div>
                      <div class="sm:col-span-6 md:col-span-1 lg:col-span-6">
                        <span class="block text-left text-sm font-medium mb-1 dark:text-white">
                          {m.export_path()}
                        </span>
                        <div class="flex rounded-lg">
                          <input
                            type="text"
                            bind:value={mediaOptions.exportPath}
                            class="form-input py-3 px-4 block w-full border-gray-200 shadow-sm text-sm focus:z-10 rounded-s-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                          />
                          <button
                            class="py-3 px-4 inline-flex justify-center items-center text-nowrap gap-x-2 text-center text-sm font-medium shadow-sm rounded-e-lg transition border border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500 focus:outline-none focus:border-blue-500 focus:text-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-blue-500 dark:hover:border-blue-500 dark:focus:text-blue-500 dark:focus:border-blue-500"
                            onclick={async () => {
                              const path = await open({
                                directory: true,
                                multiple: false,
                              });
                              if (path) {
                                mediaOptions.exportPath = path;
                              }
                            }}
                          >
                            {m.browse()}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
            <div class="relative flex items-start">
              <div class="flex items-center h-5 mt-1">
                <input
                  id="autostart"
                  name="autostart"
                  type="checkbox"
                  class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                  aria-describedby="autostart-description"
                  bind:checked={toggles.autostart}
                  disabled={isRenderingAvailable && toggles.render}
                />
              </div>
              <label
                for="autostart"
                class="ms-3"
                class:opacity-50={isRenderingAvailable && toggles.render}
              >
                <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                  {m.autostart()}
                </span>
                <span
                  id="autostart-description"
                  class="block text-sm text-gray-600 dark:text-neutral-500"
                >
                  {m.autostart_description()}
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
                    class="form-checkbox transition border-gray-200 rounded text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
                    aria-describedby="newtab-description"
                    bind:checked={toggles.newTab}
                  />
                </div>
                <label for="newtab" class="ms-3">
                  <span class="block text-sm font-semibold text-gray-800 dark:text-neutral-300">
                    {#if IS_TAURI}
                      {m.new_window()}
                    {:else}
                      {m.new_tab()}
                    {/if}
                  </span>
                  <span
                    id="newtab-description"
                    class="block text-sm text-gray-600 dark:text-neutral-500"
                  >
                    {#if IS_TAURI}
                      {m.new_window_description()}
                    {:else}
                      {m.new_tab_description()}
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
              onclick={() => {
                localStorage.setItem('preferences', JSON.stringify(preferences));
                localStorage.setItem('toggles', JSON.stringify(toggles));
                if (toggles.render) {
                  if (overrideResolution) {
                    mediaOptions.overrideResolution = [mediaResolutionWidth, mediaResolutionHeight];
                  } else {
                    mediaOptions.overrideResolution = null;
                  }
                  localStorage.setItem('mediaOptions', JSON.stringify(mediaOptions));
                }
                start(handleConfig());
              }}
            >
              {m.play()}
              <i class="fa-solid fa-angle-right fa-sm"></i>
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="w-full results">
        {#each resourcePacks as pack}
          <div
            class="card text-left w-80 h-96 bg-base-100 overflow-hidden transition border-2 hover:shadow-lg"
            class:normal-border={selectedResourcePack !== pack.id}
            class:border-success={selectedResourcePack === pack.id}
          >
            <figure
              class="w-full h-[167px] flex justify-center items-center"
              class:backdrop-brightness-50={!pack.thumbnail}
            >
              {#if pack.thumbnail}
                <img
                  src={typeof pack.thumbnail === 'string'
                    ? pack.thumbnail
                    : URL.createObjectURL(pack.thumbnail)}
                  alt="Thumbnail"
                  class="w-full h-[167px] object-cover"
                />
              {:else}
                <p>{m.no_thumbnail()}</p>
              {/if}
            </figure>
            <div class="card-body py-5">
              <div class="flex flex-col gap-3 pb-2">
                <div class="flex flex-col">
                  <h2 class="title-strong w-full truncate">
                    {pack.name}
                  </h2>
                  <h2 class="subtitle opacity-80 w-full truncate">
                    {pack.author}
                  </h2>
                </div>
                <p class="description">
                  {pack.description}
                </p>
              </div>
            </div>
            <div class="absolute bottom-5 right-5 flex gap-2">
              <button
                class="btn btn-sm rounded-full btn-outline btn-success uppercase"
                class:btn-active={selectedResourcePack === pack.id}
                onclick={() => {
                  selectedResourcePack = pack.id;
                }}
              >
                {selectedResourcePack === pack.id ? m.selected() : m.select()}
              </button>
              <button
                class="btn btn-sm btn-circle btn-outline btn-success"
                aria-label={m.delete()}
                onclick={async () => {
                  await exportRespack(
                    getTypeOfRespack(pack) === 'string'
                      ? await importRespack(pack as ResourcePackWithId<string>)
                      : (pack as ResourcePackWithId<File>),
                  );
                }}
              >
                <i class="fa-solid fa-file-export"></i>
              </button>
              <button
                class="btn btn-sm btn-circle btn-outline btn-error"
                aria-label={m.delete()}
                onclick={() => {
                  resourcePacks = resourcePacks.filter((b) => b.id !== pack.id);
                  if (selectedResourcePack === pack.id) {
                    selectedResourcePack = DEFAULT_RESOURCE_PACK_ID;
                  }
                }}
              >
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style lang="postcss">
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

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    grid-gap: 1.5rem;
    justify-items: center;
  }

  .title-strong {
    font-size: 1.25rem;
    line-height: 1.4rem;
    font-weight: 800;
  }

  .subtitle {
    font-size: 1rem;
    line-height: 1.2rem;
    font-weight: 600;
  }

  .description {
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    white-space: pre-line;
    word-break: break-word;
    @apply leading-5;
  }

  .normal-border {
    @apply border-gray-400 dark:border-gray-700;
  }
</style>
