<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  const TYPE_NAMES = ['EZ', 'HD', 'IN', 'AT', 'SP'];
  const TYPE_STYLES: Record<number, string> = {
    0: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
    1: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
    2: 'border-rose-500/40 bg-rose-500/15 text-rose-400',
    3: 'border-violet-500/40 bg-violet-500/15 text-violet-400',
    4: 'border-sky-500/40 bg-sky-500/15 text-sky-400',
  };

  let { levelType = 2, level = '' }: { levelType?: number | null; level?: string | null } =
    $props();

  const typeName = $derived(TYPE_NAMES[levelType ?? 2] ?? 'IN');
  const label = $derived(
    level ? (level.startsWith(typeName) ? level : `${typeName} ${level}`) : typeName,
  );
</script>

<Badge
  variant="outline"
  class="shrink-0 border font-semibold tabular-nums {TYPE_STYLES[levelType ?? 2] ?? TYPE_STYLES[2]}"
>
  {label}
</Badge>
