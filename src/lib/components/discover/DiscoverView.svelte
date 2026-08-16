<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import SearchIcon from '@lucide/svelte/icons/search';
</script>

<section class="flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center">
  <div
    class="flex size-20 items-center justify-center rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20"
  >
    <SparklesIcon class="size-9 text-violet-400" />
  </div>
  <div class="max-w-md space-y-2">
    <h1 class="text-2xl font-bold">{m.discover_placeholder_title()}</h1>
    <p class="text-sm text-muted-foreground">{m.discover_placeholder_description()}</p>
  </div>
  <Badge variant="outline" class="border-violet-500/40 text-violet-400">
    {m.discover_coming_soon()}
  </Badge>
  <div class="relative w-full max-w-sm" aria-hidden="true">
    <SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input class="ps-9 opacity-60" placeholder={m.search_charts()} disabled />
  </div>
</section>
