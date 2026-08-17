<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$lib/paraglide/messages';
  import type { ToyUserProfile } from '$lib/services/toy';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

  let {
    user,
    loginRequired = false,
    loginLoading = false,
    onLogin,
  }: {
    user: ToyUserProfile | null;
    loginRequired?: boolean;
    loginLoading?: boolean;
    onLogin: () => void;
  } = $props();
</script>

{#if user}
  <div
    class="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 py-0.5 pe-3 ps-0.5"
    title={user.nickname}
  >
    {#if user.avatar}
      <img
        src={user.avatar}
        alt=""
        referrerpolicy="no-referrer"
        class="size-7 shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    {:else}
      <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <UserRoundIcon class="size-4" />
      </div>
    {/if}
    <span class="hidden max-w-28 truncate text-xs font-medium sm:inline">{user.nickname}</span>
  </div>
{:else if loginRequired}
  <Button variant="outline" size="sm" class="gap-1.5" onclick={onLogin} disabled={loginLoading}>
    {#if loginLoading}
      <LoaderCircleIcon class="size-3.5 animate-spin" />
    {:else}
      <UserRoundIcon class="size-3.5" />
    {/if}
    <span class="hidden sm:inline">{m.toy_login()}</span>
    <span class="sm:hidden">{m.toy_login_short()}</span>
  </Button>
{/if}
