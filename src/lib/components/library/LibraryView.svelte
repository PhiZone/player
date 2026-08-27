<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import { m } from '$lib/paraglide/messages';
  import type { StoredChartSummary, ResourcePackWithId } from '$lib/types';
  import { lookupChartStats, lookupPacksStats } from '$lib/services/onlineStats';
  import type { ApiChartSummary, ApiPackSummary } from '$lib/services/libraryApi';
  import { slideFade, staggerDelay } from '$lib/motion';
  import SongCard from './SongCard.svelte';
  import PackCard from './PackCard.svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import MusicIcon from '@lucide/svelte/icons/music';
  import PaletteIcon from '@lucide/svelte/icons/palette';

  let {
    summaries,
    respacks,
    selectedRespackId,
    onChartSelect,
    onPackSelect,
    onPackExport,
    onPackDelete,
    onImport,
    onBrowseOnline,
  }: {
    summaries: StoredChartSummary[];
    respacks: (ResourcePackWithId<File> | ResourcePackWithId<string>)[];
    selectedRespackId: string | null;
    onChartSelect: (summary: StoredChartSummary) => void;
    onPackSelect: (id: string) => void;
    onPackExport: (id: string) => void;
    onPackDelete: (id: string) => void;
    onImport: () => void;
    onBrowseOnline: () => void;
  } = $props();

  let segment = $state<'charts' | 'packs'>('charts');

  // ── Online stats for local entries (matched by metadata, cached) ───────
  let onlineCharts = $state<Map<string, ApiChartSummary>>(new Map());
  let onlinePacks = $state<Map<string, ApiPackSummary>>(new Map());

  $effect(() => {
    const s = summaries;
    const p = respacks;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [charts, packs] = await Promise.all([lookupChartStats(s), lookupPacksStats(p)]);
      if (cancelled) return;
      onlineCharts = charts;
      onlinePacks = packs;
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Direction of the last segment change for the view transition
  // (charts sits left of packs). Updated synchronously with `segment`
  // so the intro reads the correct direction; 0 = plain fade.
  let segmentDirection = $state(0);
  const changeSegment = (value: string) => {
    if (value !== segment) {
      segmentDirection = value === 'packs' ? 1 : -1;
      segment = value as 'charts' | 'packs';
    }
  };

  // ── Thumbnail object-URL caches ──────────────────────────────────────
  const chartThumbs = new Map<string, string>();
  const getChartThumb = (summary: StoredChartSummary): string | undefined => {
    if (!summary.illustration) return undefined;
    let url = chartThumbs.get(summary.id);
    if (!url) {
      url = URL.createObjectURL(summary.illustration.data);
      chartThumbs.set(summary.id, url);
    }
    return url;
  };

  const packThumbs = new Map<string, { url: string; revoke: boolean }>();
  const getPackThumb = (
    pack: ResourcePackWithId<File> | ResourcePackWithId<string>,
  ): string | undefined => {
    const thumbnail = pack.thumbnail;
    if (!thumbnail) return undefined;
    if (typeof thumbnail === 'string') return thumbnail;
    const cached = packThumbs.get(pack.id);
    if (cached) return cached.url;
    const url = URL.createObjectURL(thumbnail);
    packThumbs.set(pack.id, { url, revoke: true });
    return url;
  };

  onDestroy(() => {
    chartThumbs.forEach((url) => URL.revokeObjectURL(url));
    packThumbs.forEach(({ url, revoke }) => {
      if (revoke) URL.revokeObjectURL(url);
    });
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <Tabs.Root value={segment} onValueChange={changeSegment}>
      <Tabs.List>
        <Tabs.Trigger value="charts">
          {m.charts()}
          <span class="ms-1 text-xs text-muted-foreground">{summaries.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="packs">
          {m.packs()}
          <span class="ms-1 text-xs text-muted-foreground">{respacks.length}</span>
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <Button onclick={onImport}>
      <PlusIcon class="size-4" />
      {m.import_charts()}
    </Button>
  </div>

  {#key segment}
    <div in:slideFade={{ direction: segmentDirection }}>
      {#if segment === 'charts'}
        {#if summaries.length === 0}
          <Card
            class="mx-auto flex max-w-md flex-col items-center gap-4 border-dashed p-10 text-center"
          >
            <div
              class="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50 text-muted-foreground"
            >
              <MusicIcon class="size-6" />
            </div>
            <div class="space-y-1">
              <h2 class="text-lg font-semibold">{m.library_empty_title()}</h2>
              <p class="text-sm text-muted-foreground">{m.library_empty_description()}</p>
            </div>
            <div class="flex flex-wrap justify-center gap-2">
              <Button onclick={onImport}>
                <PlusIcon class="size-4" />
                {m.import_charts()}
              </Button>
              <Button variant="outline" onclick={onBrowseOnline}>
                <CompassIcon class="size-4" />
                {m.browse_online()}
              </Button>
            </div>
          </Card>
        {:else}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {#each summaries as summary, i (summary.id)}
              <SongCard
                {summary}
                thumbnailUrl={getChartThumb(summary)}
                downloadCount={onlineCharts.get(summary.id)?.downloadCount}
                enterDelay={staggerDelay(i)}
                onclick={() => onChartSelect(summary)}
              />
            {/each}
          </div>
        {/if}
      {:else if respacks.length === 0}
        <Card
          class="mx-auto flex max-w-md flex-col items-center gap-4 border-dashed p-10 text-center"
        >
          <div
            class="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50 text-muted-foreground"
          >
            <PaletteIcon class="size-6" />
          </div>
          <div class="space-y-1">
            <h2 class="text-lg font-semibold">{m.packs_empty_title()}</h2>
            <p class="text-sm text-muted-foreground">{m.packs_empty_description()}</p>
          </div>
          <Button onclick={onImport}>
            <PlusIcon class="size-4" />
            {m.import_charts()}
          </Button>
        </Card>
      {:else}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {#each respacks as pack, i (pack.id)}
            <PackCard
              name={pack.name}
              author={pack.author}
              description={pack.description}
              thumbnailUrl={getPackThumb(pack)}
              downloadCount={onlinePacks.get(pack.id)?.downloadCount}
              selected={selectedRespackId === pack.id}
              enterDelay={staggerDelay(i)}
              onSelect={() => onPackSelect(pack.id)}
              onexport={() => onPackExport(pack.id)}
              ondelete={() => onPackDelete(pack.id)}
            />
          {/each}
        </div>
      {/if}
    </div>
  {/key}
</div>
