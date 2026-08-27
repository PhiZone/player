<script lang="ts">
  import { Card } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { m } from '$lib/paraglide/messages';
  import { formatCompactNumber } from '$lib/utils';
  import { riseIn } from '$lib/motion';
  import PaletteIcon from '@lucide/svelte/icons/palette';
  import CheckIcon from '@lucide/svelte/icons/check';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import FileDownIcon from '@lucide/svelte/icons/file-down';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import DownloadIcon from '@lucide/svelte/icons/download';

  let {
    name,
    author,
    description,
    thumbnailUrl,
    downloadCount,
    selected,
    enterDelay = 0,
    onSelect,
    onexport,
    ondelete,
  }: {
    name: string;
    author?: string;
    description?: string;
    thumbnailUrl?: string;
    downloadCount?: number;
    selected: boolean;
    /** Stagger delay for the grid entrance animation (ms). */
    enterDelay?: number;
    onSelect: () => void;
    onexport: () => void;
    ondelete: () => void;
  } = $props();
</script>

<div class="h-full" in:riseIn={{ y: 16, delay: enterDelay }}>
  <Card
    size="sm"
    class="group h-full rounded-xl border transition-all duration-200 {selected
      ? 'border-primary/60 ring-1 ring-primary/30'
      : ''} hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
  >
    <div class="relative aspect-[16/9] w-full overflow-hidden bg-muted">
      {#if thumbnailUrl}
        <img
          src={thumbnailUrl}
          alt={name}
          class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      {:else}
        <div class="flex size-full items-center justify-center text-muted-foreground">
          <PaletteIcon class="size-8 opacity-40" />
        </div>
      {/if}
      {#if downloadCount !== undefined && downloadCount > 0}
        <div
          class="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs backdrop-blur"
          title={m.online_stats()}
        >
          <DownloadIcon class="size-3" />
          {formatCompactNumber(downloadCount)}
        </div>
      {/if}
      {#if selected}
        <Badge
          class="absolute right-2 top-2 gap-1 border border-primary/50 bg-background/80 backdrop-blur"
        >
          <CheckIcon class="size-3" />
          {m.selected()}
        </Badge>
      {/if}
    </div>
    <div class="flex flex-1 flex-col gap-1 p-3">
      <h3 class="truncate text-sm font-semibold" title={name}>{name}</h3>
      {#if author}
        <p class="truncate text-xs text-muted-foreground" title={author}>{author}</p>
      {/if}
      {#if description}
        <p class="line-clamp-2 text-xs text-muted-foreground/80">{description}</p>
      {/if}
      <div class="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant={selected ? 'secondary' : 'default'}
          class="flex-1"
          onclick={onSelect}
        >
          {selected ? m.selected() : m.select()}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="ghost" size="icon-sm" aria-label={m['chart_manager.export']()}>
              <EllipsisIcon class="size-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              onSelect={(e) => {
                onexport();
                e.preventDefault();
              }}
            >
              <FileDownIcon class="size-4" />
              {m['chart_manager.export']()}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              class="text-destructive focus:text-destructive"
              onSelect={(e) => {
                ondelete();
                e.preventDefault();
              }}
            >
              <TrashIcon class="size-4" />
              {m.delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
  </Card>
</div>
