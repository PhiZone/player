<script>
  import { REPO_LINK, VERSION } from '$lib';
</script>

<div
  class="relative overflow-hidden before:absolute before:top-0 before:start-1/2 before:bg-[url('/landing/polygon-bg-element.svg')] dark:before:bg-[url('/landing/polygon-bg-element-dark.svg')] before:bg-no-repeat before:bg-top before:bg-cover before:size-full before:-z-[1] before:transform before:-translate-x-1/2"
>
  <div
    class="max-w-[85rem] min-h-screen mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-10 flex flex-col gap-5"
  >
    <slot />
    <div class="flex justify-center items-center gap-x-1 sm:gap-x-3">
      <span class="text-sm text-gray-600 dark:text-neutral-400">Version</span>
      <span class="text-sm font-bold text-gray-900 dark:text-white">
        {VERSION}
      </span>
      <svg
        class="size-5 text-gray-300 dark:text-neutral-600"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M6 13L10 3" stroke="currentColor" stroke-linecap="round" />
      </svg>
      <a
        class="inline-flex items-center gap-x-1 text-sm text-blue-500 decoration-2 hover:underline focus:outline-none focus:underline font-medium dark:text-blue-500"
        href="{REPO_LINK}/issues/new/choose"
        target="_blank"
      >
        File an issue
        <i class="fa-solid fa-angle-right fa-sm"></i>
      </a>
    </div>
  </div>
</div>

<div class="hover:border-blue-500 hover:text-blue-500" hidden></div>
<div class="hover:border-lime-500 hover:text-lime-500" hidden></div>
<div class="hover:border-amber-500 hover:text-amber-500" hidden></div>
<div class="hover:border-emerald-500 hover:text-emerald-500" hidden></div>
<div class="hover:border-violet-500 hover:text-violet-500" hidden></div>
<div class="hover:border-slate-500 hover:text-slate-500" hidden></div>

<div class="focus:border-blue-500 focus:text-blue-500" hidden></div>
<div class="focus:border-lime-500 focus:text-lime-500" hidden></div>
<div class="focus:border-amber-500 focus:text-amber-500" hidden></div>
<div class="focus:border-emerald-500 focus:text-emerald-500" hidden></div>
<div class="focus:border-violet-500 focus:text-violet-500" hidden></div>
<div class="focus:border-slate-500 focus:text-slate-500" hidden></div>
