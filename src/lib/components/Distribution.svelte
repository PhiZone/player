<script lang="ts">
  export let data: {
    title: string;
    subtitle: string;
    description: string | undefined;
    href: string;
    color: string;
    fa: string;
  };
</script>

<a
  class="x-card x-image-full overflow-hidden transition glow shadow-{data.color} border-2 border-gray-200 text-gray-500 hover:border-{data.color} hover:text-{data.color} focus:outline-none focus:border-{data.color} focus:text-{data.color} disabled:opacity-50 disabled:pointer-events-none dark:border-neutral-700 dark:text-neutral-400 backdrop-blur-lg"
  href={data.href}
>
  <figure>
    <div class="text-7xl px-4 py-2 opacity-20">
      <i class="fa-brands fa-{data.fa} fa-2xl"></i>
    </div>
  </figure>
  <div class="x-card-body flex flex-col p-4 md:p-5">
    <h3 class="text-2xl font-bold text-gray-800 dark:text-white">{data.title}</h3>
    <p class="text-xs font-medium text-gray-500 dark:text-neutral-500">
      {data.subtitle}
    </p>
    {#if data.description}
      <p class="mt-2 text-gray-500 dark:text-neutral-400">
        {data.description}
      </p>
    {/if}
  </div>
</a>

<style lang="postcss">
  .glow {
    @apply hover:shadow-[0_0_48px_5px];
  }
  .x-card {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: var(--rounded-box, 1rem /* 16px */);
  }
  .x-card:focus {
    outline: 2px solid transparent;
    outline-offset: 2px;
  }
  .x-card figure {
    display: flex;
    align-items: center;
    justify-content: end;
  }
  .x-card.x-image-full {
    display: grid;
  }
  .x-card.x-image-full:before,
  .x-card.x-image-full > * {
    grid-column-start: 1;
    grid-row-start: 1;
  }
  .x-card.x-image-full > .x-card-body {
    position: relative;
    z-index: 20;
    --tw-text-opacity: 1;
    color: var(--fallback-nc, oklch(var(--nc) / var(--tw-text-opacity)));
  }
  .x-card :where(figure:first-child) {
    overflow: hidden;
    border-start-start-radius: inherit;
    border-start-end-radius: inherit;
    border-end-start-radius: unset;
    border-end-end-radius: unset;
  }
  .x-card :where(figure:last-child) {
    overflow: hidden;
    border-start-start-radius: unset;
    border-start-end-radius: unset;
    border-end-start-radius: inherit;
    border-end-end-radius: inherit;
  }
  .x-card:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .x-card.x-image-full :where(figure) {
    overflow: hidden;
    border-radius: inherit;
  }
</style>
