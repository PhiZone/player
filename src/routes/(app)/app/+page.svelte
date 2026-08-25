<script lang="ts">
  import { REPO_LINK, VERSION as FV } from '$lib';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { Card } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import WindowsIcon from '@lucide/svelte/icons/monitor';
  import AppleIcon from '@lucide/svelte/icons/apple';
  import LinuxIcon from '@lucide/svelte/icons/terminal';
  import AndroidIcon from '@lucide/svelte/icons/smartphone';
  import TabletIcon from '@lucide/svelte/icons/tablet';
  import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { Capacitor } from '@capacitor/core';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { IS_ANDROID_OR_IOS, IS_TAURI_LIKE } from '$lib/utils';
  import { riseIn, staggerDelay } from '$lib/motion';

  export let data;

  let modalOpen = false;

  const VERSION = data?.latestRelease?.tag_name.slice(1) ?? FV;

  const distributions = [
    {
      title: 'Windows',
      subtitle: m['distributions.architecture']({ arch: 'x64' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_x64-setup.exe`,
      icon: WindowsIcon,
      accent: 'text-sky-400',
    },
    {
      title: 'macOS',
      subtitle: m['distributions.avail_for']({ arch: 'Apple silicon' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_aarch64.dmg`,
      icon: AppleIcon,
      accent: 'text-neutral-300',
    },
    {
      title: 'Linux',
      subtitle: m['distributions.architecture']({ arch: 'x64' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_amd64.AppImage`,
      icon: LinuxIcon,
      accent: 'text-amber-400',
    },
    {
      title: 'Android',
      subtitle: m['distributions.architecture']({ arch: 'ARM64' }),
      description: m['distributions.mobile_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}.apk`,
      icon: AndroidIcon,
      accent: 'text-emerald-400',
    },
    {
      title: 'iOS & iPadOS',
      subtitle: m['distributions.avail_via']({ method: 'TestFlight' }),
      description: m['distributions.mobile_desc'](),
      href: 'https://testflight.apple.com/join/6Uba7RmH',
      icon: TabletIcon,
      accent: 'text-violet-400',
    },
    {
      title: m['distributions.other'](),
      subtitle: m['distributions.avail_on']({ platform: 'GitHub' }),
      description: m['distributions.other_desc'](),
      href: `${REPO_LINK}/releases`,
      icon: CodeXmlIcon,
      accent: 'text-muted-foreground',
    },
  ];

  onMount(() => {
    if (
      !IS_TAURI_LIKE &&
      Capacitor.getPlatform() === 'web' &&
      (page.url.searchParams.has('file') || page.url.searchParams.has('zip'))
    ) {
      modalOpen = true;
    }
  });
</script>

<svelte:head>
  <title>{m.app_download()} | {m.app_title()}</title>
</svelte:head>

<Dialog.Root bind:open={modalOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{m.redirecting()}</Dialog.Title>
      <Dialog.Description>{m.redirecting_description()}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button
        class="w-full"
        onclick={() => {
          window.open(
            `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${page.url.search}`,
          );
        }}
      >
        {m.open_in_app()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<div class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-16 pt-10 sm:px-6 lg:px-8">
  <header class="flex items-center justify-between">
    <a href="{base}/" class="flex items-center gap-2.5 text-lg font-bold tracking-tight">
      <img
        src="{base}/icons/icon-192.png"
        alt={m.app_title()}
        class="size-7 rounded-lg object-cover shadow-md shadow-violet-500/20"
      />
      <span>{m.app_title().split(' ').slice(0, -1).join(' ')}</span>
      <span class="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
        {m.app_title().split(' ').slice(-1).join(' ')}
      </span>
    </a>
    <Button variant="outline" size="sm" href="{base}/">
      {m.library()}
    </Button>
  </header>

  <main class="flex flex-1 flex-col items-center justify-center gap-8 py-12 text-center">
    <div class="space-y-3" in:riseIn={{ y: 16, duration: 340 }}>
      <Badge variant="outline" class="border-violet-500/40 text-violet-400">
        v{VERSION}
      </Badge>
      <h1 class="text-3xl font-bold sm:text-4xl">{m.app_download()}</h1>
      <p class="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
        {m.app_download_subtitle()}
      </p>
    </div>

    <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each distributions as data, i}
        <div class="h-full" in:riseIn={{ y: 16, delay: staggerDelay(i, 60) }}>
          <Card
            size="sm"
            class="group h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
          >
            <a
              href={data.href}
              target="_blank"
              rel="noreferrer"
              class="flex h-full flex-col gap-3 p-5"
            >
              <div class="flex items-start justify-between gap-3">
                <data.icon class="size-8 {data.accent}" />
                <DownloadIcon
                  class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
              <div class="space-y-1 text-start">
                <h2 class="text-lg font-bold">{data.title}</h2>
                <p class="text-xs font-medium text-muted-foreground">{data.subtitle}</p>
                <p class="text-sm text-muted-foreground">{data.description}</p>
              </div>
            </a>
          </Card>
        </div>
      {/each}
    </div>

    <Separator class="max-w-md" />

    <p class="text-xs text-muted-foreground">
      {m.about_version({ version: VERSION, commit: __COMMIT_HASH__ })}
    </p>
  </main>
</div>
