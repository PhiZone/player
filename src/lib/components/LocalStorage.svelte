<script lang="ts">
  import { IS_TAURI } from '$lib/utils';
  import { Capacitor } from '@capacitor/core';

  let modal: HTMLDialogElement;
</script>

{#if !IS_TAURI && Capacitor.getPlatform() === 'web'}
  <button
    aria-label="Local storage"
    onclick={() => modal.showModal()}
    class="size-12 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
  >
    <i class="fa-solid fa-hard-drive"></i>
  </button>
{:else}
  <button
    onclick={() => modal.showModal()}
    class="py-3 px-4 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 transition"
  >
    Local storage
    <i class="fa-solid fa-hard-drive"></i>
  </button>
{/if}
<dialog id="local-storage" class="modal" bind:this={modal}>
  <div class="modal-box overflow-x-hidden">
    <form method="dialog">
      <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
    </form>
    <h3 class="text-lg font-bold">Local storage</h3>
    <div class="w-full form-control gap-4"></div>
  </div>
</dialog>
