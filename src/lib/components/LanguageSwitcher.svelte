<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Button } from '$lib/components/ui/button';
  import LanguagesIcon from '@lucide/svelte/icons/languages';
  import CheckIcon from '@lucide/svelte/icons/check';

  let open = $state(false);
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    <Button variant="ghost" size="icon" aria-label={m.language()}>
      <LanguagesIcon class="size-4" />
    </Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {#each locales as locale (locale)}
      <DropdownMenu.Item
        onSelect={(e) => {
          setLocale(locale);
          open = false;
          e.preventDefault();
        }}
      >
        <span class="flex w-full items-center justify-between gap-6">
          <span>{m.name(undefined, { locale })}</span>
          {#if getLocale() === locale}
            <CheckIcon class="size-4 text-primary" />
          {/if}
        </span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
