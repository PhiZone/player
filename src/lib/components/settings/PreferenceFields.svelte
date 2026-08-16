<script lang="ts">
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { m } from '$lib/paraglide/messages';
  import type { Preferences } from '$lib/types';

  let { preferences }: { preferences: Preferences } = $props();

  const minJudgment = 5;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  const calculateRksFactor = (perfectJudgment: number, goodJudgment: number) => {
    let x = 0.8 * perfectJudgment + 0.225 * goodJudgment;
    if (x > 150) return 0;
    if (x > 100) return (x * x) / 7500 - (4 * x) / 75 + 5;
    x -= 100;
    return -((x * x * x) / 4e6) + 1;
  };

  // ── Mirrors (write-through) ──────────────────────────────────────────
  // Sliders bind to these $state mirrors; effects push values back into
  // `preferences`, which is read by the player at play time.
  let perfectVals = $state<number[]>([]);
  let goodVals = $state<number[]>([]);
  let noteSizeVals = $state<number[]>([]);
  let lineThicknessVals = $state<number[]>([]);
  let timeScaleVals = $state<number[]>([]);
  let backgroundBlurVals = $state<number[]>([]);
  let backgroundLuminanceVals = $state<number[]>([]);
  let chartOffsetVals = $state<number[]>([]);
  let hitSoundVolumeVals = $state<number[]>([]);
  let musicVolumeVals = $state<number[]>([]);
  let mirroringStr = $state<string | undefined>(undefined);
  let ar1 = $state(0);
  let ar2 = $state(0);
  let ar1Str = $state<string | undefined>(undefined);
  let ar2Str = $state<string | undefined>(undefined);

  let synced = false;
  $effect(() => {
    if (synced) return;
    synced = true;
    perfectVals = [preferences.perfectJudgment];
    goodVals = [preferences.goodJudgment];
    noteSizeVals = [preferences.noteSize];
    lineThicknessVals = [preferences.lineThickness];
    timeScaleVals = [preferences.timeScale];
    backgroundBlurVals = [preferences.backgroundBlur];
    backgroundLuminanceVals = [preferences.backgroundLuminance * 100];
    chartOffsetVals = [preferences.chartOffset];
    hitSoundVolumeVals = [preferences.hitSoundVolume * 100];
    musicVolumeVals = [preferences.musicVolume * 100];
    mirroringStr = String(preferences.chartFlipping);
    ar1 = preferences.aspectRatio?.[0] ?? 0;
    ar2 = preferences.aspectRatio?.[1] ?? 0;
    ar1Str = String(ar1);
    ar2Str = String(ar2);
  });

  $effect(() => {
    const p = Math.round(perfectVals[0]);
    preferences.perfectJudgment = p;
    const minGood = Math.max(p + minJudgment, p * 1.125);
    if (preferences.goodJudgment < minGood) {
      preferences.goodJudgment = Math.round(minGood);
      goodVals = [preferences.goodJudgment];
    }
  });
  $effect(() => {
    preferences.goodJudgment = Math.round(goodVals[0]);
  });
  $effect(() => {
    preferences.noteSize = noteSizeVals[0];
  });
  $effect(() => {
    preferences.lineThickness = lineThicknessVals[0];
  });
  $effect(() => {
    preferences.timeScale = timeScaleVals[0];
  });
  $effect(() => {
    preferences.backgroundBlur = backgroundBlurVals[0];
  });
  $effect(() => {
    preferences.backgroundLuminance = backgroundLuminanceVals[0] / 100;
  });
  $effect(() => {
    preferences.chartOffset = chartOffsetVals[0];
  });
  $effect(() => {
    preferences.hitSoundVolume = hitSoundVolumeVals[0] / 100;
  });
  $effect(() => {
    preferences.musicVolume = musicVolumeVals[0] / 100;
  });

  $effect(() => {
    if (mirroringStr === undefined) return;
    const v = Number(mirroringStr);
    if (v !== preferences.chartFlipping) preferences.chartFlipping = v;
  });

  $effect(() => {
    if (ar1Str === undefined) return;
    const v = Number(ar1Str);
    if (v !== ar1) ar1 = v;
  });
  $effect(() => {
    if (ar2Str === undefined) return;
    const v = Number(ar2Str);
    if (v !== ar2) ar2 = v;
  });
  $effect(() => {
    preferences.aspectRatio = ar1 > 0 && ar2 > 0 ? [ar1, ar2] : null;
  });
  const ar2Options = $derived(
    ar1 > 0
      ? Array.from({ length: ar1 }, (_, index) => index + 1).filter((n) => gcd(n, ar1) === 1)
      : [0],
  );

  // ── Displays (mirror-driven) ─────────────────────────────────────────
  const perfectDisplay = $derived(Math.round(perfectVals[0] ?? preferences.perfectJudgment));
  const goodDisplay = $derived(Math.round(goodVals[0] ?? preferences.goodJudgment));
  const badJudgment = $derived((goodVals[0] ?? preferences.goodJudgment) * 1.125);
  const rksFactor = $derived(
    calculateRksFactor(
      perfectVals[0] ?? preferences.perfectJudgment,
      goodVals[0] ?? preferences.goodJudgment,
    ),
  );
  const goodMin = $derived(
    Math.round(Math.max(perfectDisplay + minJudgment, perfectDisplay * 1.125)),
  );
  const judgmentScale = 350;
  const perfectWidth = $derived((perfectDisplay / judgmentScale) * 100);
  const goodWidth = $derived(((goodDisplay - perfectDisplay) / judgmentScale) * 100);
  const badWidth = $derived(((badJudgment - goodDisplay) / judgmentScale) * 100);
  const noteSizeDisplay = $derived((noteSizeVals[0] ?? preferences.noteSize).toFixed(2));
  const lineThicknessDisplay = $derived(
    (lineThicknessVals[0] ?? preferences.lineThickness).toFixed(2),
  );
  const timeScaleDisplay = $derived((timeScaleVals[0] ?? preferences.timeScale).toFixed(2));
  const backgroundBlurDisplay = $derived(
    (backgroundBlurVals[0] ?? preferences.backgroundBlur).toFixed(1),
  );
  const backgroundLuminanceDisplay = $derived(
    Math.round(backgroundLuminanceVals[0] ?? preferences.backgroundLuminance * 100),
  );
  const chartOffsetDisplay = $derived(chartOffsetVals[0] ?? preferences.chartOffset);
  const hitSoundVolumeDisplay = $derived(
    Math.round(hitSoundVolumeVals[0] ?? preferences.hitSoundVolume * 100),
  );
  const musicVolumeDisplay = $derived(
    Math.round(musicVolumeVals[0] ?? preferences.musicVolume * 100),
  );

  const mirroringName = (i: number) => {
    switch (i) {
      case 0:
        return m['chart_mirroring_modes.0']();
      case 1:
        return m['chart_mirroring_modes.1']();
      case 2:
        return m['chart_mirroring_modes.2']();
      default:
        return m['chart_mirroring_modes.3']();
    }
  };
</script>

<div class="flex flex-col gap-5">
  <!-- Judgment windows -->
  <div class="space-y-3">
    <div class="flex h-2.5 overflow-hidden rounded-full border bg-muted/40" aria-hidden="true">
      <div class="bg-emerald-500/70" style="width: {perfectWidth}%"></div>
      <div class="bg-amber-500/70" style="width: {goodWidth}%"></div>
      <div class="bg-rose-500/70" style="width: {badWidth}%"></div>
      <div class="flex-1 bg-muted-foreground/20"></div>
    </div>
    <div class="flex items-center gap-2 sm:gap-3">
      <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
        {m.perfect()} ({m.milliseconds()})
      </span>
      <Slider
        type="multiple"
        class="flex-1"
        min={minJudgment}
        max={150}
        step={1}
        bind:value={perfectVals}
        aria-label={`${m.perfect()} (${m.milliseconds()})`}
      />
      <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
        {perfectDisplay}
      </span>
    </div>
    <div class="flex items-center gap-2 sm:gap-3">
      <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
        {m.good()} ({m.milliseconds()})
      </span>
      <Slider
        type="multiple"
        class="flex-1"
        min={goodMin}
        max={300}
        step={1}
        bind:value={goodVals}
        aria-label={`${m.good()} (${m.milliseconds()})`}
      />
      <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
        {goodDisplay}
      </span>
    </div>
    <div class="flex items-center gap-3 text-sm text-muted-foreground">
      <span class="w-28 min-w-28 shrink-0 sm:w-40">{m.bad()} ({m.milliseconds()})</span>
      <span class="tabular-nums">{Math.round(badJudgment)}</span>
      <span class="ms-auto w-28 min-w-28 text-end sm:w-40">{m.rks_factor()}</span>
      <span class="w-10 shrink-0 text-end tabular-nums">{rksFactor.toFixed(4)}</span>
    </div>
  </div>

  <!-- Switches -->
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
      <span class="text-sm font-medium">{m.simultaneous_note_hint()}</span>
      <Switch bind:checked={preferences.simultaneousNoteHint} />
    </label>
    <label class="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
      <span class="text-sm font-medium">{m.fc_ap_indicator()}</span>
      <Switch bind:checked={preferences.fcApIndicator} />
    </label>
  </div>

  <!-- Numeric sliders -->
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">{m.note_size()}</span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0.4}
      max={2}
      step={0.01}
      bind:value={noteSizeVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {noteSizeDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">{m.line_thickness()}</span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0.4}
      max={2}
      step={0.01}
      bind:value={lineThicknessVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {lineThicknessDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">{m.time_scale()}</span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0.1}
      max={3}
      step={0.01}
      bind:value={timeScaleVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {timeScaleDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">{m.background_blur()}</span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0}
      max={2}
      step={0.1}
      bind:value={backgroundBlurVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {backgroundBlurDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
      {m.background_luminance()} ({m.percentage()})
    </span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0}
      max={100}
      step={1}
      bind:value={backgroundLuminanceVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {backgroundLuminanceDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
      {m.chart_offset()} ({m.milliseconds()})
    </span>
    <Slider
      type="multiple"
      class="flex-1"
      min={-600}
      max={600}
      step={1}
      bind:value={chartOffsetVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {chartOffsetDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
      {m.hit_sound_volume()} ({m.percentage()})
    </span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0}
      max={100}
      step={1}
      bind:value={hitSoundVolumeVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {hitSoundVolumeDisplay}
    </span>
  </div>
  <div class="flex items-center gap-2 sm:gap-3">
    <span class="w-28 min-w-28 shrink-0 text-sm leading-tight sm:w-40">
      {m.music_volume()} ({m.percentage()})
    </span>
    <Slider
      type="multiple"
      class="flex-1"
      min={0}
      max={100}
      step={1}
      bind:value={musicVolumeVals}
    />
    <span class="w-9 shrink-0 text-end text-sm tabular-nums text-muted-foreground sm:w-10">
      {musicVolumeDisplay}
    </span>
  </div>

  <!-- Selects -->
  <div class="space-y-1">
    <Label>{m.chart_mirroring()}</Label>
    <Select.Root type="single" bind:value={mirroringStr}>
      <Select.Trigger class="w-full">
        <span>{mirroringName(Number(mirroringStr))}</span>
      </Select.Trigger>
      <Select.Content>
        {#each Array(4) as _, i}
          <Select.Item value={String(i)}>{mirroringName(i)}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
  <div class="space-y-1">
    <Label>{m.aspect_ratio()}</Label>
    <div class="flex items-center gap-2">
      <Select.Root type="single" bind:value={ar1Str}>
        <Select.Trigger class="flex-1">
          <span>{Number(ar1Str) === 0 ? m.auto() : Number(ar1Str)}</span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="0">{m.auto()}</Select.Item>
          {#each [1, 3, 4, 5, 7, 8, 16, 21, 256] as value}
            <Select.Item value={String(value)}>{value}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <span class="text-muted-foreground">:</span>
      <Select.Root type="single" bind:value={ar2Str}>
        <Select.Trigger class="flex-1">
          <span>{Number(ar2Str) === 0 ? m.auto() : Number(ar2Str)}</span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="0">{m.auto()}</Select.Item>
          {#each ar2Options as value}
            <Select.Item value={String(value)}>{value}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
</div>
