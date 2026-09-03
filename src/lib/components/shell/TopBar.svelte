<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
  import ToyUserBadge from './ToyUserBadge.svelte';
  import type { ToyUser } from '$lib/types';
  import { m } from '$lib/paraglide/messages';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import LibraryIcon from '@lucide/svelte/icons/library';
  import SettingsIcon from '@lucide/svelte/icons/settings';

  export type AppTab = 'discover' | 'library';

  let {
    tab = 'library',
    onSelectTab,
    onOpenSettings,
    toyUser = null,
    toyLoginRequired = false,
    toyLoginLoading = false,
    onToyLogin,
  }: {
    tab: AppTab;
    onSelectTab: (tab: AppTab) => void;
    onOpenSettings: () => void;
    /** Logged-in user (environment adapter data, e.g. bilibili Toy). */
    toyUser?: ToyUser | null;
    toyLoginRequired?: boolean;
    toyLoginLoading?: boolean;
    onToyLogin?: () => void;
  } = $props();
</script>

<header class="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
  <div class="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
    <a href="{base}/" class="flex items-center gap-2.5">
      <img
        src="{base}/icons/icon-192.png"
        alt={m.app_title()}
        class="size-7 rounded-lg object-cover shadow-md shadow-violet-500/20"
      />
      <div class="flex items-center gap-1 text-lg font-bold tracking-tight">
        <span class="hidden sm:inline">{m.app_title().split(' ').slice(0, -1).join(' ')}</span>
        <span
          class="hidden bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent sm:inline"
        >
          {m.app_title().split(' ').slice(-1).join(' ')}
        </span>
      </div>
    </a>
    <nav class="ms-4 hidden items-center gap-1 sm:flex">
      <Button
        variant={tab === 'discover' ? 'secondary' : 'ghost'}
        size="sm"
        onclick={() => onSelectTab('discover')}
      >
        <CompassIcon class="size-4" />
        {m.discover()}
      </Button>
      <Button
        variant={tab === 'library' ? 'secondary' : 'ghost'}
        size="sm"
        onclick={() => onSelectTab('library')}
      >
        <LibraryIcon class="size-4" />
        {m.library()}
      </Button>
    </nav>
    <div class="ms-auto flex items-center gap-1">
      {#if onToyLogin}
        <ToyUserBadge
          user={toyUser}
          loginRequired={toyLoginRequired}
          loginLoading={toyLoginLoading}
          onLogin={onToyLogin}
        />
      {/if}
      <LanguageSwitcher />
      <Button variant="ghost" size="icon" aria-label={m.settings()} onclick={onOpenSettings}>
        <SettingsIcon class="size-4" />
      </Button>
    </div>
  </div>
</header>
