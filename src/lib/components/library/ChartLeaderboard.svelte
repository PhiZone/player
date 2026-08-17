<script lang="ts">
  import { Card } from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$lib/paraglide/messages';
  import { padToyScore } from '$lib/services/toy';
  import TrophyIcon from '@lucide/svelte/icons/trophy';
  import CrownIcon from '@lucide/svelte/icons/crown';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';

  /** API-agnostic leaderboard row; the data source is provided by the parent. */
  export interface LeaderboardEntry {
    rank: number;
    nickname: string;
    avatar: string;
    score: number;
  }

  export interface LeaderboardMyRank {
    ranked: boolean;
    rank: number;
    score: number;
  }

  let {
    entries = [],
    myRank = null,
    loading = false,
    error = false,
    onRetry,
  }: {
    entries?: LeaderboardEntry[];
    myRank?: LeaderboardMyRank | null;
    loading?: boolean;
    error?: boolean;
    onRetry?: () => void;
  } = $props();

  const MEDALS = ['🥇', '🥈', '🥉'];

  const isMe = (entry: LeaderboardEntry) => myRank?.ranked === true && myRank.rank === entry.rank;
</script>

<Card
  class="overflow-hidden rounded-xl border-violet-500/30 bg-gradient-to-b from-violet-500/10 via-background/60 to-background"
>
  <!-- Header -->
  <div
    class="flex items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 px-4 py-2.5"
  >
    <div class="flex items-center gap-2">
      <TrophyIcon class="size-4 text-amber-400" />
      <h3 class="text-sm font-bold uppercase tracking-wider">{m.leaderboard()}</h3>
    </div>
    <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
      {m.score()}
    </span>
  </div>

  {#if loading}
    <div class="space-y-2 p-3">
      {#each Array(5) as _}
        <div class="flex items-center gap-3">
          <Skeleton class="size-6 rounded-full" />
          <Skeleton class="size-8 rounded-full" />
          <Skeleton class="h-3.5 flex-1" />
          <Skeleton class="h-3.5 w-16" />
        </div>
      {/each}
    </div>
  {:else if error}
    <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p class="text-xs text-muted-foreground">{m.leaderboard_error()}</p>
      {#if onRetry}
        <Button variant="outline" size="sm" onclick={onRetry}>
          <RotateCwIcon class="size-3.5" />
          {m.retry()}
        </Button>
      {/if}
    </div>
  {:else if entries.length === 0}
    <div class="px-4 py-6 text-center">
      <p class="text-xs text-muted-foreground">{m.leaderboard_empty()}</p>
    </div>
  {:else}
    <div class="divide-y divide-border/40">
      {#each entries as entry (entry.rank)}
        <div
          class="flex items-center gap-2.5 px-3 py-2 transition-colors {isMe(entry)
            ? 'bg-primary/10'
            : ''}"
        >
          <div class="w-7 shrink-0 text-center">
            {#if entry.rank <= 3}
              <span class="text-base leading-none">{MEDALS[entry.rank - 1]}</span>
            {:else}
              <span class="text-xs font-semibold tabular-nums text-muted-foreground">
                {entry.rank}
              </span>
            {/if}
          </div>
          {#if entry.avatar}
            <img
              src={entry.avatar}
              alt=""
              referrerpolicy="no-referrer"
              loading="lazy"
              class="size-7 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
          {:else}
            <div class="size-7 shrink-0 rounded-full bg-muted"></div>
          {/if}
          <span class="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm">
            {entry.nickname}
          </span>
          <span
            class="font-mono text-xs font-bold tabular-nums tracking-widest text-violet-300 sm:text-sm"
          >
            {padToyScore(entry.score)}
          </span>
        </div>
      {/each}
    </div>
    <div
      class="flex items-center justify-between gap-2 border-t border-border/40 bg-background/50 px-4 py-2"
    >
      {#if myRank?.ranked}
        <span class="flex items-center gap-1.5 text-xs font-medium">
          <CrownIcon class="size-3.5 text-amber-400" />
          {m.my_rank({ rank: myRank.rank })}
        </span>
        <span class="font-mono text-xs font-bold tabular-nums tracking-widest">
          {padToyScore(myRank.score)}
        </span>
      {:else}
        <span class="text-xs text-muted-foreground">{m.unranked()}</span>
      {/if}
    </div>
  {/if}
</Card>
