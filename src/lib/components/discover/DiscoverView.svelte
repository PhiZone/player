<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cn } from '$lib/cn';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Card } from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Badge } from '$lib/components/ui/badge';
  import { m } from '$lib/paraglide/messages';
  import {
    libraryApi,
    type ApiChartSummary,
    type ApiChartDetail,
    type ApiPackSummary,
    type ApiPackDetail,
    type ApiSort,
  } from '$lib/services/libraryApi';
  import { formatCompactNumber } from '$lib/utils';
  import { detectToyEnvironment } from '$lib/services/toy';
  import { getLeaderboardCharts } from '$lib/services/toyLeaderboards';
  import DifficultyBadge from '$lib/components/common/DifficultyBadge.svelte';
  import SearchIcon from '@lucide/svelte/icons/search';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import CheckIcon from '@lucide/svelte/icons/check';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import MusicIcon from '@lucide/svelte/icons/music';
  import PaletteIcon from '@lucide/svelte/icons/palette';
  import WifiOffIcon from '@lucide/svelte/icons/wifi-off';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
  import XIcon from '@lucide/svelte/icons/x';
  import TrophyIcon from '@lucide/svelte/icons/trophy';

  type OnlineDetail = ({ kind: 'chart' } & ApiChartDetail) | ({ kind: 'pack' } & ApiPackDetail);

  let {
    onInstall,
    onOpen,
    installedOnlineIds = new Set<string>(),
  }: {
    onInstall: (
      kind: 'chart' | 'pack',
      downloadUrl: string,
      title: string,
      onlineId?: string,
    ) => Promise<void>;
    /** Open a chart that is already installed locally (by online id). */
    onOpen?: (onlineId: string) => void;
    /** Online-library ids of charts already present in the local library. */
    installedOnlineIds?: Set<string>;
  } = $props();

  const PAGE_SIZE = 20;

  let segment = $state<'charts' | 'packs'>('charts');
  let query = $state('');
  let debouncedQuery = $state('');
  let sort = $state<ApiSort>('newest');
  let sortStr = $state<string | undefined>('newest');

  let chartItems = $state<ApiChartSummary[]>([]);
  let packItems = $state<ApiPackSummary[]>([]);
  let chartPage = $state(0);
  let packPage = $state(0);
  let chartTotal = $state(0);
  let packTotal = $state(0);
  let loading = $state(false);
  let error = $state(false);

  let installingId = $state<string | null>(null);
  let installedIds = $state<Set<string>>(new Set());

  // Bilibili Toy: the first three online charts (by creation date) own the
  // toy's leaderboard boards — those cards are highlighted in the grid.
  let toyEnabled = $state(false);
  let leaderboardBoards = $state<Map<string, number>>(new Map());

  onMount(async () => {
    toyEnabled = await detectToyEnvironment();
    if (!toyEnabled) return;
    const charts = await getLeaderboardCharts();
    leaderboardBoards = new Map(charts.map(({ board, chart }) => [chart.id, board]));
  });

  let dialogOpen = $state(false);
  let detailId = $state<string | null>(null);
  let detail = $state<OnlineDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state(false);

  // Non-reactive request sequence; in-flight responses from older filters are
  // dropped when a newer request supersedes them.
  let requestSeq = 0;

  const currentItems = $derived(segment === 'charts' ? chartItems : packItems);
  const currentTotal = $derived(segment === 'charts' ? chartTotal : packTotal);

  const sortLabel = $derived(
    sort === 'popular' ? m.sort_popular() : sort === 'title' ? m.sort_title() : m.sort_newest(),
  );

  const detailTitle = $derived(
    detail ? (detail.kind === 'chart' ? detail.title : detail.name) : '',
  );

  // Keep the select mirror in sync with the typed value.
  $effect(() => {
    if (sortStr === undefined) return;
    if (sortStr !== sort) sort = sortStr as ApiSort;
  });

  // Debounce the search input.
  $effect(() => {
    const value = query;
    const timer = setTimeout(() => {
      debouncedQuery = value;
    }, 400);
    return () => clearTimeout(timer);
  });

  // Reload from page 1 whenever the filters change (and on mount).
  $effect(() => {
    const seg = segment;
    const srt = sort;
    const q = debouncedQuery;
    chartItems = [];
    packItems = [];
    chartPage = 0;
    packPage = 0;
    chartTotal = 0;
    packTotal = 0;
    void loadPage(1, seg, srt, q);
  });

  const loadPage = async (pageNumber: number, seg: 'charts' | 'packs', srt: ApiSort, q: string) => {
    const seq = ++requestSeq;
    loading = true;
    error = false;
    try {
      if (seg === 'charts') {
        const response = await libraryApi.listCharts({
          page: pageNumber,
          pageSize: PAGE_SIZE,
          sort: srt,
          q: q.trim(),
        });
        if (seq !== requestSeq) return;
        chartItems = untrack(() => [...chartItems, ...response.items]);
        chartPage = response.page;
        chartTotal = response.total;
      } else {
        const response = await libraryApi.listPacks({
          page: pageNumber,
          pageSize: PAGE_SIZE,
          sort: srt,
          q: q.trim(),
        });
        if (seq !== requestSeq) return;
        packItems = untrack(() => [...packItems, ...response.items]);
        packPage = response.page;
        packTotal = response.total;
      }
    } catch {
      if (seq === requestSeq) error = true;
    } finally {
      if (seq === requestSeq) loading = false;
    }
  };

  const openDetail = async (id: string) => {
    if (dialogOpen) return;
    dialogOpen = true;
    detailId = id;
    detail = null;
    detailError = false;
    detailLoading = true;
    try {
      detail =
        segment === 'charts'
          ? { kind: 'chart', ...(await libraryApi.getChart(id)) }
          : { kind: 'pack', ...(await libraryApi.getPack(id)) };
    } catch {
      detailError = true;
    } finally {
      detailLoading = false;
    }
  };

  const install = async (
    kind: 'chart' | 'pack',
    id: string,
    downloadUrl: string,
    title: string,
    onlineId?: string,
  ) => {
    if (installingId !== null) return;
    installingId = id;
    try {
      await onInstall(kind, downloadUrl, title, onlineId);
      installedIds = new Set(installedIds).add(id);
      // Download + import finished: dismiss the detail dialog on its own.
      dialogOpen = false;
    } catch {
      // Leave the dialog open so the user can retry.
    } finally {
      installingId = null;
    }
  };

  /** A chart is already in the local library when its online id matches. */
  const isInstalled = (item: ApiChartSummary) =>
    installedIds.has(item.id) || installedOnlineIds.has(item.id);

  /** Open an already-installed chart directly (no download, no dedup). */
  const openInstalled = (item: ApiChartSummary) => {
    if (dialogOpen) return;
    onOpen?.(item.id);
  };

  const humanizeFileSize = (size: number) => {
    let i = size == 0 ? 0 : Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };
</script>

<section class="flex flex-col gap-4">
  <!-- Search + sort -->
  <div class="flex flex-wrap items-center gap-2">
    <div class="relative min-w-0 flex-1 basis-64">
      <SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        bind:value={query}
        class="ps-9 pe-9"
        placeholder={m.search_online()}
        aria-label={m.search_online()}
      />
      {#if query}
        <button
          type="button"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={m.clear()}
          onclick={() => (query = '')}
        >
          <XIcon class="size-4" />
        </button>
      {/if}
    </div>
    <Select.Root type="single" bind:value={sortStr}>
      <Select.Trigger class="w-36" aria-label={m.sort()}>
        <ArrowUpDownIcon class="size-4" />
        <span>{sortLabel}</span>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="newest">{m.sort_newest()}</Select.Item>
        <Select.Item value="popular">{m.sort_popular()}</Select.Item>
        <Select.Item value="title">{m.sort_title()}</Select.Item>
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Charts / Packs -->
  <Tabs.Root bind:value={segment}>
    <Tabs.List>
      <Tabs.Trigger value="charts">
        {m.charts()}
        {#if chartTotal > 0}
          <span class="ms-1 text-xs text-muted-foreground">{chartTotal}</span>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="packs">
        {m.packs()}
        {#if packTotal > 0}
          <span class="ms-1 text-xs text-muted-foreground">{packTotal}</span>
        {/if}
      </Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>

  {#if error && currentItems.length === 0}
    <Card class="mx-auto flex max-w-md flex-col items-center gap-4 border-dashed p-10 text-center">
      <div
        class="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50 text-muted-foreground"
      >
        <WifiOffIcon class="size-6" />
      </div>
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">{m.discover_error_title()}</h2>
        <p class="text-sm text-muted-foreground">{m.discover_error_description()}</p>
      </div>
      <Button variant="outline" onclick={() => loadPage(1, segment, sort, debouncedQuery)}>
        <LoaderCircleIcon class="size-4" />
        {m.retry()}
      </Button>
    </Card>
  {:else if !error && !loading && currentItems.length === 0}
    <Card class="mx-auto flex max-w-md flex-col items-center gap-4 border-dashed p-10 text-center">
      <div
        class="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50 text-muted-foreground"
      >
        {#if query.trim()}
          <SearchIcon class="size-6" />
        {:else}
          <CompassIcon class="size-6" />
        {/if}
      </div>
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">
          {query.trim() ? m.online_no_results_title() : m.online_empty_title()}
        </h2>
        <p class="text-sm text-muted-foreground">
          {query.trim()
            ? m.online_no_results_description({ query: query.trim() })
            : m.online_empty_description()}
        </p>
      </div>
    </Card>
  {:else}
    <div
      class={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
        segment === 'packs' && 'lg:grid-cols-3 xl:grid-cols-4',
      )}
    >
      {#if segment === 'charts'}
        {#each chartItems as item (item.id)}
          <div
            role="button"
            tabindex="0"
            class="group cursor-pointer rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => openDetail(item.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDetail(item.id);
              }
            }}
          >
            <Card
              size="sm"
              class={cn(
                'h-full rounded-xl transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-lg group-hover:shadow-primary/10',
                // The first three online charts own the toy's leaderboard
                // boards — highlight their card edges so players spot the
                // charts that carry a live leaderboard.
                toyEnabled &&
                  leaderboardBoards.has(item.id) &&
                  'border-violet-400/70 shadow-md shadow-violet-500/20 group-hover:border-violet-400/90',
              )}
            >
              <div class="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                {#if item.cover}
                  <img
                    src={item.cover.url}
                    alt={item.title}
                    loading="lazy"
                    class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                {:else}
                  <div class="flex size-full items-center justify-center text-muted-foreground">
                    <MusicIcon class="size-8 opacity-40" />
                  </div>
                {/if}
                {#if item.downloadCount > 0}
                  <div
                    class="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs backdrop-blur"
                    title={m.downloads({ count: formatCompactNumber(item.downloadCount) })}
                  >
                    <DownloadIcon class="size-3" />
                    {formatCompactNumber(item.downloadCount)}
                  </div>
                {/if}
                {#if toyEnabled && leaderboardBoards.has(item.id)}
                  <div
                    class="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-violet-500/30"
                    title={m.leaderboard()}
                  >
                    <TrophyIcon class="size-3" />
                    {m.leaderboard()}
                  </div>
                {/if}
                <div class="absolute right-2 top-2">
                  <Button
                    size="icon-xs"
                    variant="secondary"
                    class="bg-background/80 backdrop-blur"
                    aria-label={isInstalled(item) ? m.open() : m.install()}
                    disabled={installingId !== null}
                    onclick={(e) => {
                      e.stopPropagation();
                      if (isInstalled(item)) {
                        openInstalled(item);
                      } else {
                        install('chart', item.id, item.downloadUrl, item.title, item.id);
                      }
                    }}
                  >
                    {#if installingId === item.id}
                      <LoaderCircleIcon class="size-3.5 animate-spin" />
                    {:else if isInstalled(item)}
                      <CheckIcon class="size-3.5" />
                    {:else}
                      <DownloadIcon class="size-3.5" />
                    {/if}
                  </Button>
                </div>
              </div>
              <div class="space-y-1 p-3">
                <div class="flex items-start justify-between gap-2">
                  <h3 class="truncate text-sm font-semibold" title={item.title}>
                    {item.title}
                  </h3>
                  <DifficultyBadge levelType={item.levelType} level={item.level} />
                </div>
                <p
                  class="truncate text-xs text-muted-foreground"
                  title={[item.composer, item.charter].filter(Boolean).join(' · ')}
                >
                  {[item.composer, item.charter].filter(Boolean).join(' · ')}
                </p>
              </div>
            </Card>
          </div>
        {/each}
      {:else}
        {#each packItems as item (item.id)}
          <div
            role="button"
            tabindex="0"
            class="group cursor-pointer rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => openDetail(item.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDetail(item.id);
              }
            }}
          >
            <Card
              size="sm"
              class="h-full rounded-xl transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-lg group-hover:shadow-primary/10"
            >
              <div class="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                {#if item.cover}
                  <img
                    src={item.cover.url}
                    alt={item.name}
                    loading="lazy"
                    class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                {:else}
                  <div class="flex size-full items-center justify-center text-muted-foreground">
                    <PaletteIcon class="size-8 opacity-40" />
                  </div>
                {/if}
                {#if item.downloadCount > 0}
                  <div
                    class="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs backdrop-blur"
                    title={m.downloads({ count: formatCompactNumber(item.downloadCount) })}
                  >
                    <DownloadIcon class="size-3" />
                    {formatCompactNumber(item.downloadCount)}
                  </div>
                {/if}
                <div class="absolute right-2 top-2">
                  <Button
                    size="icon-xs"
                    variant="secondary"
                    class="bg-background/80 backdrop-blur"
                    aria-label={m.install()}
                    disabled={installingId !== null}
                    onclick={(e) => {
                      e.stopPropagation();
                      install('pack', item.id, item.downloadUrl, item.name);
                    }}
                  >
                    {#if installingId === item.id}
                      <LoaderCircleIcon class="size-3.5 animate-spin" />
                    {:else if installedIds.has(item.id)}
                      <CheckIcon class="size-3.5" />
                    {:else}
                      <DownloadIcon class="size-3.5" />
                    {/if}
                  </Button>
                </div>
              </div>
              <div class="space-y-1 p-3">
                <h3 class="truncate text-sm font-semibold" title={item.name}>{item.name}</h3>
                <p class="truncate text-xs text-muted-foreground" title={item.author}>
                  {item.author}{#if item.version}
                    · {item.version}{/if}
                </p>
              </div>
            </Card>
          </div>
        {/each}
      {/if}
      {#if loading}
        {#each Array(8) as _}
          <Skeleton class="aspect-[4/3] w-full rounded-xl" />
        {/each}
      {/if}
    </div>

    {#if error && currentItems.length > 0}
      <p class="text-center text-sm text-muted-foreground">{m.discover_error_description()}</p>
    {/if}

    {#if !error && currentItems.length > 0 && currentItems.length < currentTotal}
      <div class="flex justify-center">
        <Button
          variant="outline"
          disabled={loading}
          onclick={() =>
            loadPage(
              segment === 'charts' ? chartPage + 1 : packPage + 1,
              segment,
              sort,
              debouncedQuery,
            )}
        >
          {#if loading}
            <LoaderCircleIcon class="size-4 animate-spin" />
          {/if}
          {m.load_more()}
        </Button>
      </div>
    {/if}
  {/if}

  <!-- Detail dialog -->
  <Dialog.Root
    open={dialogOpen}
    onOpenChange={(open) => {
      dialogOpen = open;
      if (!open) {
        detail = null;
        detailError = false;
      }
    }}
  >
    <Dialog.Content class="max-w-lg">
      <Dialog.Header>
        <Dialog.Title>{detailTitle}</Dialog.Title>
        <Dialog.Description>
          {#if detail?.kind === 'chart'}
            {[detail.composer, detail.charter].filter(Boolean).join(' · ')}
          {:else if detail?.kind === 'pack'}
            {detail.author}
          {/if}
        </Dialog.Description>
      </Dialog.Header>

      {#if detailLoading}
        <div class="space-y-3">
          <Skeleton class="aspect-[16/9] w-full rounded-xl" />
          <Skeleton class="h-4 w-2/3" />
          <Skeleton class="h-4 w-1/2" />
        </div>
      {:else if detailError}
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          <WifiOffIcon class="size-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">{m.discover_error_description()}</p>
          <Button variant="outline" size="sm" onclick={() => detailId && openDetail(detailId)}>
            {m.retry()}
          </Button>
        </div>
      {:else if detail}
        <div class="space-y-4">
          <div class="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted">
            {#if detail.cover}
              <img src={detail.cover.url} alt={detailTitle} class="size-full object-cover" />
            {:else}
              <div class="flex size-full items-center justify-center text-muted-foreground">
                <MusicIcon class="size-10 opacity-40" />
              </div>
            {/if}
            {#if detail.downloadCount > 0}
              <div
                class="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs backdrop-blur"
              >
                <DownloadIcon class="size-3" />
                {m.downloads({ count: formatCompactNumber(detail.downloadCount) })}
              </div>
            {/if}
          </div>

          {#if detail.kind === 'chart'}
            <div class="flex flex-wrap items-center gap-2">
              <DifficultyBadge levelType={detail.levelType} level={detail.level} />
              {#if detail.format}
                <Badge variant="outline">{detail.format.toUpperCase()}</Badge>
              {/if}
            </div>
            <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {#if detail.composer}
                <div class="flex gap-1.5">
                  <dt class="text-muted-foreground">{m['metadata.composer']()}:</dt>
                  <dd class="min-w-0 truncate">{detail.composer}</dd>
                </div>
              {/if}
              {#if detail.charter}
                <div class="flex gap-1.5">
                  <dt class="text-muted-foreground">{m['metadata.charter']()}:</dt>
                  <dd class="min-w-0 truncate">{detail.charter}</dd>
                </div>
              {/if}
              {#if detail.illustrator}
                <div class="flex gap-1.5">
                  <dt class="text-muted-foreground">{m['metadata.illustrator']()}:</dt>
                  <dd class="min-w-0 truncate">{detail.illustrator}</dd>
                </div>
              {/if}
            </dl>
          {:else}
            <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div class="flex gap-1.5">
                <dt class="text-muted-foreground">{m['metadata.composer']()}:</dt>
                <dd class="min-w-0 truncate">{detail.author}</dd>
              </div>
              {#if detail.version}
                <div class="flex gap-1.5">
                  <dt class="text-muted-foreground">{m.version()}:</dt>
                  <dd class="min-w-0 truncate">{detail.version}</dd>
                </div>
              {/if}
            </dl>
          {/if}

          {#if detail.description}
            <p class="whitespace-pre-line text-sm text-muted-foreground">
              {detail.description}
            </p>
          {/if}

          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {#if detail.sourceName}
              <span>
                {m.source_name()}: {detail.sourceName}
              </span>
            {/if}
            <span>
              {m.file_size()}: {humanizeFileSize(detail.file.size)}
            </span>
            <span>{m.published({ date: new Date(detail.createdAt).toLocaleDateString() })}</span>
          </div>
        </div>

        <Dialog.Footer>
          <Button variant="outline" onclick={() => (dialogOpen = false)}>
            {m.close()}
          </Button>
          {#if detail?.kind === 'chart' && isInstalled(detail)}
            <Button
              class="gap-2"
              onclick={() => {
                if (!detail) return;
                dialogOpen = false;
                onOpen?.(detail.id);
              }}
            >
              <CheckIcon class="size-4" />
              {m.open()}
            </Button>
          {:else}
            <Button
              class="gap-2"
              disabled={installingId !== null}
              onclick={() => {
                if (!detail) return;
                install(detail.kind, detail.id, detail.downloadUrl, detailTitle, detail.id);
              }}
            >
              {#if installingId === detail.id}
                <LoaderCircleIcon class="size-4 animate-spin" />
                {m.installing()}
              {:else if installedIds.has(detail.id)}
                <CheckIcon class="size-4" />
                {m.installed_label()}
              {:else}
                <DownloadIcon class="size-4" />
                {m.install()}
              {/if}
            </Button>
          {/if}
        </Dialog.Footer>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
</section>
