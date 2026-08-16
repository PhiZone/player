<script lang="ts">
  import type { Snippet } from 'svelte';
  import TopBar, { type AppTab } from './TopBar.svelte';
  import BottomNav from './BottomNav.svelte';

  let {
    tab,
    onSelectTab,
    onOpenSettings,
    children,
  }: {
    tab: AppTab;
    onSelectTab: (tab: AppTab) => void;
    onOpenSettings: () => void;
    children: Snippet;
  } = $props();
</script>

<div class="relative min-h-dvh">
  <div
    aria-hidden="true"
    class="pointer-events-none fixed inset-x-0 top-0 z-0 h-80 bg-[radial-gradient(70%_100%_at_50%_0%,oklch(0.635_0.22_292_/_0.14),transparent_70%)]"
  ></div>
  <TopBar {tab} {onSelectTab} {onOpenSettings} />
  <main class="relative z-10 mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-12 lg:px-8">
    {@render children()}
  </main>
  <BottomNav {tab} {onSelectTab} {onOpenSettings} />
</div>
