<script lang="ts">
  import { Progress } from '$lib/components/ui/progress';
  import { m } from '$lib/paraglide/messages';

  let {
    progress = -1,
    progressDetail = '',
    progressSpeed = -1,
    showProgress = true,
  }: {
    progress?: number;
    progressDetail?: string;
    progressSpeed?: number;
    showProgress?: boolean;
  } = $props();

  const visible = $derived(progress >= 0 && showProgress);

  const humanizeFileSize = (size: number) => {
    let i = size == 0 ? 0 : Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i];
  };
</script>

{#if visible}
  <div class="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
    <div
      class="pointer-events-auto w-full max-w-md rounded-2xl border bg-card/95 p-4 shadow-2xl backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <div class="mb-2 flex items-center justify-between gap-3">
        <p class="truncate text-sm font-medium">{progressDetail || m.processing_files()}</p>
        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
          {#if progressSpeed >= 0}
            {humanizeFileSize(progressSpeed)}/s
          {/if}
        </span>
      </div>
      <Progress value={Math.round(progress * 100)} />
    </div>
  </div>
{/if}
