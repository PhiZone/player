<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { m } from '$lib/paraglide/messages';

  let {
    value,
    onchange,
    class: className,
  }: {
    value: number;
    onchange: (value: number) => void;
    class?: string;
  } = $props();

  let str = $state<string | undefined>(undefined);
  let synced = false;
  $effect(() => {
    if (synced) return;
    synced = true;
    str = String(value);
  });
  $effect(() => {
    if (str === undefined) return;
    const v = Number(str);
    if (v !== value) onchange(v);
  });

  const typeName = (i: number) => {
    switch (i) {
      case 0:
        return m['asset.types.0']();
      case 1:
        return m['asset.types.1']();
      case 2:
        return m['asset.types.2']();
      case 3:
        return m['asset.types.3']();
      case 4:
        return m['asset.types.4']();
      case 5:
        return m['asset.types.5']();
      default:
        return m['asset.types.6']();
    }
  };
</script>

<Select.Root type="single" bind:value={str}>
  <Select.Trigger class={className}>
    <span>{typeName(value)}</span>
  </Select.Trigger>
  <Select.Content>
    {#each Array(7) as _, i}
      <Select.Item value={String(i)}>{typeName(i)}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
