<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import type { StoredChartSummary } from '$lib/types';

  interface Props {
    summaries: StoredChartSummary[];
    onload: (id: string) => void;
    onexport: (id: string) => void;
    ondelete: (id: string) => void;
    onimport: () => void;
  }

  let { summaries, onload, onexport, ondelete, onimport }: Props = $props();

  let thumbnails = new Map<string, string>();
  const getThumbnail = (summary: StoredChartSummary): string | undefined => {
    if (!summary.illustration) return undefined;
    let url = thumbnails.get(summary.id);
    if (!url) {
      url = URL.createObjectURL(summary.illustration.data);
      thumbnails.set(summary.id, url);
    }
    return url;
  };

  onDestroy(() => {
    thumbnails.forEach((url) => URL.revokeObjectURL(url));
  });

  const confirmDelete = (summary: StoredChartSummary) => {
    if (!window.confirm(m['chart_manager.delete_confirm']())) return;
    ondelete(summary.id);
  };

  const levelBadge = (summary: StoredChartSummary): string => {
    const typeNames = ['EZ', 'HD', 'IN', 'AT', 'SP'];
    const typeName = typeNames[summary.metadata.levelType] ?? 'IN';
    const level = summary.metadata.level;
    return level ? (level.startsWith(typeName) ? level : `${typeName} ${level}`) : typeName;
  };
</script>

<div class="w-full">
  {#if summaries.length === 0}
    <div class="flex flex-col items-center gap-4 py-10 text-center">
      <i class="fa-solid fa-box-open fa-3x text-gray-300 dark:text-neutral-600"></i>
      <p class="text-gray-600 dark:text-neutral-400">{m['chart_manager.empty_state']()}</p>
      <button
        type="button"
        class="inline-flex justify-center items-center gap-x-2 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-2.5 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
        onclick={() => onimport()}
      >
        {m.load_files()}
        <i class="fa-solid fa-file-import"></i>
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 justify-items-center">
      {#each summaries as summary (summary.id)}
        <div
          class="card w-full max-w-xs h-[23rem] bg-base-100 overflow-hidden transition border-2 border-gray-200 dark:border-neutral-700 hover:shadow-lg"
        >
          <figure
            class="w-full h-40 shrink-0 flex justify-center items-center bg-neutral-200 dark:bg-neutral"
          >
            {#if getThumbnail(summary)}
              <img
                src={getThumbnail(summary)}
                alt={summary.metadata.title ?? ''}
                class="w-full h-40 object-cover"
              />
            {:else}
              <p class="text-sm text-gray-500 dark:text-neutral-400">
                {m['chart_manager.no_illustration']()}
              </p>
            {/if}
          </figure>
          <div class="card-body py-4 pb-16">
            <div class="flex flex-col gap-1">
              <h2 class="text-xl font-extrabold w-full" title={summary.metadata.title ?? undefined}>
                {summary.metadata.title ?? ''}
                <span class="badge badge-neutral align-middle">{levelBadge(summary)}</span>
              </h2>
              <h2 class="opacity-80 w-full truncate" title={summary.metadata.composer ?? undefined}>
                {summary.metadata.composer ?? ''}
              </h2>
            </div>
          </div>
          <div class="absolute bottom-4 inset-x-4 flex flex-wrap justify-end gap-2">
            <button
              class="btn btn-sm rounded-full btn-outline btn-success uppercase"
              onclick={() => onload(summary.id)}
            >
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
              {m['chart_manager.load']()}
            </button>
            <button
              class="btn btn-sm btn-circle btn-outline btn-success"
              aria-label={m['chart_manager.export']()}
              title={m['chart_manager.export']()}
              onclick={() => onexport(summary.id)}
            >
              <i class="fa-solid fa-file-export"></i>
            </button>
            <button
              class="btn btn-sm btn-circle btn-outline btn-error"
              aria-label={m.delete()}
              title={m.delete()}
              onclick={() => confirmDelete(summary)}
            >
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
