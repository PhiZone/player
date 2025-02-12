<script lang="ts">
  import { REPO_LINK } from '$lib';
  import Distribution from '$lib/components/Distribution.svelte';
  import { IS_ANDROID_OR_IOS, IS_TAURI } from '$lib/utils';
  import { Capacitor } from '@capacitor/core';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';

  export let data;

  let modal: HTMLDialogElement;

  const VERSION = data.latestRelease.tag_name.slice(1);

  const distributions = [
    {
      title: 'Windows',
      subtitle: 'Architecture: x64',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_x64-setup.exe`,
      color: 'blue-500',
      fa: 'windows',
    },
    {
      title: 'macOS',
      subtitle: 'Available for Apple silicon',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_aarch64.dmg`,
      color: 'lime-500',
      fa: 'apple',
    },
    {
      title: 'Linux',
      subtitle: 'Architecture: x64',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}_amd64.AppImage`,
      color: 'amber-500',
      fa: 'linux',
    },
    {
      title: 'Android',
      subtitle: 'Architecture: ARM64',
      description:
        'Mobile distribution via Capacitor. Incompatibilities and performance issues expected.',
      href: `${REPO_LINK}/releases/download/v${VERSION}/PhiZone.Player_${VERSION}.apk`,
      color: 'emerald-500',
      fa: 'android',
    },
    {
      title: 'iOS and iPadOS',
      subtitle: 'Available via TestFlight',
      description:
        'Mobile distribution via Capacitor. Incompatibilities and performance issues expected.',
      href: 'https://testflight.apple.com/join/6Uba7RmH',
      color: 'violet-500',
      fa: 'app-store',
    },
    {
      title: 'Other distributions',
      subtitle: 'Available on GitHub',
      description:
        'ARM64 distributions for Linux and Windows, x64 for Intel Macs, IPA, debug builds, etc.',
      href: `${REPO_LINK}/releases`,
      color: 'slate-500',
      fa: 'github',
    },
  ];

  onMount(() => {
    if (
      !IS_TAURI &&
      Capacitor.getPlatform() === 'web' &&
      ($page.url.searchParams.has('file') || $page.url.searchParams.has('zip'))
    ) {
      modal.showModal();
    }
  });
</script>

<svelte:head>
  <title>App Download | PhiZone Player</title>
</svelte:head>

<dialog id="app" class="modal" bind:this={modal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">Redirecting</h3>
    <p class="pt-4 pb-3">
      If you're not being redirected to the app, please click the button below. If it still doesn't
      work, please check if you have the app installed or properly configured in your device
      settings.
    </p>
    <div class="modal-action justify-between">
      <form method="dialog" class="gap-3 w-full flex justify-center">
        <button
          class="w-full inline-flex justify-center items-center gap-x-3 text-center bg-gradient-to-tl from-blue-500 via-violet-500 to-fuchsia-500 dark:from-blue-700 dark:via-violet-700 dark:to-fuchsia-700 text-white text-sm font-medium rounded-md focus:outline-none py-3 px-4 transition-all duration-300 bg-size-200 bg-pos-0 hover:bg-pos-100"
          on:click={() => {
            window.open(
              `${IS_ANDROID_OR_IOS ? `${base}/app` : 'phizone-player://'}${$page.url.search}`,
            );
          }}
        >
          Open in the app
        </button>
      </form>
    </div>
  </div>
</dialog>

<div class="max-w-2xl text-center mx-auto">
  <a
    class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200 hover:underline"
    href={base}
  >
    PhiZone
    <span class="bg-clip-text bg-gradient-to-tl from-blue-500 to-violet-600 text-transparent">
      Player
    </span>
  </a>
</div>

<div class="max-w-3xl text-center mx-auto">
  <p class="text-xs sm:text-sm md:text-base lg:text-lg text-gray-600 dark:text-neutral-400">
    Ready as an app, comes with more unique features.
  </p>
</div>

<div class="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 max-w-6xl mx-auto">
  {#each distributions as data}
    <Distribution {data} />
  {/each}
</div>
