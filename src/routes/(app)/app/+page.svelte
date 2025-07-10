<script lang="ts">
  import { REPO_LINK, VERSION as FV } from '$lib';
  import Distribution from '$lib/components/Distribution.svelte';
  import { IS_ANDROID_OR_IOS, IS_TAURI } from '$lib/utils';
  import { Capacitor } from '@capacitor/core';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';

  export let data;

  let modal: HTMLDialogElement;

  const VERSION = data.latestRelease?.tag_name.slice(1) ?? FV;

  const distributions = [
    {
      title: 'Windows',
      subtitle: m['distributions.architecture']({ arch: 'x64' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_x64-setup.exe`,
      color: 'blue-500',
      fa: 'windows',
    },
    {
      title: 'macOS',
      subtitle: m['distributions.avail_for']({ arch: 'Apple silicon' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_aarch64.dmg`,
      color: 'lime-500',
      fa: 'apple',
    },
    {
      title: 'Linux',
      subtitle: m['distributions.architecture']({ arch: 'x64' }),
      description: m['distributions.desktop_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_amd64.AppImage`,
      color: 'amber-500',
      fa: 'linux',
    },
    {
      title: 'Android',
      subtitle: m['distributions.architecture']({ arch: 'ARM64' }),
      description: m['distributions.mobile_desc'](),
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}.apk`,
      color: 'emerald-500',
      fa: 'android',
    },
    {
      title: 'iOS & iPadOS',
      subtitle: m['distributions.avail_via']({ method: 'TestFlight' }),
      description: m['distributions.mobile_desc'](),
      href: 'https://testflight.apple.com/join/6Uba7RmH',
      color: 'violet-500',
      fa: 'app-store',
    },
    {
      title: m['distributions.other'](),
      subtitle: m['distributions.avail_on']({ platform: 'GitHub' }),
      description: m['distributions.other_desc'](),
      href: `${REPO_LINK}/releases`,
      color: 'slate-500',
      fa: 'github',
    },
  ];

  onMount(() => {
    if (
      !IS_TAURI &&
      Capacitor.getPlatform() === 'web' &&
      (page.url.searchParams.has('file') || page.url.searchParams.has('zip'))
    ) {
      modal.showModal();
    }
  });
</script>

<svelte:head>
  <title>{m.app_download()} | {m.app_title()}</title>
</svelte:head>

<dialog id="app" class="modal" bind:this={modal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.redirecting()}</h3>
    <p class="pt-4 pb-3">
      {m.redirecting_description()}
    </p>
    <div class="modal-action justify-between">
      <form method="dialog" class="gap-3 w-full flex justify-center">
        <button
          class="w-full inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
          on:click={() => {
            window.open(
              `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${page.url.search}`,
            );
          }}
        >
          {m.open_in_app()}
        </button>
      </form>
    </div>
  </div>
</dialog>

<div class="max-w-2xl text-center mx-auto">
  <a
    class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200 hover:underline"
    href="{base}/"
  >
    {m.app_title().split(' ').slice(0, -1).join(' ')}
    <span class="bg-clip-text bg-gradient-to-tl from-blue-500 to-violet-600 text-transparent">
      {m.app_title().split(' ').slice(-1).join(' ')}
    </span>
  </a>
</div>

<div class="max-w-3xl text-center mx-auto">
  <p class="text-xs sm:text-sm md:text-base lg:text-lg text-gray-600 dark:text-neutral-400">
    {m.app_download_subtitle()}
  </p>
</div>

<div class="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 max-w-6xl mx-auto">
  {#each distributions as data}
    <Distribution {data} />
  {/each}
</div>
