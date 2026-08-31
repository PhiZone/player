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
    ResultsMusic,
  } from '$lib/types';
  import {
    clamp,
    convertRespackToURL,
    ensafeFilename,
    exportChart,
    exportRespack,
    extractTgz,
    fit,
    getLines,
    getParams,
    haveSameKeys,
    inferLevelType,
    IS_ANDROID_OR_IOS,
    IS_BROWSER_WITH_BACKEND,
    IS_TAURI,
    IS_TAURI_LIKE,
    isPec,
    isZip,
    notify,
    readMetadataForChart,
    readMetadataForPhiraRespack,
    readMetadataForRespack,
    send,
    updateMetadata,
    uuid,
    versionCompare,
  } from '$lib/utils';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import ProgressOverlay from '$lib/components/shell/ProgressOverlay.svelte';
  import DiscoverView from '$lib/components/discover/DiscoverView.svelte';
  import LibraryView from '$lib/components/library/LibraryView.svelte';
  import ChartDetailPage from '$lib/components/library/ChartDetailPage.svelte';
  import ImportDialog from '$lib/components/import/ImportDialog.svelte';
  import { slideFade } from '$lib/motion';
  import SettingsSheet from '$lib/components/settings/SettingsSheet.svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import { Network } from '@capacitor/network';
  import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
  import { currentMonitor, type Monitor } from '@tauri-apps/api/window';
  import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
  import { platform, arch } from '@tauri-apps/plugin-os';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { App, type URLOpenListenerEvent } from '@capacitor/app';
  import { Clipboard } from '@capacitor/clipboard';
  import { page } from '$app/state';
  import { REPO_API_LINK, VERSION } from '$lib';
  import { SendIntent, type Intent } from 'send-intent';
  import { Filesystem } from '@capacitor/filesystem';
  import { homeDir, join, tempDir, videoDir } from '@tauri-apps/api/path';
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
  import { open, ask, confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
  import { DEFAULT_RESOURCE_PACK, DEFAULT_RESOURCE_PACK_ID } from '$lib/player/constants';
  import { getFFmpeg, loadFFmpeg } from '$lib/player/services/ffmpeg';
  import { fetchFile } from '@ffmpeg/util';
  import { convertHoldAtlas, getImageDimensions } from '$lib/converters/phira/respack';
  import { hexToRgba } from '$lib/player/utils';
  import { m } from '$lib/paraglide/messages';
  import { detectToyEnvironment, toyGetUserProfile, type ToyUserProfile } from '$lib/services/toy';
  import {
    saveRespack,
    loadAllRespacks,
    deleteRespack as deleteStoredRespack,
    saveSelectedRespack,
    loadSelectedRespack,
  } from '$lib/services/respackStorage';
  import { tauriInvoke } from '$lib/services/tauriIpc';
  import { fsReadFile } from '$lib/services/tauriFsBridge';
  import {
    computeChartChecksum,
    deleteChart as deleteStoredChart,
    loadAllChartSummaries,
    loadChart as loadStoredChart,
    syncChart as syncStoredChart,
  } from '$lib/services/chartStorage';
  import { groupFilesIntoCharts, type ChartGroupInput } from '$lib/services/chartGrouping';
  import type { StoredChart, StoredChartSummary } from '$lib/types';

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
    /** Storage id once this bundle has been synced to chart storage. */
    storedId?: string;
    storedCreatedAt?: number;
    storedChecksum?: string;
    /** Original import file name (archive/folder imports only). */
    sourceName?: string;
    /** Per-chart asset files scoped at import time (within-batch grouping). */
    scopedAssetFiles?: Set<File>;
  }

  // Resource pack storage is handled by $lib/services/chartStorage

  let overrideResolution = false;
  let monitor: Monitor | null = null;

  // ── App-shell state ──────────────────────────────────────────────────
  // Remembers which tab (Discover/Library) the user last landed on, so the
  // app reopens there next time; first-time visitors default to Discover.
  const LAST_TAB_KEY = 'lastLandingTab';
  let activeTab: 'discover' | 'library' =
    localStorage.getItem(LAST_TAB_KEY) === 'library' ? 'library' : 'discover';
  let settingsOpen = false;
  let importOpen = false;
  // Bilibili Toy integration: logged-in user shown in the top bar. `toyUser`
  // stays null until the platform grant exists; `toyLoginRequired` shows the
  // login button (the first getUserProfile call must come from a gesture).
  let toyUser: ToyUserProfile | null = null;
  let toyLoginRequired = false;
  let toyLoginLoading = false;
  let detailOpen = false;
  let clipboardModalOpen = false;
  let duplicateModalOpen = false;
  let appModalOpen = false;
  let modalMem = false;

  let storedChartSummaries: StoredChartSummary[] = [];

  // True only while handling programmatic postMessage imports (zipInput/
  // fileInput/zipUrlInput/fileUrlInput) — those must not write to storage.
  let isProgrammaticImport = false;
  /** Raw files of the current import batch, used for within-batch grouping. */
  let batchEntries: ChartGroupInput[] = [];
  // Duplicate-import detection (checksum dedup).
  const DUPLICATE_CHOICE_KEY = 'duplicateImportChoice';
  // Set by the player after saving an offset-adjusted chart; the landing page
  // checks it on mount and via storage events to reload the saved chart.
  const RELOAD_CHART_KEY = 'reloadChartId';
  let duplicateModalMem = false;
  let duplicateResolve: ((choice: 'overwrite' | 'load') => void) | null = null;

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
    aspectRatio: [3, 2],
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
  // Persistent settings (stored in localStorage and restored on startup).
  let toggles = {
    render: false,
    newTab: Capacitor.getPlatform() === 'web',
    inApp: IS_TAURI_LIKE || Capacitor.getPlatform() !== 'web' ? 2 : 0,
  };
  // Mirror of `toggles.render` for the settings sheet; turning it on may be
  // rejected when rendering is unavailable in this environment.
  let renderOn = false;
  const handleRenderToggle = (checked: boolean) => {
    if (checked && !setupRendering()) return;
    renderOn = checked;
    toggles.render = checked;
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

  let isDragging = false;
  let dragCounter = 0;

  let isHandedOff = false;

  const ACCEPTED_EXTENSIONS = [
    '.pez',
    '.pec',
    '.yml',
    '.yaml',
    '.shader',
    '.glsl',
    '.frag',
    '.fsh',
    '.fs',
    '.ttf',
    '.otf',
    '.fnt',
  ];
  const ACCEPTED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
  const ACCEPTED_MIME_TYPES = [
    'application/zip',
    'application/json',
    'application/x-zip-compressed',
  ];

  const isAcceptedFile = (file: File) => {
    const name = file.name.toLowerCase();
    if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
    const type = file.type;
    if (ACCEPTED_MIME_TYPES.includes(type)) return true;
    if (ACCEPTED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
    return false;
  };

  const hasValidDragItems = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer?.items) return false;
    for (const item of dataTransfer.items) {
      if (item.kind !== 'file') continue;
      const type = item.type;
      if (!type) return true;
      if (ACCEPTED_MIME_TYPES.includes(type)) return true;
      if (ACCEPTED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
    }
    return false;
  };

  let clipboardUrl: URL | undefined;
  let lastResolvedClipboardUrl: URL | undefined;
  let ignoredUrls: string[] = [];

  const checkParam = (key: string, values: string[]) =>
    values.some((v) => v === page.url.searchParams.get(key));

  let automate = checkParam('automate', ['1', 'true']);

  let overrideTitle: string | undefined;
  let overrideLevel: string | undefined;

  const applyMetadataOverrides = (bundle: ChartBundle) => {
    if (overrideTitle !== undefined) {
      bundle.metadata.title = overrideTitle;
    }
    if (overrideLevel !== undefined) {
      bundle.metadata.level = overrideLevel;
      bundle.metadata.levelType = inferLevelType(overrideLevel);
    }
  };

  const unlistens: UnlistenFn[] = [];

  /** Read a file from the backend filesystem and return it as a File object. */
  const filePathHandler = async (path: string): Promise<File> => {
    const data = await fsReadFile(path);
    return new File([new Uint8Array(data)], path.split(/[\\/]/).pop() || path);
  };

  onMount(async () => {
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
    addEventListener('storage', onStorageEvent);
    unlistens.push(() => removeEventListener('storage', onStorageEvent));

    try {
      const storedPacks = await loadAllRespacks();
      if (storedPacks.length > 0) {
        resourcePacks.push(...storedPacks);
        resourcePacks = resourcePacks;
      }
      const storedSelection = loadSelectedRespack();
      if (storedSelection && resourcePacks.some((p) => p.id === storedSelection)) {
        selectedResourcePack = storedSelection;
      }
    } catch (e) {
      console.warn('Failed to load stored resource packs:', e);
    }

    try {
      storedChartSummaries = await loadAllChartSummaries();
    } catch (e) {
      console.warn('Failed to load stored charts:', e);
    }

    await init();

    // Bilibili Toy environment: ask for the user's profile (the platform
    // shows its own consent dialog on first grant; a prior v2 grant is
    // reused silently). If the call needs a user gesture, the top bar shows
    // a login button instead.
    if (await detectToyEnvironment()) {
      toyUser = await toyGetUserProfile();
      toyLoginRequired = toyUser === null;
    }

    // The player may have saved an offset-adjusted chart (this window, or
    // another window/tab) — reload it so reopening applies the new offset.
    await reloadStoredChartFromFlag();

    addEventListener('message', async (e: MessageEvent<IncomingMessage>) => {
      const message = e.data;
      if (!message || !message.type) return;
      if (message.type === 'play') {
        // Parent-site-driven playback is programmatic; it must not write to
        // local storage (same rule as zip/fileInput imports).
        isProgrammaticImport = true;
        try {
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
        } finally {
          isProgrammaticImport = false;
        }
      } else if (
        message.type === 'zipInput' ||
        message.type === 'fileInput' ||
        message.type === 'zipUrlInput' ||
        message.type === 'fileUrlInput'
      ) {
        // Programmatic/automated imports from an embedding parent must not
        // silently write to local storage.
        isProgrammaticImport = true;
        try {
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
          batchEntries = bundleFileMatrix.flat().map((file) => ({ file }));
          for (const files of bundleFileMatrix) {
            await handleFiles(files, replacee);
          }
        } finally {
          isProgrammaticImport = false;
        }
      }
    });

    if (IS_TAURI) {
      onOpenUrl(async (urls) => {
        await handleRedirect(urls[0]);
      });
      listen('files-opened', async (event: { payload: string[] }) => {
        const filePaths = event.payload;
        await handleFilePaths(filePaths, filePathHandler);
      });
    }

    if (IS_TAURI_LIKE) {
      if (isFirstLoad) {
        if (crossOriginIsolated) ffmpegEncoders = await getEncoders();
        if (!isHandedOff) {
          const result: string[] = await tauriInvoke('get_files_opened');
          if (result && result.length > 0) {
            await handleFilePaths(result, filePathHandler);
          }
        }
      }
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

    if (automate) {
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

    if (IS_TAURI_LIKE) {
      const args: Record<string, string> = await tauriInvoke('get_args');
      if (args['browser'] && IS_TAURI) isHandedOff = true;
      if (args['preferences']) pref = args['preferences'];
      if (args['toggles']) tgs = args['toggles'];
      if (args['mediaOptions']) mopts = args['mediaOptions'];
      automate = !isHandedOff && args['automate'] === 'true';
      if (args['title']) overrideTitle = args['title'];
      if (args['level']) overrideLevel = args['level'];
    }

    pref ??= localStorage.getItem('preferences');
    tgs ??= localStorage.getItem('toggles');
    mopts ??= localStorage.getItem('mediaOptions');

    if (pref) {
      pref = JSON.parse(pref);
      if (haveSameKeys(pref, preferences)) preferences = pref;
    }
    if (tgs) {
      // Only the persistent settings (render/newTab/inApp) are restored.
      // One-time play options (autoplay/practice/adjustOffset/autostart) are
      // deliberately ignored here — they exist for a single play only.
      const parsed = JSON.parse(tgs) as Record<string, unknown>;
      if (typeof parsed.render === 'boolean') toggles.render = parsed.render;
      if (typeof parsed.newTab === 'boolean') toggles.newTab = parsed.newTab;
      if (typeof parsed.inApp === 'number') toggles.inApp = parsed.inApp;
      renderOn = toggles.render;
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

    if (!mediaOptions.exportPath && IS_TAURI_LIKE) {
      try {
        if (IS_TAURI) {
          mediaOptions.exportPath = await join(await videoDir(), 'PhiZone Player');
        } else {
          const { pathJoin, pathVideoDir } = await import('$lib/services/tauriFsBridge');
          mediaOptions.exportPath = await pathJoin(await pathVideoDir(), 'PhiZone Player');
        }
      } catch {
        if (IS_TAURI) {
          mediaOptions.exportPath = await join(await homeDir(), 'PhiZone Player');
        }
      }
    }

    if (
      !IS_TAURI_LIKE &&
      Capacitor.getPlatform() === 'web' &&
      (page.url.searchParams.has('file') || page.url.searchParams.has('zip'))
    ) {
      if (toggles.inApp === 0 && !automate) {
        appModalOpen = true;
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

  const handleConfig = (
    playOptions: {
      autoplay?: boolean;
      practice?: boolean;
      adjustOffset?: boolean;
      autostart?: boolean;
    } = { autoplay: true },
  ) => {
    const assetsIncluded = bundleAssets().filter((asset) => asset.included);
    if (!currentBundle) {
      alert(m.no_bundle_available());
      throw new Error(m.no_bundle_available());
    }
    const songFile = audioFiles.find((file) => file.id === currentBundle!.song)?.file;
    const chartFile = chartFiles.find((file) => file.id === currentBundle!.chart)?.file;
    const illustrationFile = imageFiles.find((file) => file.id === currentBundle!.illustration);
    return {
      resources: {
        song: getUrl(songFile) ?? '',
        chart: getUrl(chartFile) ?? '',
        illustration: illustrationFile?.url ?? '',
        // The URLs are blob URLs that hide the original names; carry the
        // names along so offset-adjusted saves keep them.
        songName: songFile?.name,
        illustrationName: illustrationFile?.file.name,
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
      chartId: currentBundle?.storedId ?? undefined,
      chartCreatedAt: currentBundle?.storedCreatedAt ?? undefined,
      sourceName: currentBundle?.sourceName,
      autoplay: playOptions.autoplay ?? false,
      practice: playOptions.practice ?? false,
      adjustOffset: playOptions.adjustOffset ?? false,
      autostart: playOptions.autostart ?? false,
      ...toggles,
      automate,
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

  const ZIP_EXTENSIONS = ['pez', 'zip'];
  const PLAIN_FILE_EXTENSIONS = [
    'pec',
    'yml',
    'yaml',
    'shader',
    'glsl',
    'frag',
    'fsh',
    'fs',
    'ttf',
    'otf',
    'fnt',
    'json',
    'xml',
    'csv',
    'txt',
    'log',
    'md',
    'html',
    'css',
    'js',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'bmp',
    'webp',
    'svg',
    'ico',
    'tiff',
    'tif',
    'avif',
    'apng',
    'mp4',
    'webm',
    'mkv',
    'avi',
    'mov',
    'flv',
    'wmv',
    'mp3',
    'wav',
    'ogg',
    'flac',
    'aac',
    'm4a',
    'wma',
    'opus',
    'woff',
    'woff2',
  ];

  const getUrlExtension = (url: URL): string | undefined => {
    const lastSegment = url.pathname.split('/').pop() ?? '';
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex > 0) {
      return lastSegment.slice(dotIndex + 1).toLowerCase();
    }
    return undefined;
  };

  const handleClipboard = async () => {
    let text: string | undefined;
    try {
      if (Capacitor.getPlatform() === 'web') {
        if (!IS_TAURI && !navigator.clipboard?.readText) {
          notify(m.clipboard_unavailable(), 'warning');
          return;
        }
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
    if (clipboardModalOpen) return;
    if (!text) {
      notify(m.clipboard_no_url());
      return;
    }
    try {
      const url = new URL(text);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (lastResolvedClipboardUrl && lastResolvedClipboardUrl.href === url.href) {
          return;
        }
        if (ignoredUrls.includes(url.href)) {
          return;
        }
        clipboardUrl = url;
        const ext = getUrlExtension(url);
        if (ext && ZIP_EXTENSIONS.includes(ext)) {
          resolveClipboardUrl('zip');
        } else if (ext && PLAIN_FILE_EXTENSIONS.includes(ext)) {
          resolveClipboardUrl('file');
        } else {
          clipboardModalOpen = true;
        }
      } else {
        notify(m.clipboard_no_url());
      }
    } catch (e) {
      console.debug('Not a URL:', e);
      notify(m.clipboard_no_url());
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
    const archiveBatches: { files: File[]; sourceName: string }[] = [];
    for (const file of promises
      .filter((promise) => promise.status === 'fulfilled')
      .map((promise) => (promise as PromiseFulfilledResult<File>).value)) {
      try {
        archiveBatches.push({ files: await decompress(file), sourceName: file.name });
      } catch (e) {
        console.debug(`Cannot decompress ${file.name}`, e);
        regularFiles.push(file);
      }
    }
    for (const batch of archiveBatches) {
      await handleImportBatch(batch.files, batch.sourceName);
    }
    if (regularFiles.length > 0) {
      await handleImportBatch(regularFiles);
    }
  }

  /** Compare file stems, ignoring any path prefix (zip entries keep their
   * folder in the file name, e.g. `videos/song.mp3` vs `song.mp3`). */
  const shareId = (a: FileEntry, b: FileEntry) => {
    const stem = (name: string) =>
      (name.split(/[\\/]/).pop() ?? name).split('.').slice(0, -1).join('.');
    return stem(a.file.name) === stem(b.file.name);
  };

  const isIncluded = (name: string) =>
    !name.toLowerCase().startsWith('autosave') && name !== 'createTime.txt';

  const resetProgress = () => {
    timeouts.forEach((id) => clearTimeout(id));
    showProgress = true;
    timeouts = [];
  };

  const download = async (url: string, name?: string) => {
    name ??= url.split(/[\\/]/).pop() || url;

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
      const chunks: Uint8Array<ArrayBuffer>[] = [];

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
      return new File(chunks, name);
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
    const isFont = ['ttf', 'otf', 'woff', 'woff2'].includes(extension);
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
      (!isGLSLShader && !isFont && mime?.startsWith('text/')) ||
      mime === 'application/json' ||
      ['yml', 'yaml'].includes(extension)
    ) {
      return 3;
    }
    if (isGLSLShader) return 4;
    if (isFont) return 5;
    return 6;
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
    if (IS_TAURI) {
      setupFFmpeg();
    }
    return true;
  };

  const setupFFmpeg = async () => {
    if (ffmpegEncoders === undefined) {
      const link = await getFFmpegDownloadLink();
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
    sourceName?: string,
  ): Promise<ChartBundle | undefined> => {
    songFile ??= audioFiles.find((file) => shareId(file, chartFile));
    if (songFile === undefined) {
      if (!fallback) {
        if (!silent) alert(m.no_song_found({ name: chartFile.file.name }));
        return;
      }
      songFile = audioFiles[0];
    }
    // Short songs were re-encoded to WAV on import; give the song file the
    // matching .wav name (song.mp3 → song.wav) so re-exported archives don't
    // claim a format that differs from the actual content. Renaming happens
    // here — after name-based resolution — rather than in `convertAudio`, so
    // exact-name references (e.g. custom hit sounds) are unaffected.
    if (songFile.file.type === 'audio/wav' && !songFile.file.name.toLowerCase().endsWith('.wav')) {
      songFile.file = new File(
        [songFile.file],
        songFile.file.name.replace(/\.[^.]+$/, '') + '.wav',
        { type: 'audio/wav' },
      );
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
      sourceName,
      metadata: metadataEntry
        ? {
            title: overrideTitle ?? metadataEntry.name,
            composer: metadataEntry.composer,
            charter: metadataEntry.charter,
            illustrator: metadataEntry.illustration ?? null,
            level: overrideLevel ?? metadataEntry.level,
            levelType: inferLevelType(overrideLevel ?? metadataEntry.level),
            difficulty: null,
          }
        : {
            ...metadata!,
            title: overrideTitle ?? metadata!.title,
            level: overrideLevel ?? metadata!.level,
            levelType: overrideLevel ? inferLevelType(overrideLevel) : metadata!.levelType,
          },
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

  /** Songs at least this long keep their original format — a WAV copy would
   * balloon to roughly 10 MB per minute. */
  const MAX_AUDIO_CONVERT_SECONDS = 270; // 4.5 min

  const getAudioDuration = (file: File) =>
    new Promise<number>((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        URL.revokeObjectURL(audio.src);
        resolve(Number.isFinite(duration) ? duration : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        resolve(0);
      };
      audio.src = URL.createObjectURL(file);
    });

  const convertAudio = async (audio: File, normalizeVolume = true) => {
    // Long songs are not converted: the WAV copy would be huge (an 11-min
    // chart can reach ~200 MB) and the original extension must be preserved
    // so re-exported archives don't carry a format/extension mismatch.
    if ((await getAudioDuration(audio)) >= MAX_AUDIO_CONVERT_SECONDS) {
      return audio;
    }
    progress = 0;
    const ffmpeg = getFFmpeg();
    ffmpeg.on('progress', (p) => {
      progress = clamp(p.progress, 0, 1);
    });
    if (!ffmpeg.loaded) {
      progressDetail = m.loading({ name: 'FFmpeg' });
      await loadFFmpeg(undefined, undefined, (p) => {
        progress = clamp(p, 0, 1);
      });
    }
    try {
      progressDetail = m.converting({ name: audio.name });
      const id = uuid();
      await ffmpeg.writeFile(`input_${id}`, await fetchFile(audio));

      let maxVolume = 0;
      if (normalizeVolume) {
        const logHandler = ({ message }: { message: string }) => {
          const match = message.match(/max_volume: ([-.\d]+) dB/);
          if (match) {
            maxVolume = parseFloat(match[1]);
          }
        };

        ffmpeg.on('log', logHandler);
        await ffmpeg.exec(`-i input_${id} -af volumedetect -f null -`.split(' '));
        ffmpeg.off('log', logHandler);
      }

      const volumeIncrease = -maxVolume;
      if (volumeIncrease > 0) {
        console.log(`Amplifying ${audio.name} by ${volumeIncrease} dB`);
      }

      await ffmpeg.exec([
        '-i',
        `input_${id}`,
        '-af',
        `volume=${volumeIncrease}dB`,
        '-ar',
        '48000',
        '-ac',
        '2',
        '-f',
        'wav',
        '-y',
        `output_${id}`,
      ]);
      const data = await ffmpeg.readFile(`output_${id}`);
      await ffmpeg.deleteFile(`input_${id}`);
      await ffmpeg.deleteFile(`output_${id}`);
      // The name keeps its original extension here — the .wav rename happens
      // in `createBundle` once this file is resolved as the chart's song
      // (renaming earlier would break exact-name asset references such as
      // custom hit sounds).
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
      ).filter((e): e is NoteSkin<File> => e.file !== undefined),
      hitSounds: (
        await Promise.all(
          metadata.hitSounds.map(async (e) => ({
            name: e.name,
            file: await findFile(e.file),
          })),
        )
      ).filter((e): e is HitSound<File> => e.file !== undefined),
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
        ).filter((e): e is GradeLetter<File> => e.file !== undefined),
        music: (
          await Promise.all(
            metadata.ending.music.map(async (e) => ({
              levelType: e.levelType,
              beats: e.beats,
              bpm: e.bpm,
              file: await findFile(e.file),
            })),
          )
        ).filter((e): e is ResultsMusic<File> => e.file !== undefined),
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
        (e): e is Font<File> | BitmapFont<File> =>
          ('file' in e && e.file !== undefined) ||
          (e.texture !== undefined && e.descriptor !== undefined),
      ),
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
      id: uuid(),
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

  const addOrReplaceRespack = (pack: ResourcePackWithId<File>) => {
    const existingIndex = resourcePacks.findIndex((p) => p.id === pack.id);
    if (existingIndex >= 0) {
      resourcePacks[existingIndex] = pack;
    } else {
      resourcePacks.push(pack);
    }
    resourcePacks = resourcePacks;
    saveRespack(pack).catch((e) => console.warn('Failed to store resource pack:', e));
  };

  const decompressZipArchives = async (files: File[]) => {
    return await Promise.all(files.map(decompress));
  };

  const handleImportBatch = async (
    files: File[],
    sourceName?: string,
    replacee?: number,
  ): Promise<void> => {
    if (files.length === 0) return;
    batchEntries = files.map((file) => {
      const entry: ChartGroupInput = { file };
      if (file.webkitRelativePath) entry.relativePath = file.webkitRelativePath;
      return entry;
    });
    await handleFiles(files, replacee, sourceName);
  };

  const processInputFiles = async (files: File[]) => {
    const zipArchives = files.filter(isZip);
    const regularFiles = files.filter((file) => !isZip(file));
    for (const archive of zipArchives) {
      await handleImportBatch(await decompress(archive), archive.name);
    }
    if (regularFiles.length > 0) {
      await handleImportBatch(regularFiles);
    }
  };

  const handleFiles = async (files: File[] | null, replacee?: number, sourceName?: string) => {
    if (!files || files.length === 0) {
      return;
    }
    resetProgress();
    progressDetail = m.processing_files();
    const now = Date.now();
    const importedAssetIds = new Set<number>();
    await Promise.all(
      files.map(async (file, i) => {
        const id = now + i;
        importedAssetIds.add(id);
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
          file = await convertAudio(file);
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
    // Resolve only text assets from this import. The global asset pool also
    // contains files from earlier imports and must not control this batch's
    // deduplication or resource resolution.
    const textAssets = assets.filter((asset) => importedAssetIds.has(asset.id) && asset.type === 3);
    let bundlesResolved = 0;
    let respacksResolved = 0;
    const newlyResolvedBundles: ChartBundle[] = [];
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
          // Zip entries keep their folder in the file name, while metadata
          // (info.txt / META) references basenames — fall back to matching
          // the last path segment.
          const baseNameOf = (name: string) => name.split(/[\\/]/).pop() ?? name;
          const chartFile =
            chartFiles.find(
              (file) => importedAssetIds.has(file.id) && file.file.name === metadata.chart,
            ) ??
            chartFiles.find((file) => file.file.name === metadata.chart) ??
            chartFiles.find(
              (file) =>
                importedAssetIds.has(file.id) && baseNameOf(file.file.name) === metadata.chart,
            ) ??
            chartFiles.find((file) => baseNameOf(file.file.name) === metadata.chart);
          const songFile =
            audioFiles.find(
              (file) => importedAssetIds.has(file.id) && file.file.name === metadata.song,
            ) ??
            audioFiles.find((file) => file.file.name === metadata.song) ??
            audioFiles.find(
              (file) =>
                importedAssetIds.has(file.id) && baseNameOf(file.file.name) === metadata.song,
            ) ??
            audioFiles.find((file) => baseNameOf(file.file.name) === metadata.song);
          const illustrationFile =
            imageFiles.find(
              (file) => importedAssetIds.has(file.id) && file.file.name === metadata.picture,
            ) ??
            imageFiles.find((file) => file.file.name === metadata.picture) ??
            imageFiles.find(
              (file) =>
                importedAssetIds.has(file.id) && baseNameOf(file.file.name) === metadata.picture,
            ) ??
            imageFiles.find((file) => baseNameOf(file.file.name) === metadata.picture);
          if (chartFile) {
            try {
              const chartMeta = (JSON.parse(await chartFile.file.text()) as RpeJson).META;
              metadata = updateMetadata(metadata, chartMeta);
            } catch (e) {
              console.debug('Chart is not a valid RPE JSON:', e);
            }
            const bundle = await createBundle(
              chartFile,
              songFile,
              illustrationFile,
              {
                id: asset.id,
                ...metadata,
              },
              undefined,
              false,
              true,
              sourceName,
            );
            if (bundle) newlyResolvedBundles.push(bundle);
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
            const pack = await importRespack(metadata);
            addOrReplaceRespack(pack);
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
            const pack = await importRespack(await convertPhiraRespack(metadata), false);
            addOrReplaceRespack(pack);
            assets = assets.filter((a) => a.id !== asset.id);
            respacksResolved++;
          } catch (e) {
            console.debug(e);
          }
          continue;
        }
      }
    }
    const unresolvedChartFiles = chartFiles.filter(
      (chartFile) =>
        importedAssetIds.has(chartFile.id) &&
        !chartBundles.some((bundle) => bundle.chart === chartFile.id),
    );
    if (unresolvedChartFiles.length > 0 && audioFiles.length > 0 && imageFiles.length > 0) {
      // Fallback: create one bundle per chart file, preferring song and
      // illustration from the chart's own folder (or shareId match).
      const folderOf = (file: File) => {
        const name = file.webkitRelativePath || file.name;
        const idx = name.indexOf('/');
        return idx === -1 ? null : name.slice(0, idx);
      };
      for (const chartFile of unresolvedChartFiles) {
        const folder = folderOf(chartFile.file);
        const sameFolder = (entry: FileEntry) => folder !== null && folderOf(entry.file) === folder;
        const currentAudioFiles = audioFiles.filter((file) => importedAssetIds.has(file.id));
        const currentImageFiles = imageFiles.filter((file) => importedAssetIds.has(file.id));
        const songFile =
          currentAudioFiles.find((f) => sameFolder(f)) ??
          currentAudioFiles.find((f) => shareId(f, chartFile)) ??
          currentAudioFiles[0] ??
          audioFiles.find((f) => shareId(f, chartFile)) ??
          audioFiles[0];
        const illustrationFile =
          currentImageFiles.find((f) => sameFolder(f)) ??
          currentImageFiles.find((f) => shareId(f, chartFile)) ??
          currentImageFiles[0] ??
          imageFiles.find((f) => shareId(f, chartFile)) ??
          imageFiles[0];
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
            (JSON.parse(await chartFile.file.text()) as RpeJson).META,
          );
        } catch (e) {
          console.debug('Chart is not a valid RPE JSON:', e);
        }
        const bundle = await createBundle(
          chartFile,
          songFile,
          illustrationFile,
          metadata,
          undefined,
          true,
          true,
          sourceName,
        );
        if (bundle) newlyResolvedBundles.push(bundle);
      }
      bundlesResolved += chartFiles.length;
    }
    if (chartBundles.length > 0 && selectedBundle === -1) {
      currentBundle = chartBundles[0];
      applyMetadataOverrides(currentBundle);
      selectedBundle = currentBundle.id;
      selectedSong = currentBundle.song;
      selectedChart = currentBundle.chart;
      selectedIllustration = currentBundle.illustration;
    }
    if (resourcePacks.length > 1 && selectedResourcePack === DEFAULT_RESOURCE_PACK_ID) {
      selectedResourcePack = resourcePacks[1].id;
      saveSelectedRespack(selectedResourcePack);
    }
    chartFiles = chartFiles;
    audioFiles = audioFiles;
    imageFiles = imageFiles;
    assets = assets;
    chartBundles = chartBundles;
    done = true;
    const focusImportedChart = (imported: ChartBundle) => {
      // Jump straight into the imported chart's detail view — always the
      // newly imported chart, not whatever was selected before.
      currentBundle = imported;
      applyMetadataOverrides(imported);
      selectedBundle = imported.id;
      selectedSong = imported.song;
      selectedChart = imported.chart;
      selectedIllustration = imported.illustration;
      detailOpen = true;
    };
    if (newlyResolvedBundles.length > 0 && shouldSaveImport()) {
      progressDetail = m.saving_chart();
      showProgress = true;
      // Resolve asset scoping (and persist) BEFORE switching to the chart
      // view: syncImportedCharts mutates the raw bundle objects, which is
      // not reactive, so rendering earlier would leave the asset list empty
      // until some later re-render (e.g. switching tabs).
      const loadedExisting = await syncImportedCharts(newlyResolvedBundles);
      if (loadedExisting) {
        // Duplicate resolved by loading the stored chart: its working state
        // (including the current bundle) is already set up.
        detailOpen = true;
      } else {
        focusImportedChart(newlyResolvedBundles[0]);
      }
    } else if (newlyResolvedBundles.length > 0) {
      focusImportedChart(newlyResolvedBundles[0]);
    }
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

  // ── Chart storage sync ──────────────────────────────────────────────

  const shouldSaveImport = () => !automate && !isProgrammaticImport;

  const getDuplicateChoice = (): 'ask' | 'overwrite' | 'load' => {
    const value = localStorage.getItem(DUPLICATE_CHOICE_KEY);
    return value === 'overwrite' || value === 'load' ? value : 'ask';
  };

  const resolveDuplicateChoice = async (): Promise<'overwrite' | 'load'> => {
    const remembered = getDuplicateChoice();
    if (remembered !== 'ask') return remembered;
    duplicateModalMem = false;
    duplicateModalOpen = true;
    return new Promise<'overwrite' | 'load'>((resolve) => {
      duplicateResolve = resolve;
    });
  };

  const chooseDuplicate = (choice: 'overwrite' | 'load') => {
    if (duplicateModalMem) {
      localStorage.setItem(DUPLICATE_CHOICE_KEY, choice);
    }
    duplicateResolve?.(choice);
    duplicateResolve = null;
  };

  const refreshStoredSummaries = async () => {
    try {
      storedChartSummaries = await loadAllChartSummaries();
    } catch (e) {
      console.warn('Failed to reload stored charts:', e);
    }
  };

  /** Asset entries belonging to `bundle` (per-chart scoping). */
  const bundleAssets = (bundle: ChartBundle | undefined = currentBundle) => {
    if (!bundle) return [];
    if (bundle.scopedAssetFiles) {
      const scope = bundle.scopedAssetFiles;
      // Prefer identity matching; fall back to name matching. Audio files
      // get re-created by convertAudio (same name, different File object),
      // so identity alone would drop them from the scoped asset list.
      let matched = assets.filter((asset) => scope.has(asset.file));
      const matchedNames = new Set(matched.map((asset) => asset.file.name));
      const unmatched = [...scope].filter((file) => !matchedNames.has(file.name));
      if (unmatched.length > 0) {
        const unmatchedNames = new Set(unmatched.map((file) => file.name));
        matched = [
          ...matched,
          ...assets.filter(
            (asset) => !matchedNames.has(asset.file.name) && unmatchedNames.has(asset.file.name),
          ),
        ];
      }
      return matched;
    }
    return [];
  };

  /**
   * Write the bundle's editable metadata into the chart JSON's META (RPE
   * schema in `src/lib/types.ts`): title → `name`, level → `level`, composer
   * → `composer`, charter → `charter`, illustrator → `illustration`. The
   * level type is not part of the RPE schema and is left untouched.
   *
   * Returns a new File when anything changed, `null` otherwise — untouched
   * charts keep their exact bytes so checksums and import dedup stay stable.
   * Fields absent from META are only added when given a non-empty value, so
   * charts without them are not materialized on.
   */
  const rewriteChartMetadata = async (file: File, metadata: Metadata): Promise<File | null> => {
    if (!file.name.toLowerCase().endsWith('.json')) return null;
    let json: RpeJson;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return null;
    }
    if (!json.META) return null;
    const meta = json.META as unknown as Record<string, string | undefined>;
    const fields: [string, string | null][] = [
      ['name', metadata.title],
      ['level', metadata.level],
      ['composer', metadata.composer],
      ['charter', metadata.charter],
      ['illustration', metadata.illustrator],
    ];
    let changed = false;
    for (const [key, value] of fields) {
      const next = value ?? '';
      if (meta[key] === undefined && next === '') continue;
      if ((meta[key] ?? '') !== next) {
        meta[key] = next;
        changed = true;
      }
    }
    if (!changed) return null;
    return new File([JSON.stringify(json)], file.name, { type: file.type });
  };

  /** Convert the current working state for `bundle` into a StoredChart. */
  const buildStoredChartFromBundle = async (bundle: ChartBundle): Promise<StoredChart | null> => {
    const chartFile = chartFiles.find((file) => file.id === bundle.chart);
    const songFile = audioFiles.find((file) => file.id === bundle.song);
    const illustrationFile = imageFiles.find((file) => file.id === bundle.illustration);
    if (!chartFile || !songFile || !illustrationFile) return null;
    // Persist metadata edits into the chart JSON itself — the chart's META is
    // the copy re-imports and exports actually read. The working-state file is
    // updated too, so playback and offset-adjusted saves carry the edits.
    const rewritten = await rewriteChartMetadata(chartFile.file, bundle.metadata);
    if (rewritten) {
      chartFile.file = rewritten;
      // The stored content changed; the old checksum no longer describes it.
      bundle.storedChecksum = undefined;
    }
    return {
      id: bundle.storedId ?? uuid(),
      createdAt: bundle.storedCreatedAt ?? Date.now(),
      updatedAt: Date.now(),
      checksum: bundle.storedChecksum,
      sourceName: bundle.sourceName,
      metadata: { ...bundle.metadata },
      resources: {
        chart: chartFile.file,
        song: songFile.file,
        illustration: illustrationFile.file,
      },
      assets: bundleAssets(bundle).map((asset) => ({
        name: asset.file.name,
        type: asset.type,
        file: asset.file,
        included: asset.included,
      })),
    };
  };

  /** Upsert `bundle` to chart storage, remembering its storage identity. */
  const syncBundle = async (
    bundle: ChartBundle,
    options: { computeChecksum?: boolean; silent?: boolean } = {},
  ) => {
    const stored = await buildStoredChartFromBundle(bundle);
    if (!stored) return;
    // Always ensure a checksum exists — dedup compares against stored
    // checksums, so charts saved via Play/Save without one would never
    // match a re-imported copy.
    if (options.computeChecksum || !stored.checksum) {
      stored.checksum = await computeChartChecksum(stored);
      bundle.storedChecksum = stored.checksum;
    }
    await syncStoredChart(stored);
    bundle.storedId = stored.id;
    bundle.storedCreatedAt = stored.createdAt;
    await refreshStoredSummaries();
    if (!options.silent) notify(m.chart_saved(), 'success');
  };

  /** Handle a freshly imported chart batch: dedup check + sync. Returns
   * `true` when a duplicate was resolved by loading the stored chart (its
   * working state is then already set up). */
  const syncImportedCharts = async (bundles: ChartBundle[]): Promise<boolean> => {
    // Always run within-batch grouping so each chart's asset list is scoped
    // to files that actually belong to it (shareId match / explicit
    // reference / sole occupant of a single-chart batch) — never the whole
    // (potentially session-wide) `assets` pool. This also keeps checksums
    // stable across re-imports of the same files.
    const groups = await groupFilesIntoCharts(batchEntries);
    let loadRequestedId: string | null = null;
    for (const bundle of bundles) {
      const bundleChartFile = chartFiles.find((file) => file.id === bundle.chart)?.file;
      const group = groups.find((g) => g.chart.resources.chart === bundleChartFile);
      // Always assign scoping when a group is found, even if it resolves to
      // an empty set — that still means "no extra assets", which must take
      // precedence over the unsafe include-everything fallback.
      if (group) {
        bundle.scopedAssetFiles = new Set(group.chart.assets.map((asset) => asset.file));
      }
      const stored = await buildStoredChartFromBundle(bundle);
      if (!stored) continue;
      // Dedup against the original import payload. `handleFiles` may replace
      // an audio File with a normalized WAV, so hashing `stored` here would
      // make the import identity depend on post-processing rather than on
      // the files the user actually imported.
      stored.checksum = group
        ? await computeChartChecksum(group.chart)
        : await computeChartChecksum(stored);
      const existing = storedChartSummaries.find((s) => s.checksum === stored.checksum);
      if (existing) {
        const choice = await resolveDuplicateChoice();
        if (choice === 'load') {
          // Defer replacing the working state until the loop ends — doing it
          // here would wipe the other bundles of a multi-chart batch mid-way.
          loadRequestedId = existing.id;
          continue;
        }
        // "Import & overwrite": keep the new files, reuse the existing id.
        stored.id = existing.id;
        stored.createdAt = existing.createdAt;
      }
      bundle.storedChecksum = stored.checksum;
      await syncStoredChart(stored);
      bundle.storedId = stored.id;
      bundle.storedCreatedAt = stored.createdAt;
    }
    if (loadRequestedId) {
      const loaded = await loadStoredChart(loadRequestedId);
      await loadChartIntoWorkingState(loaded);
    }
    await refreshStoredSummaries();
    return loadRequestedId !== null;
  };

  /** Replace the working state with a stored chart (Load action). */
  const loadChartIntoWorkingState = async (stored: StoredChart) => {
    chartFiles = [];
    audioFiles = [];
    imageFiles = [];
    assets = [];
    chartBundles = [];
    const now = Date.now();
    const chartId = now;
    const songId = now + 1;
    const illustrationId = now + 2;
    chartFiles.push({ id: chartId, file: stored.resources.chart });
    audioFiles.push({ id: songId, file: stored.resources.song });
    imageFiles.push({
      id: illustrationId,
      file: stored.resources.illustration,
      url: URL.createObjectURL(stored.resources.illustration),
    });
    assets = stored.assets.map((asset, i) => ({
      id: now + 3 + i,
      type: asset.type,
      file: asset.file,
      included: asset.included,
    }));
    const bundle: ChartBundle = {
      id: now + 1000,
      song: songId,
      chart: chartId,
      illustration: illustrationId,
      metadata: { ...stored.metadata },
      storedId: stored.id,
      storedCreatedAt: stored.createdAt,
      storedChecksum: stored.checksum,
      sourceName: stored.sourceName,
      scopedAssetFiles: new Set(stored.assets.map((asset) => asset.file)),
    };
    chartBundles.push(bundle);
    chartBundles = chartBundles;
    currentBundle = bundle;
    selectedBundle = bundle.id;
    selectedChart = chartId;
    selectedSong = songId;
    selectedIllustration = illustrationId;
    done = true;
  };

  /**
   * After the player saves an offset-adjusted chart (possibly in another
   * window), reload it into the working state so reopening the chart applies
   * the adjusted offset instead of the stale original.
   */
  const reloadStoredChartFromFlag = async () => {
    const id = localStorage.getItem(RELOAD_CHART_KEY);
    if (!id) return;
    localStorage.removeItem(RELOAD_CHART_KEY);
    try {
      await refreshStoredSummaries();
      const stored = await loadStoredChart(id);
      await loadChartIntoWorkingState(stored);
      notify(m.offset_adjusted_loaded({ title: stored.metadata.title ?? '' }), 'success');
    } catch (e) {
      console.warn('Failed to reload offset-adjusted chart:', e);
    }
  };

  /** storage events fire only in *other* windows/tabs (e.g. Tauri player window). */
  const onStorageEvent = (e: StorageEvent) => {
    if (e.key === RELOAD_CHART_KEY && e.newValue) {
      reloadStoredChartFromFlag();
    }
  };

  const getUrl = (blob: Blob | undefined) => (blob ? URL.createObjectURL(blob) : null);

  const handleParams = async (params: Config) => {
    preferences = params.preferences;
    mediaOptions = params.mediaOptions;
    // Only the persistent settings are kept on `toggles`. The one-time
    // options travel inside `params` itself and are never remembered.
    toggles = {
      render: params.render,
      newTab: params.newTab,
      inApp: params.inApp,
    };
    renderOn = toggles.render;
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
    const zipArchives = await downloadUrls(params.getAll('zip'));
    const regularFiles = await downloadUrls(params.getAll('file'));
    for (const archive of zipArchives) {
      await handleImportBatch(await decompress(archive), archive.name);
    }
    if (regularFiles.length > 0) {
      await handleImportBatch(regularFiles);
    }
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
    // Play should start immediately. Storage writes belong to the explicit
    // Save action or the import-resolution sync, not to normal playback.
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
    let url = paramsString.length <= 15360 ? `${base}/play/?${paramsString}` : `${base}/play/`;

    // When running in browser mode with a backend, propagate the backend param
    const backendParam = IS_BROWSER_WITH_BACKEND ? page.url.searchParams.get('backend') : null;
    if (backendParam) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}backend=${encodeURIComponent(backendParam)}`;
    }

    if (IS_TAURI) {
      if (toggles.render) {
        setupRendering();
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
    } else if (IS_TAURI_LIKE && toggles.render) {
      setupRendering();
    }

    if (Capacitor.getPlatform() === 'web' && toggles.newTab && !automate) {
      window.open(url);
    } else {
      goto(url);
    }
  };

  // ── App-shell handlers ───────────────────────────────────────────────

  // Direction of the last tab change, feeding the view transition
  // (discover sits left of library: switching forward slides from the right).
  let tabDirection = 0;
  const onSelectTab = (tab: 'discover' | 'library') => {
    if (tab !== activeTab) {
      const order = { discover: 0, library: 1 };
      tabDirection = Math.sign(order[tab] - order[activeTab]);
      activeTab = tab;
      localStorage.setItem(LAST_TAB_KEY, tab);
    }
  };

  const handleImportFiles = async (files: File[]) => {
    importOpen = false;
    await processInputFiles(files);
  };

  /**
   * Install an online chart/pack from the Discover tab: download the counted
   * archive URL, then run it through the normal import pipeline so it lands
   * in the local library like any other import.
   */
  const handleInstallOnline = async (
    kind: 'chart' | 'pack',
    downloadUrl: string,
    title: string,
  ) => {
    try {
      // The counted endpoint redirects to the OSS file, so the fetched file
      // name is meaningless (e.g. "download"); show the chart title in the
      // progress overlay instead, and rebuild the archive with a proper name
      // and ZIP MIME type so import detection works.
      const raw = await download(downloadUrl, title);
      const archive = new File(
        [raw],
        kind === 'chart' ? `${ensafeFilename(title)}.zip` : `${ensafeFilename(title)} pack.zip`,
        { type: 'application/zip' },
      );
      await processInputFiles([archive]);
      notify(m.installed({ title }), 'success');
    } catch (e) {
      console.warn('Failed to install online content:', e);
      notify(m.install_failed({ title }), 'failure');
    }
  };

  /** Bilibili Toy login: the profile consent dialog needs a user gesture. */
  const handleToyLogin = async () => {
    toyLoginLoading = true;
    try {
      toyUser = await toyGetUserProfile();
      toyLoginRequired = toyUser === null;
    } finally {
      toyLoginLoading = false;
    }
  };

  const handleImportDirectory = async (fileList: FileList) => {
    importOpen = false;
    const dirFiles = Array.from(fileList);
    if (dirFiles.length === 0) return;
    // webkitRelativePath carries the folder structure needed for grouping;
    // the top-level segment is the imported folder's name.
    const sourceName = dirFiles[0]?.webkitRelativePath?.split('/')[0] || undefined;
    await handleImportBatch(dirFiles, sourceName);
  };

  const openChartDetail = async (summary: StoredChartSummary) => {
    try {
      const stored = await loadStoredChart(summary.id);
      await loadChartIntoWorkingState(stored);
      detailOpen = true;
    } catch (e) {
      console.warn('Failed to load stored chart:', e);
      notify(String(e), 'failure');
    }
  };

  const exportStoredChart = async (id: string, options?: { preserveSourceName?: boolean }) => {
    try {
      const stored = await loadStoredChart(id);
      const path = await exportChart(stored, options?.preserveSourceName);
      if (path) notify(m.exported_to({ path }), 'success');
    } catch (e) {
      console.warn('Failed to export stored chart:', e);
      notify(String(e), 'failure');
    }
  };

  const selectRespack = (id: string) => {
    selectedResourcePack = id;
    saveSelectedRespack(id);
  };

  const exportRespackHandler = async (id: string) => {
    const pack = resourcePacks.find((p) => p.id === id);
    if (!pack) return;
    try {
      const path = await exportRespack(
        getTypeOfRespack(pack) === 'string'
          ? await importRespack(pack as ResourcePackWithId<string>)
          : (pack as ResourcePackWithId<File>),
      );
      if (path) notify(m.exported_to({ path }), 'success');
    } catch (e) {
      console.warn('Failed to export resource pack:', e);
      notify(String(e), 'failure');
    }
  };

  const deleteRespackHandler = async (id: string) => {
    const pack = resourcePacks.find((p) => p.id === id);
    if (!pack) return;
    // In Tauri the dialog plugin's shim breaks `window.confirm` ("Command not
    // found"), so use the plugin's native `confirm()` there instead.
    const message = m.delete();
    const confirmed = IS_TAURI
      ? await confirmDialog(message, { kind: 'warning' })
      : window.confirm(message);
    if (!confirmed) return;
    resourcePacks = resourcePacks.filter((b) => b.id !== id);
    deleteStoredRespack(id).catch((e) => console.warn('Failed to delete stored resource pack:', e));
    if (selectedResourcePack === id) {
      selectedResourcePack = DEFAULT_RESOURCE_PACK_ID;
      saveSelectedRespack(DEFAULT_RESOURCE_PACK_ID);
    }
  };

  const browseExportPath = async () => {
    const path = await open({ directory: true, multiple: false });
    if (path) mediaOptions.exportPath = path;
  };

  const handleSelectChart = (id: number) => {
    selectedChart = id;
    if (currentBundle) currentBundle.chart = id;
    chartBundles = chartBundles;
  };

  const handleSelectSong = (id: number) => {
    selectedSong = id;
    if (currentBundle) currentBundle.song = id;
    chartBundles = chartBundles;
  };

  const handleSelectIllustration = (id: number) => {
    selectedIllustration = id;
    if (currentBundle) currentBundle.illustration = id;
    chartBundles = chartBundles;
  };

  const handleAssetToggle = (row: { id: number }) => {
    const asset = assets.find((a) => a.id === row.id);
    if (!asset) return;
    asset.included = !asset.included;
    assets = assets;
  };

  const handleAssetType = (row: { id: number }, type: number) => {
    const asset = assets.find((a) => a.id === row.id);
    if (!asset) return;
    asset.type = type;
    assets = assets;
  };

  const handleAssetDelete = (row: { id: number }) => {
    assets = assets.filter((a) => a.id !== row.id);
  };

  const handlePlay = (
    options: {
      autoplay?: boolean;
      practice?: boolean;
      adjustOffset?: boolean;
      autostart?: boolean;
    } = {},
  ) => {
    // Stateless one-click modes: every button supplies its complete option
    // set, built from defaults here — nothing is remembered between plays.
    const playOptions = {
      autoplay: false,
      practice: false,
      adjustOffset: false,
      autostart: false,
      ...options,
    };
    if (toggles.render) {
      // Rendering plays itself (no input), so it must run with autoplay.
      playOptions.autoplay = true;
      playOptions.practice = false;
      playOptions.adjustOffset = false;
      playOptions.autostart = true;
    }
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
    start(handleConfig(playOptions));
  };

  const handleSave = (metadata: {
    title: string | null;
    composer: string | null;
    illustrator: string | null;
    charter: string | null;
    levelType: number;
    level: string | null;
  }) => {
    if (!currentBundle) return;
    currentBundle.metadata = {
      ...currentBundle.metadata,
      ...metadata,
      levelType: metadata.levelType as Metadata['levelType'],
    };
    chartBundles = chartBundles;
    syncBundle(currentBundle);
  };

  const handleExport = async () => {
    if (!currentBundle?.storedId) return;
    await exportStoredChart(currentBundle.storedId);
  };

  const handleDeleteBundle = async () => {
    const bundle = currentBundle;
    if (!bundle) return;
    if (bundle.storedId) {
      await deleteStoredChart(bundle.storedId);
      await refreshStoredSummaries();
    }
    chartBundles = chartBundles.filter((b) => b.id !== bundle.id);
    if (chartBundles.every((b) => b.chart !== bundle.chart)) {
      chartFiles = chartFiles.filter((file) => file.id !== bundle.chart);
    }
    if (chartBundles.every((b) => b.song !== bundle.song)) {
      audioFiles = audioFiles.filter((file) => file.id !== bundle.song);
    }
    if (chartBundles.every((b) => b.illustration !== bundle.illustration)) {
      imageFiles = imageFiles.filter((file) => file.id !== bundle.illustration);
    }
    if (chartBundles.length > 0) {
      currentBundle = chartBundles[0];
      selectedBundle = currentBundle.id;
      selectedChart = currentBundle.chart;
      selectedSong = currentBundle.song;
      selectedIllustration = currentBundle.illustration;
    } else {
      currentBundle = undefined;
    }
    detailOpen = false;
  };

  const currentIllustrationUrl = () =>
    imageFiles.find((file) => file.id === currentBundle?.illustration)?.url;
  const chartFileOptions = () => chartFiles.map((file) => ({ id: file.id, name: file.file.name }));
  const songFileOptions = () => audioFiles.map((file) => ({ id: file.id, name: file.file.name }));
  const illustrationFileOptions = () =>
    imageFiles.map((file) => ({ id: file.id, name: file.file.name }));
  const assetRows = () =>
    bundleAssets().map((asset) => ({
      id: asset.id,
      name: asset.file.name,
      type: asset.type,
      size: asset.file.size,
      included: asset.included,
    }));
</script>

<svelte:head>
  <title>{m.app_title()}</title>
</svelte:head>

{#if !IS_ANDROID_OR_IOS && Capacitor.getPlatform() === 'web'}
  <div
    class="pointer-events-none fixed inset-0 z-50 transition-all duration-200 backdrop-blur-sm"
    class:opacity-0={!isDragging}
  >
    <div class="flex h-full w-full items-center justify-center rounded-xl bg-black/50">
      <div
        class="flex flex-col items-center gap-4 text-white transition-transform duration-200 ease-out"
        class:scale-90={!isDragging}
      >
        <i class="fa-solid fa-file-import fa-4x"></i>
        <span class="text-2xl font-semibold">{m.drop_files_here()}</span>
      </div>
    </div>
  </div>
{/if}

<svelte:document
  ondragenter={(e) => {
    if (IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web') return;
    e.preventDefault();
    dragCounter++;
    if (hasValidDragItems(e.dataTransfer)) {
      isDragging = true;
    }
  }}
  ondragover={(e) => {
    if (IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }}
  ondragleave={(e) => {
    if (IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web') return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragging = false;
    }
  }}
  ondrop={async (e) => {
    if (IS_ANDROID_OR_IOS || Capacitor.getPlatform() !== 'web') return;
    e.preventDefault();
    dragCounter = 0;
    isDragging = false;
    const fileList = e.dataTransfer?.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(isAcceptedFile);
    if (files.length === 0) return;
    await processInputFiles(files);
  }}
/>

<!-- Clipboard URL resolution -->
<Dialog.Root bind:open={clipboardModalOpen}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.resolve_url()}</Dialog.Title>
      <Dialog.Description class="break-words">
        {m['resolve_url_description.0']()}
        <span class="mt-1 block font-semibold text-foreground">{clipboardUrl?.href}</span>
        {m['resolve_url_description.1']()}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="flex-wrap">
      <Button
        onclick={() => {
          clipboardModalOpen = false;
          resolveClipboardUrl('zip');
        }}
      >
        {m.resolve_as_zip()}
      </Button>
      <Button
        variant="outline"
        onclick={() => {
          clipboardModalOpen = false;
          resolveClipboardUrl('file');
        }}
      >
        {m.resolve_as_file()}
      </Button>
      <Button
        variant="ghost"
        onclick={() => {
          clipboardModalOpen = false;
          ignoredUrls.push(clipboardUrl!.href);
          clipboardUrl = undefined;
        }}
      >
        {m.cancel()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Duplicate chart import -->
<Dialog.Root bind:open={duplicateModalOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{m['duplicate_import.title']()}</Dialog.Title>
      <Dialog.Description>{m['duplicate_import.description']()}</Dialog.Description>
    </Dialog.Header>
    <label class="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
      <Switch bind:checked={duplicateModalMem} />
      <span>
        <span class="block text-sm font-medium">{m.remember_choice()}</span>
        <span class="block text-xs text-muted-foreground">{m.remember_choice_description()}</span>
      </span>
    </label>
    <Dialog.Footer>
      <Button
        onclick={() => {
          duplicateModalOpen = false;
          chooseDuplicate('overwrite');
        }}
      >
        {m['duplicate_import.overwrite']()}
      </Button>
      <Button
        variant="outline"
        onclick={() => {
          duplicateModalOpen = false;
          chooseDuplicate('load');
        }}
      >
        {m['duplicate_import.load_stored']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Use-the-app redirect choice -->
<Dialog.Root bind:open={appModalOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{m.use_the_app()}</Dialog.Title>
      <Dialog.Description>
        {m['use_the_app_description.0']()}
        <a href="{base}/app" target="_blank" class="font-medium text-primary hover:underline">
          {m['use_the_app_description.1']()}
        </a>
        {m['use_the_app_description.2']()}
      </Dialog.Description>
    </Dialog.Header>
    <label class="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
      <Switch bind:checked={modalMem} />
      <span>
        <span class="block text-sm font-medium">{m.remember_choice()}</span>
        <span class="block text-xs text-muted-foreground">{m.remember_choice_description()}</span>
      </span>
    </label>
    <Dialog.Footer>
      <Button
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
      </Button>
      <Button
        variant="outline"
        onclick={async () => {
          await handleParamFiles(page.url.searchParams);
          if (modalMem) {
            toggles.inApp = 2;
            localStorage.setItem('toggles', JSON.stringify(toggles));
          }
        }}
      >
        {m.proceed_with_browser()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- App shell -->
<AppShell
  tab={activeTab}
  {onSelectTab}
  onOpenSettings={() => (settingsOpen = true)}
  {toyUser}
  {toyLoginRequired}
  {toyLoginLoading}
  onToyLogin={handleToyLogin}
>
  {#key activeTab}
    <div in:slideFade={{ direction: tabDirection }}>
      {#if activeTab === 'discover'}
        <DiscoverView onInstall={handleInstallOnline} />
      {:else}
        <LibraryView
          summaries={storedChartSummaries}
          respacks={resourcePacks}
          selectedRespackId={selectedResourcePack}
          onChartSelect={openChartDetail}
          onPackSelect={selectRespack}
          onPackExport={exportRespackHandler}
          onPackDelete={deleteRespackHandler}
          onImport={() => (importOpen = true)}
          onBrowseOnline={() => onSelectTab('discover')}
        />
      {/if}
    </div>
  {/key}
</AppShell>

<ProgressOverlay {progress} {progressDetail} {progressSpeed} {showProgress} />

<SettingsSheet
  bind:open={settingsOpen}
  {preferences}
  {mediaOptions}
  bind:overrideResolution
  bind:mediaResolutionWidth
  bind:mediaResolutionHeight
  {ffmpegEncoders}
  {isRenderingAvailable}
  isTauriLike={IS_TAURI_LIKE}
  onBrowseExportPath={browseExportPath}
  {renderOn}
  onRenderToggle={handleRenderToggle}
  version={VERSION}
  commit={__COMMIT_HASH__}
/>

<ImportDialog
  bind:open={importOpen}
  onFiles={handleImportFiles}
  onDirectory={handleImportDirectory}
  onPasteUrl={handleClipboard}
  showDirectory={!IS_ANDROID_OR_IOS && Capacitor.getPlatform() === 'web'}
/>

{#if detailOpen && currentBundle}
  <ChartDetailPage
    bundle={currentBundle}
    illustrationUrl={currentIllustrationUrl()}
    charts={chartFileOptions()}
    songs={songFileOptions()}
    illustrations={illustrationFileOptions()}
    {selectedChart}
    {selectedSong}
    {selectedIllustration}
    onSelectChart={handleSelectChart}
    onSelectSong={handleSelectSong}
    onSelectIllustration={handleSelectIllustration}
    assets={assetRows()}
    onAssetToggle={handleAssetToggle}
    onAssetType={handleAssetType}
    onAssetDelete={handleAssetDelete}
    {toggles}
    isWeb={Capacitor.getPlatform() === 'web'}
    disableTitle={overrideTitle !== undefined}
    disableLevel={overrideLevel !== undefined}
    onClose={() => (detailOpen = false)}
    onPlay={handlePlay}
    onSave={handleSave}
    onExport={handleExport}
    onDelete={handleDeleteBundle}
  />
{/if}
