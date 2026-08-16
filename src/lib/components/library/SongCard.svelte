<script lang="ts">
  import { Card } from '$lib/components/ui/card';
  import type { StoredChartSummary } from '$lib/types';
  import DifficultyBadge from '$lib/components/common/DifficultyBadge.svelte';
  import MusicIcon from '@lucide/svelte/icons/music';

  let {
    summary,
    thumbnailUrl,
    onclick,
  }: {
    summary: StoredChartSummary;
    thumbnailUrl?: string;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class="group text-start" {onclick}>
  <Card
    size="sm"
    class="h-full rounded-xl transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-lg group-hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <div class="relative aspect-[4/3] w-full overflow-hidden bg-muted">
      {#if thumbnailUrl}
        <img
          src={thumbnailUrl}
          alt={summary.metadata.title ?? ''}
          class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      {:else}
        <div class="flex size-full items-center justify-center text-muted-foreground">
          <MusicIcon class="size-8 opacity-40" />
        </div>
      {/if}
    </div>
    <div class="space-y-1 p-3">
      <div class="flex items-start justify-between gap-2">
        <h3 class="truncate text-sm font-semibold" title={summary.metadata.title ?? undefined}>
          {summary.metadata.title ?? ''}
        </h3>
        <DifficultyBadge levelType={summary.metadata.levelType} level={summary.metadata.level} />
      </div>
      <p
        class="truncate text-xs text-muted-foreground"
        title={summary.metadata.composer ?? undefined}
      >
        {summary.metadata.composer ?? ''}
      </p>
    </div>
  </Card>
</button>
