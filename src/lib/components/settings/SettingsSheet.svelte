<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Badge } from '$lib/components/ui/badge';
  import * as Select from '$lib/components/ui/select';
  import { m } from '$lib/paraglide/messages';
  import { base } from '$app/paths';
  import type { MediaOptions, Preferences, FFmpegEncoder } from '$lib/types';
  import PreferenceFields from './PreferenceFields.svelte';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import InfoIcon from '@lucide/svelte/icons/info';

  let {
    open = $bindable(false),
    preferences,
    mediaOptions,
    overrideResolution = $bindable(false),
    mediaResolutionWidth = $bindable(1620),
    mediaResolutionHeight = $bindable(1080),
    renderOn = false,
    ffmpegEncoders,
    isRenderingAvailable,
    isTauriLike,
    onBrowseExportPath,
    onRenderToggle,
    version,
    commit,
  }: {
    open?: boolean;
    preferences: Preferences;
    mediaOptions: MediaOptions;
    overrideResolution?: boolean;
    mediaResolutionWidth?: number;
    mediaResolutionHeight?: number;
    renderOn?: boolean;
    ffmpegEncoders: FFmpegEncoder[] | undefined;
    isRenderingAvailable: boolean;
    isTauriLike: boolean;
    onBrowseExportPath: () => void;
    onRenderToggle: (checked: boolean) => void;
    version: string;
    commit: string;
  } = $props();

  // Render toggle: reported to the parent, which may reject the change
  // (e.g. rendering unavailable) and keep `renderOn` unchanged.
  let renderOnLocal = $state(false);
  $effect(() => {
    renderOnLocal = renderOn;
  });
  $effect(() => {
    if (renderOnLocal !== renderOn) onRenderToggle(renderOnLocal);
  });

  let vsyncStr = $state<string | undefined>(undefined);
  let codecStr = $state<string | undefined>(undefined);
  $effect(() => {
    vsyncStr = String(mediaOptions.vsync);
    codecStr = mediaOptions.videoCodec;
  });
  $effect(() => {
    if (vsyncStr === undefined) return;
    const v = vsyncStr === 'true';
    if (v !== mediaOptions.vsync) mediaOptions.vsync = v;
  });
  $effect(() => {
    if (codecStr === undefined) return;
    if (codecStr !== mediaOptions.videoCodec) mediaOptions.videoCodec = codecStr;
  });

  const encoders = $derived(
    ffmpegEncoders?.filter(
      (e) => e.codec !== null && ['h264', 'hevc', 'av1', 'mpeg4'].includes(e.codec),
    ) ?? [],
  );
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
    <Sheet.Header class="border-b px-4 py-4 sm:px-6">
      <Sheet.Title class="flex items-center gap-2">
        <InfoIcon class="size-4 text-muted-foreground" />
        {m.settings()}
      </Sheet.Title>
    </Sheet.Header>
    <div class="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
      <section class="space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {m.preferences()}
        </h2>
        <PreferenceFields {preferences} />
      </section>

      {#if isTauriLike}
        <Separator />

        <section class="space-y-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {m.rendering()}
          </h2>
          <div class="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">{m.render()}</p>
              <p class="text-xs text-muted-foreground">{m.render_description()}</p>
            </div>
            <Switch bind:checked={renderOnLocal} disabled={!isRenderingAvailable} />
          </div>
          <div
            class="grid grid-cols-1 gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2 {renderOn
              ? ''
              : 'pointer-events-none opacity-40'}"
          >
            <div class="space-y-1">
              <Label for="set-frame-rate">{m.frame_rate()}</Label>
              <div class="flex items-center gap-1.5">
                <Input id="set-frame-rate" type="number" bind:value={mediaOptions.frameRate} />
                <span class="shrink-0 text-xs text-muted-foreground">{m.fps()}</span>
              </div>
            </div>
            <div class="space-y-1">
              <Label>{m.video_encoder()}</Label>
              <Select.Root type="single" bind:value={codecStr}>
                <Select.Trigger class="w-full">
                  <span class="truncate">
                    {encoders.find((e) => e.name === codecStr)?.displayName ?? codecStr}
                  </span>
                </Select.Trigger>
                <Select.Content>
                  {#each encoders as encoder (encoder.name)}
                    <Select.Item value={encoder.name}>{encoder.displayName}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="space-y-1 sm:col-span-2">
              <div class="flex items-center justify-between">
                <Label>{m.override_resolution()}</Label>
                <Switch size="sm" bind:checked={overrideResolution} />
              </div>
              <div class="flex items-center gap-2">
                <Input
                  type="number"
                  min="2"
                  step="2"
                  disabled={!overrideResolution}
                  bind:value={mediaResolutionWidth}
                />
                <span class="text-muted-foreground">×</span>
                <Input
                  type="number"
                  min="2"
                  step="2"
                  disabled={!overrideResolution}
                  bind:value={mediaResolutionHeight}
                />
              </div>
            </div>
            <div class="space-y-1">
              <Label for="set-video-bitrate">{m.video_bitrate()}</Label>
              <div class="flex items-center gap-1.5">
                <Input
                  id="set-video-bitrate"
                  type="number"
                  bind:value={mediaOptions.videoBitrate}
                />
                <span class="shrink-0 text-xs text-muted-foreground">{m.kbps()}</span>
              </div>
            </div>
            <div class="space-y-1">
              <Label for="set-audio-bitrate">{m.audio_bitrate()}</Label>
              <div class="flex items-center gap-1.5">
                <Input
                  id="set-audio-bitrate"
                  type="number"
                  bind:value={mediaOptions.audioBitrate}
                />
                <span class="shrink-0 text-xs text-muted-foreground">{m.kbps()}</span>
              </div>
            </div>
            <div class="space-y-1">
              <Label>{m.vsync()}</Label>
              <Select.Root type="single" bind:value={vsyncStr}>
                <Select.Trigger class="w-full">
                  <span>{vsyncStr === 'true' ? m.on() : m.off()}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="true">{m.on()}</Select.Item>
                  <Select.Item value="false">{m.off()}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div class="space-y-1">
              <Label for="set-results-loops">{m.results_loops()}</Label>
              <Input
                id="set-results-loops"
                type="number"
                min={0}
                step={0.1}
                bind:value={mediaOptions.resultsLoopsToRender}
              />
            </div>
            <div class="space-y-1 sm:col-span-2">
              <Label for="set-export-path">{m.export_path()}</Label>
              <div class="flex items-center gap-1.5">
                <Input id="set-export-path" bind:value={mediaOptions.exportPath} />
                <Button variant="outline" size="sm" class="shrink-0" onclick={onBrowseExportPath}>
                  {m.browse()}
                </Button>
              </div>
            </div>
          </div>
        </section>
      {/if}

      <Separator />

      <section class="space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {m.about()}
        </h2>
        <p class="text-sm text-muted-foreground">{m.about_description()}</p>
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="text-muted-foreground">
            {m.about_version({ version, commit })}
          </Badge>
        </div>
        <div class="flex flex-col gap-2">
          <Button variant="outline" class="justify-start gap-2" href={`${base}/app`}>
            <DownloadIcon class="size-4" />
            {m.download_app()}
          </Button>
        </div>
      </section>
    </div>
  </Sheet.Content>
</Sheet.Root>
