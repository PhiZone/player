<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { popIn, riseIn } from '$lib/motion';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Table from '$lib/components/ui/table';
  import { m } from '$lib/paraglide/messages';
  import { IS_TAURI } from '$lib/utils';
  import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
  import {
    detectToyEnvironment,
    padToyScore,
    toyGetMyRank,
    toyGetPersonalBest,
    toyGetRankList,
    type ToyBoard,
    type ToyPersonalBest,
  } from '$lib/services/toy';
  import { findChartBoard } from '$lib/services/toyLeaderboards';
  import ChartLeaderboard, {
    type LeaderboardEntry,
    type LeaderboardMyRank,
  } from './ChartLeaderboard.svelte';
  import DifficultyBadge from '$lib/components/common/DifficultyBadge.svelte';
  import AssetTypeSelect from './AssetTypeSelect.svelte';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import PlayIcon from '@lucide/svelte/icons/play';
  import CirclePlayIcon from '@lucide/svelte/icons/circle-play';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import SaveIcon from '@lucide/svelte/icons/save';
  import FileDownIcon from '@lucide/svelte/icons/file-down';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import MusicIcon from '@lucide/svelte/icons/music';
  import PenLineIcon from '@lucide/svelte/icons/pen-line';
  import ImageIcon from '@lucide/svelte/icons/image';
  import Gamepad2Icon from '@lucide/svelte/icons/gamepad-2';
  import TimerIcon from '@lucide/svelte/icons/timer';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import SquareArrowOutUpRightIcon from '@lucide/svelte/icons/square-arrow-out-up-right';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CrownIcon from '@lucide/svelte/icons/crown';

  const TYPE_NAMES = ['EZ', 'HD', 'IN', 'AT', 'SP'];

  interface FileOption {
    id: number;
    name: string;
  }
  interface AssetRow {
    id: number;
    name: string;
    type: number;
    size: number;
    included: boolean;
  }
  interface BundleView {
    storedId?: string;
    metadata: {
      title: string | null;
      composer: string | null;
      illustrator: string | null;
      charter: string | null;
      levelType: number;
      level: string | null;
    };
  }

  let {
    bundle,
    illustrationUrl,
    charts = [],
    songs = [],
    illustrations = [],
    selectedChart = -1,
    selectedSong = -1,
    selectedIllustration = -1,
    onSelectChart,
    onSelectSong,
    onSelectIllustration,
    assets = [],
    onAssetToggle,
    onAssetType,
    onAssetDelete,
    toggles,
    isWeb = false,
    disableTitle = false,
    disableLevel = false,
    onClose,
    onPlay,
    onSave,
    onExport,
    onDelete,
  }: {
    bundle: BundleView;
    illustrationUrl?: string;
    charts?: FileOption[];
    songs?: FileOption[];
    illustrations?: FileOption[];
    selectedChart?: number;
    selectedSong?: number;
    selectedIllustration?: number;
    onSelectChart: (id: number) => void;
    onSelectSong: (id: number) => void;
    onSelectIllustration: (id: number) => void;
    assets?: AssetRow[];
    onAssetToggle: (asset: AssetRow) => void;
    onAssetType: (asset: AssetRow, type: number) => void;
    onAssetDelete: (asset: AssetRow) => void;
    toggles: { newTab: boolean };
    isWeb?: boolean;
    disableTitle?: boolean;
    disableLevel?: boolean;
    onClose: () => void;
    onPlay: (options: {
      autoplay?: boolean;
      practice?: boolean;
      adjustOffset?: boolean;
      autostart?: boolean;
    }) => void;
    onSave: (metadata: BundleView['metadata']) => void;
    onExport: () => void;
    onDelete: () => void;
  } = $props();

  let advancedOpen = $state(false);

  // ── Local metadata edit state ────────────────────────────────────────
  let edit = $state({
    title: '',
    composer: '',
    illustrator: '',
    charter: '',
    levelType: 2,
    level: '',
  });
  let editDirty = $state(false);

  $effect(() => {
    edit = {
      title: bundle.metadata.title ?? '',
      composer: bundle.metadata.composer ?? '',
      illustrator: bundle.metadata.illustrator ?? '',
      charter: bundle.metadata.charter ?? '',
      levelType: bundle.metadata.levelType ?? 2,
      level: bundle.metadata.level ?? '',
    };
    editDirty = false;
    // Re-sync select mirrors when the bundle (or its file selection) changes.
    levelTypeStr = String(bundle.metadata.levelType ?? 2);
    chartIdStr = String(selectedChart);
    songIdStr = String(selectedSong);
    illustrationIdStr = String(selectedIllustration);
  });

  const save = () => {
    onSave(edit);
    editDirty = false;
  };

  /**
   * Ask for delete confirmation. In Tauri the dialog plugin's injected shim
   * replaces `window.confirm` with a call to the removed `dialog.confirm`
   * command ("not allowed. Command not found"), so use the plugin's native
   * `confirm()` — which is backed by the allowed `dialog.message` command —
   * there instead.
   */
  const confirmDelete = async () => {
    const message = m['chart_manager.delete_confirm']();
    const confirmed = IS_TAURI
      ? await confirmDialog(message, { kind: 'warning' })
      : window.confirm(message);
    if (!confirmed) return;
    onDelete();
  };

  // ── Per-play option toggles (write-through mirrors) ──────────────────
  // autostart is stateless UI: it resets whenever this page opens and is
  // passed along with whichever play button is pressed.
  let autostart = $state(false);
  let newTab = $state(false);

  let togglesSynced = false;
  $effect(() => {
    if (togglesSynced) return;
    togglesSynced = true;
    newTab = toggles.newTab;
  });

  $effect(() => {
    toggles.newTab = newTab;
  });

  // One-click play actions: each button starts the game immediately with a
  // preset of one-time options — autoplay plays on its own, practice plays
  // without autoplay, and offset adjustment plays with autoplay.
  const toggleAutostart = () => {
    autostart = !autostart;
  };
  const toggleNewTab = () => {
    newTab = !newTab;
  };

  // ── Select mirrors ───────────────────────────────────────────────────
  let levelTypeStr = $state<string | undefined>(undefined);
  let chartIdStr = $state<string | undefined>(undefined);
  let songIdStr = $state<string | undefined>(undefined);
  let illustrationIdStr = $state<string | undefined>(undefined);

  $effect(() => {
    if (levelTypeStr === undefined) return;
    const v = Number(levelTypeStr);
    if (v !== edit.levelType) {
      edit.levelType = v;
      editDirty = true;
    }
  });
  $effect(() => {
    if (chartIdStr === undefined) return;
    const v = Number(chartIdStr);
    if (v !== selectedChart) onSelectChart(v);
  });
  $effect(() => {
    if (songIdStr === undefined) return;
    const v = Number(songIdStr);
    if (v !== selectedSong) onSelectSong(v);
  });
  $effect(() => {
    if (illustrationIdStr === undefined) return;
    const v = Number(illustrationIdStr);
    if (v !== selectedIllustration) onSelectIllustration(v);
  });

  const humanizeFileSize = (size: number) => {
    let i = size == 0 ? 0 : Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };

  // ── Scroll-container bottom fade ────────────────────────────────────
  // The content that scrolls beneath the action bar is given an opacity
  // mask at the scroll container's bottom edge, so it dissolves at a fixed
  // point just above the bar instead of painting a solid band behind the
  // bar (which mismatched when the two had different widths and read as
  // "black"). The mask only applies when the content is tall enough to
  // actually reach the bottom.
  let advancedScroller = $state<HTMLElement | null>(null);
  let advancedColumn = $state<HTMLElement | null>(null);
  let advancedOverflows = $state(false);

  $effect(() => {
    const scroller = advancedScroller;
    const column = advancedColumn;
    if (!scroller || !column) return;
    const measure = () => {
      advancedOverflows = scroller.scrollHeight > scroller.clientHeight + 1;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    ro.observe(column);
    return () => ro.disconnect();
  });

  // ── Page-level behavior ──────────────────────────────────────────────
  onMount(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  // ── Bilibili Toy: chart leaderboard + personal best ──────────────────
  // Only the first three online charts (by creation date) own a leaderboard
  // board; this chart's board is resolved by metadata match against them.
  let toyEnabled = $state(false);
  let chartBoard = $state<ToyBoard | null>(null);
  let leaderboard = $state<LeaderboardEntry[] | null>(null);
  let leaderboardError = $state(false);
  let myRank = $state<LeaderboardMyRank | null>(null);
  let personalBest = $state<ToyPersonalBest | null>(null);
  let leaderboardOpen = $state(false);

  onMount(async () => {
    toyEnabled = await detectToyEnvironment();
    if (!toyEnabled) return;
    chartBoard = await findChartBoard({
      title: bundle.metadata.title,
      composer: bundle.metadata.composer,
      levelType: bundle.metadata.levelType,
      level: bundle.metadata.level,
    });
    if (chartBoard === null) return; // this chart has no leaderboard
    void loadLeaderboard();
    const chartKey = bundle.storedId;
    if (chartKey) {
      personalBest = await toyGetPersonalBest(chartKey);
      myRank ??= await toyGetMyRank(chartBoard);
    }
  });

  const loadLeaderboard = async () => {
    if (chartBoard === null) return;
    leaderboardError = false;
    leaderboard = null;
    const [entries, rank] = await Promise.all([
      toyGetRankList(chartBoard, 20),
      toyGetMyRank(chartBoard),
    ]);
    leaderboard = entries ?? [];
    if (rank) myRank = rank;
    leaderboardError = entries === null;
  };
</script>

<div
  class="fixed inset-0 z-50 flex flex-col bg-background"
  in:fly={{ x: 96, duration: 280, easing: cubicOut }}
  out:fly={{ x: 64, duration: 200, easing: cubicIn }}
  role="dialog"
  aria-modal="true"
  aria-label={edit.title || bundle.metadata.title}
>
  <!-- Full-bleed illustration background (wide screens only): the
       illustration covers the whole page and fades out toward the right,
       leaving the content column readable. -->
  <div aria-hidden="true" class="pointer-events-none absolute inset-0 hidden md:block">
    {#if illustrationUrl}
      <img src={illustrationUrl} alt="" class="size-full object-cover" />
    {:else}
      <div class="size-full bg-muted"></div>
    {/if}
    <!-- right fade: the illustration gives way to the content column -->
    <div
      class="absolute inset-0 bg-gradient-to-r from-background/5 via-background/55 to-background"
    ></div>
    <!-- bottom fade: keeps the action bar legible -->
    <div
      class="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent"
    ></div>
    <!-- top fade: keeps the header legible -->
    <div
      class="absolute inset-0 bg-gradient-to-b from-background/80 via-background/20 to-transparent"
    ></div>
  </div>

  <!-- Header -->
  <header
    class="relative z-10 flex h-14 shrink-0 items-center gap-1 border-b bg-background/90 px-2 backdrop-blur-xl sm:gap-2 sm:px-4 md:border-transparent md:bg-transparent md:backdrop-blur-none"
  >
    <Button variant="ghost" size="icon" aria-label={m.close()} onclick={onClose}>
      <ArrowLeftIcon class="size-4" />
    </Button>
    <h1 class="min-w-0 truncate text-base font-semibold">{edit.title || bundle.metadata.title}</h1>
    <div class="ms-auto flex shrink-0 items-center gap-1">
      {#if editDirty}
        <div in:popIn>
          <Button size="sm" onclick={save}>
            <SaveIcon class="size-4" />
            <span class="hidden sm:inline">{m.save()}</span>
          </Button>
        </div>
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button variant="outline" size="icon-sm" aria-label={m['chart_manager.export']()}>
            <EllipsisIcon class="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item
            disabled={!editDirty}
            onSelect={(e) => {
              save();
              e.preventDefault();
            }}
          >
            <SaveIcon class="size-4" />
            {m.save()}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!bundle.storedId}
            onSelect={(e) => {
              onExport();
              e.preventDefault();
            }}
          >
            <FileDownIcon class="size-4" />
            {m['chart_manager.export']()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            class="text-destructive focus:text-destructive"
            onSelect={async (e) => {
              await confirmDelete();
              e.preventDefault();
            }}
          >
            <TrashIcon class="size-4" />
            {m.delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </header>

  <!-- Content -->
  <div
    bind:this={advancedScroller}
    class="relative z-10 min-h-0 flex-1 overflow-y-auto advanced-fade"
    style:--fade={advancedOverflows ? '6rem' : '0px'}
    in:riseIn={{ y: 14, delay: 100, duration: 280 }}
  >
    <div
      bind:this={advancedColumn}
      class="mx-auto flex min-h-full w-full max-w-5xl flex-col items-stretch gap-4 px-3 pb-28 pt-4 sm:px-6 sm:pt-6 md:max-w-none md:items-end md:gap-5 md:px-12 md:pt-8"
    >
      <!-- Illustration card (mobile only; wide screens use the full-bleed
           background above) -->
      <div
        class="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-2xl bg-muted md:hidden"
      >
        {#if illustrationUrl}
          <img src={illustrationUrl} alt="" class="size-full object-cover" />
        {:else}
          <div class="flex size-full items-center justify-center text-muted-foreground">
            <MusicIcon class="size-10 opacity-40" />
          </div>
        {/if}
      </div>
      <!-- Title, level, composer, charter, illustrator -->
      <div class="w-full space-y-1.5 md:w-[min(36rem,48vw)] md:space-y-3">
        <div class="flex items-start justify-between gap-3">
          <h2
            class="min-w-0 break-words text-2xl font-bold leading-tight md:text-5xl md:leading-[1.08]"
          >
            {edit.title || bundle.metadata.title}
          </h2>
          <DifficultyBadge
            levelType={bundle.metadata.levelType}
            level={bundle.metadata.level}
            class="max-w-[55%] md:max-w-[45%] md:h-7 md:px-3.5 md:py-1 md:text-lg"
          />
        </div>
        <div class="flex flex-col gap-1 text-sm text-muted-foreground md:gap-2 md:text-lg">
          {#if bundle.metadata.composer}
            <p class="flex items-center gap-2">
              <MusicIcon class="size-3.5 shrink-0 md:size-5" />
              <span class="truncate">{bundle.metadata.composer}</span>
            </p>
          {/if}
          {#if bundle.metadata.charter}
            <p class="flex items-center gap-2">
              <PenLineIcon class="size-3.5 shrink-0 md:size-5" />
              <span class="truncate">{bundle.metadata.charter}</span>
            </p>
          {/if}
          {#if bundle.metadata.illustrator}
            <p class="flex items-center gap-2">
              <ImageIcon class="size-3.5 shrink-0 md:size-5" />
              <span class="truncate">{bundle.metadata.illustrator}</span>
            </p>
          {/if}
        </div>
      </div>

      <Collapsible.Root bind:open={advancedOpen} class="w-full md:order-2 md:w-[min(36rem,48vw)]">
        <Collapsible.Trigger
          class="flex w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {m.advanced()}
          <ChevronDownIcon class="size-4 transition-transform {advancedOpen ? 'rotate-180' : ''}" />
        </Collapsible.Trigger>
        <Collapsible.Content class="relative pt-2">
          <div class="space-y-4">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-1 sm:col-span-2">
                <Label for="detail-title">{m['metadata.title']()}</Label>
                <Input
                  id="detail-title"
                  bind:value={edit.title}
                  disabled={disableTitle}
                  oninput={() => (editDirty = true)}
                />
              </div>
              <div class="space-y-1">
                <Label for="detail-composer">{m['metadata.composer']()}</Label>
                <Input
                  id="detail-composer"
                  bind:value={edit.composer}
                  oninput={() => (editDirty = true)}
                />
              </div>
              <div class="space-y-1">
                <Label for="detail-illustrator">{m['metadata.illustrator']()}</Label>
                <Input
                  id="detail-illustrator"
                  bind:value={edit.illustrator}
                  oninput={() => (editDirty = true)}
                />
              </div>
              <div class="space-y-1">
                <Label for="detail-charter">{m['metadata.charter']()}</Label>
                <Input
                  id="detail-charter"
                  bind:value={edit.charter}
                  oninput={() => (editDirty = true)}
                />
              </div>
              <div class="space-y-1">
                <Label>{m['metadata.level_type']()}</Label>
                <Select.Root type="single" bind:value={levelTypeStr}>
                  <Select.Trigger class="w-full">
                    <span>{TYPE_NAMES[Number(levelTypeStr)] ?? ''}</span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each TYPE_NAMES as typeName, i}
                      <Select.Item value={String(i)}>{typeName}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="space-y-1 sm:col-span-2">
                <Label for="detail-level">{m['metadata.level']()}</Label>
                <Input
                  id="detail-level"
                  bind:value={edit.level}
                  disabled={disableLevel}
                  oninput={() => (editDirty = true)}
                />
              </div>
            </div>

            <Separator />

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="space-y-1">
                <Label>{m.chart()}</Label>
                <Select.Root type="single" bind:value={chartIdStr}>
                  <Select.Trigger class="w-full">
                    <span class="truncate">
                      {charts.find((c) => String(c.id) === chartIdStr)?.name ?? ''}
                    </span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each charts as option (option.id)}
                      <Select.Item value={String(option.id)}>{option.name}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="space-y-1">
                <Label>{m.song()}</Label>
                <Select.Root type="single" bind:value={songIdStr}>
                  <Select.Trigger class="w-full">
                    <span class="truncate">
                      {songs.find((s) => String(s.id) === songIdStr)?.name ?? ''}
                    </span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each songs as option (option.id)}
                      <Select.Item value={String(option.id)}>{option.name}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="space-y-1">
                <Label>{m.illustration()}</Label>
                <Select.Root type="single" bind:value={illustrationIdStr}>
                  <Select.Trigger class="w-full">
                    <span class="truncate">
                      {illustrations.find((i) => String(i.id) === illustrationIdStr)?.name ?? ''}
                    </span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each illustrations as option (option.id)}
                      <Select.Item value={String(option.id)}>{option.name}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            </div>

            {#if assets.length > 0}
              <div class="overflow-x-auto rounded-xl border">
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>{m['asset.name']()}</Table.Head>
                      <Table.Head class="hidden sm:table-cell">{m['asset.type']()}</Table.Head>
                      <Table.Head class="hidden md:table-cell">{m['asset.size']()}</Table.Head>
                      <Table.Head class="text-end">{m['asset.actions']()}</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {#each assets as asset (asset.id)}
                      <Table.Row class={!asset.included ? 'opacity-50' : ''}>
                        <Table.Cell class="max-w-40 truncate font-medium" title={asset.name}>
                          {asset.name}
                        </Table.Cell>
                        <Table.Cell class="hidden sm:table-cell">
                          <AssetTypeSelect
                            value={asset.type}
                            onchange={(v) => onAssetType(asset, v)}
                            class="h-8 min-w-28"
                          />
                        </Table.Cell>
                        <Table.Cell class="hidden tabular-nums md:table-cell">
                          {humanizeFileSize(asset.size)}
                        </Table.Cell>
                        <Table.Cell class="text-end">
                          <div class="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="xs" onclick={() => onAssetToggle(asset)}>
                              {asset.included ? m['asset.exclude']() : m['asset.include']()}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="text-destructive"
                              aria-label={m.delete()}
                              onclick={() => onAssetDelete(asset)}
                            >
                              <TrashIcon class="size-3" />
                            </Button>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              </div>
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- Personal best (Bilibili Toy only): score + accuracy + rank,
           right above the action buttons bar. -->
      {#if toyEnabled && chartBoard !== null && (personalBest || (myRank?.ranked ?? false))}
        <div class="w-full md:order-4 md:w-[min(28rem,42vw)]">
          <div
            class="flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5"
          >
            <span
              class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <CrownIcon class="size-3.5 text-amber-400" />
              {m.personal_best()}
            </span>
            <span class="flex items-baseline gap-2">
              {#if myRank?.ranked}
                <span class="text-xs font-semibold text-violet-300">#{myRank.rank}</span>
              {/if}
              <span
                class="font-mono text-lg font-bold tabular-nums tracking-widest text-foreground"
              >
                {padToyScore(personalBest?.score ?? myRank?.score ?? 0)}
              </span>
              {#if personalBest}
                <span class="text-xs text-muted-foreground">
                  {personalBest.accuracy.toFixed(2)}%
                </span>
              {/if}
            </span>
          </div>
        </div>
      {/if}

      <!-- Chart leaderboard (Bilibili Toy only; the chart must own a board). -->
      {#if toyEnabled && chartBoard !== null}
        <Collapsible.Root
          bind:open={leaderboardOpen}
          class="w-full md:order-3 md:w-[min(28rem,42vw)]"
        >
          <Collapsible.Trigger
            class="flex w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {m.leaderboard()}
            <ChevronDownIcon
              class="size-4 transition-transform {leaderboardOpen ? 'rotate-180' : ''}"
            />
          </Collapsible.Trigger>
          <Collapsible.Content class="pt-2">
            <ChartLeaderboard
              entries={leaderboard ?? []}
              {myRank}
              loading={leaderboard === null && !leaderboardError}
              error={leaderboardError}
              onRetry={loadLeaderboard}
            />
          </Collapsible.Content>
        </Collapsible.Root>
      {/if}
    </div>
  </div>

  <!-- Action bar: pinned below the scrollable content so it sits fixed at
       the bottom of the dialog, clear of the fading content. Aligned with
       the content column's right edge and padded like the other elements. -->
  <div
    class="relative w-full shrink-0 px-3 pt-3 pb-4 md:ml-auto md:mr-12 md:w-[min(28rem,42vw)] md:px-0 md:pt-4 md:pb-6"
  >
    <div class="relative flex w-full flex-wrap items-center gap-2 md:flex-nowrap md:gap-3">
      <Button
        size="lg"
        class="min-w-28 flex-1 gap-2 md:h-14 md:min-w-44 md:text-lg"
        onclick={() => onPlay({ autoplay: false, practice: false, adjustOffset: false, autostart })}
      >
        <PlayIcon class="size-4 md:size-5" />
        {m.play()}
      </Button>
      <Button
        size="lg"
        variant="outline"
        class="gap-2 md:h-14 md:px-6 md:text-lg"
        title={m.autoplay_description()}
        onclick={() => onPlay({ autoplay: true, practice: false, adjustOffset: false, autostart })}
      >
        <CirclePlayIcon class="size-4 md:size-5" />
        {m.autoplay()}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button
            variant="outline"
            size="icon-lg"
            class="md:size-14"
            aria-label={m.play_options()}
            title={m.play_options()}
          >
            <EllipsisIcon class="size-4 md:size-5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item
            onSelect={(e) => {
              onPlay({ autoplay: false, practice: true, adjustOffset: false, autostart });
              e.preventDefault();
            }}
          >
            <Gamepad2Icon class="size-4" />
            {m.practice()}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={(e) => {
              onPlay({ autoplay: true, practice: false, adjustOffset: true, autostart });
              e.preventDefault();
            }}
          >
            <TimerIcon class="size-4" />
            {m.adjust_offset()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onSelect={(e) => {
              toggleAutostart();
              e.preventDefault();
            }}
          >
            <RocketIcon class="size-4" />
            {m.autostart()}
            {#if autostart}
              <CheckIcon class="ms-auto size-4 text-primary" />
            {/if}
          </DropdownMenu.Item>
          {#if isWeb}
            <DropdownMenu.Item
              onSelect={(e) => {
                toggleNewTab();
                e.preventDefault();
              }}
            >
              <SquareArrowOutUpRightIcon class="size-4" />
              {m.new_tab()}
              {#if newTab}
                <CheckIcon class="ms-auto size-4 text-primary" />
              {/if}
            </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</div>

<style>
  @property --fade {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }

  .advanced-fade {
    transition: --fade 300ms ease;
    -webkit-mask-image: linear-gradient(to bottom, black calc(100% - var(--fade)), transparent);
    mask-image: linear-gradient(to bottom, black calc(100% - var(--fade)), transparent);
  }
</style>
