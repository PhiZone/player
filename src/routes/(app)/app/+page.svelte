<script>
  import { REPO_LINK } from '$lib';
  import Distribution from '$lib/components/Distribution.svelte';

  const distributions = [
    {
      title: 'Windows',
      subtitle: 'Architecture: x64',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: '#',
      color: 'blue-500',
      fa: 'windows',
    },
    {
      title: 'macOS',
      subtitle: 'Available for Apple silicon',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: '#',
      color: 'lime-500',
      fa: 'apple',
    },
    {
      title: 'Linux',
      subtitle: 'Architecture: x64',
      description:
        'Desktop distribution via Tauri. Provides exclusive features (e.g. streaming mode).',
      href: '#',
      color: 'amber-500',
      fa: 'linux',
    },
    {
      title: 'Android',
      subtitle: 'Architecture: ARM64',
      description:
        'Mobile distribution via Capacitor. Incompatibilities and performance issues expected.',
      href: '#',
      color: 'emerald-500',
      fa: 'android',
    },
    {
      title: 'iOS and iPadOS',
      subtitle: 'Available via TestFlight',
      description:
        'Mobile distribution via Capacitor. Incompatibilities and performance issues expected.',
      href: '#',
      color: 'violet-500',
      fa: 'app-store',
    },
    {
      title: 'Other distributions',
      subtitle: 'Available on GitHub',
      description:
        'ARM64 distributions for Linux and Windows, x64 for Intel Macs, debug builds, etc.',
      href: '#',
      color: 'slate-500',
      fa: 'github',
    },
  ];
</script>

<svelte:head>
  <title>App Download | PhiZone Player</title>
</svelte:head>

<div class="max-w-2xl text-center mx-auto">
  <a
    class="block font-bold text-gray-800 text-4xl md:text-5xl lg:text-6xl dark:text-neutral-200 hover:underline"
    href="/"
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
