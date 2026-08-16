<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import LibraryIcon from '@lucide/svelte/icons/library';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import type { AppTab } from './TopBar.svelte';

  let {
    tab,
    onSelectTab,
    onOpenSettings,
  }: {
    tab: AppTab;
    onSelectTab: (tab: AppTab) => void;
    onOpenSettings: () => void;
  } = $props();

  interface NavItem {
    key: 'discover' | 'library' | 'settings';
    label: string;
    icon: typeof CompassIcon;
  }

  const items: NavItem[] = [
    { key: 'discover', label: m.discover(), icon: CompassIcon },
    { key: 'library', label: m.library(), icon: LibraryIcon },
    { key: 'settings', label: m.settings(), icon: SettingsIcon },
  ];
</script>

<nav
  class="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden"
  style="padding-bottom: env(safe-area-inset-bottom)"
  aria-label={m.settings()}
>
  <div class="grid grid-cols-3">
    {#each items as item (item.key)}
      <button
        type="button"
        class="flex flex-col items-center gap-1 py-2.5 transition-colors {item.key === 'settings'
          ? tab !== 'discover' && tab !== 'library'
            ? 'text-primary'
            : 'text-muted-foreground'
          : tab === item.key
            ? 'text-primary'
            : 'text-muted-foreground'}"
        onclick={() => {
          if (item.key === 'settings') {
            onOpenSettings();
          } else {
            onSelectTab(item.key);
          }
        }}
      >
        <item.icon class="size-5" />
        <span class="text-[11px] font-medium">{item.label}</span>
      </button>
    {/each}
  </div>
</nav>
