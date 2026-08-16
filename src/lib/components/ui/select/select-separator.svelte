<script lang="ts">
  import { Separator } from '$lib/components/ui/separator/index.js';
  import { cn } from '$lib/cn.js';
  import type { Separator as SeparatorPrimitive } from 'bits-ui';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SeparatorPrimitive.RootProps = $props();
</script>

<Separator
  bind:ref
  data-slot="select-separator"
  class={cn('-mx-1.5 my-1.5 h-px bg-border pointer-events-none', className)}
  {...restProps}
/>
