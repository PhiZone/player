<script lang="ts">
  import type { Preferences } from '$lib/types';

  interface $$Props {
    preferences: Preferences;
    class: string;
  }

  export let preferences: Preferences;

  const minJudgment = 5;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  const calculateRksFactor = (perfectJudgment: number, goodJudgment: number) => {
    var x = 0.8 * perfectJudgment + 0.225 * goodJudgment;

    if (x > 150) {
      return 0;
    } else if (x > 100) {
      return (x * x) / 7500 - (4 * x) / 75 + 5;
    } else {
      x -= 100;
      return -((x * x * x) / 4e6) + 1;
    }
  };

  let aspectRatio1 = preferences.aspectRatio ? preferences.aspectRatio[0] : 0;
  let aspectRatio2 = preferences.aspectRatio ? preferences.aspectRatio[1] : 0;
  $: badJudgment = preferences.goodJudgment * 1.125;

  let modal: HTMLDialogElement;
  $: rksFactor = calculateRksFactor(preferences.perfectJudgment, preferences.goodJudgment);
</script>

<button
  class="py-3 px-4 inline-flex justify-center items-center gap-x-2 text-center text-sm font-medium rounded-lg transition border border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500 focus:outline-none focus:border-blue-500 focus:text-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-blue-500 dark:hover:border-blue-500 dark:focus:text-blue-500 dark:focus:border-blue-500 {$$restProps.class}"
  on:click={() => {
    aspectRatio1 = preferences.aspectRatio ? preferences.aspectRatio[0] : 0;
    aspectRatio2 = preferences.aspectRatio ? preferences.aspectRatio[1] : 0;
    modal.showModal();
  }}
>
  Edit preferences
</button>
<dialog id="preferences" class="modal" bind:this={modal}>
  <div class="modal-box overflow-x-hidden">
    <form method="dialog">
      <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
    </form>
    <h3 class="text-lg font-bold">Preferences</h3>
    <div class="w-full form-control gap-4">
      <div class="flex w-full pt-6">
        <div
          class="tooltip rounded-lg {preferences.perfectJudgment < 45
            ? 'tooltip-right'
            : ''} tooltip-warning leading-[0px] h-[7.5px]"
          data-tip="Perfect ({preferences.perfectJudgment}ms)"
          style:width="{preferences.perfectJudgment / 3.5}%"
        >
          <progress value="1" max="1" class="progress progress-warning"></progress>
        </div>
        <div
          class="tooltip rounded-lg {preferences.goodJudgment < 40
            ? 'tooltip-right'
            : ''} tooltip-info leading-[0px] h-[7.5px]"
          data-tip="Good ({preferences.goodJudgment}ms)"
          style:width="{(preferences.goodJudgment - preferences.perfectJudgment) / 3.5}%"
        >
          <progress value="1" max="1" class="progress progress-info"></progress>
        </div>
        <div
          class="tooltip rounded-lg {preferences.goodJudgment < 25
            ? 'tooltip-right'
            : ''} tooltip-error leading-[0px] h-[7.5px]"
          data-tip="Bad ({badJudgment}ms)"
          style:width="{(badJudgment - preferences.goodJudgment) / 3.5}%"
        >
          <progress value="1" max="1" class="progress progress-error"></progress>
        </div>
        <div
          class="tooltip rounded-lg {preferences.goodJudgment > 225
            ? 'tooltip-left'
            : ''} leading-[0px] h-[7.5px]"
          data-tip="Miss / Incoming"
          style:width="{100 - badJudgment / 3.5}%"
        >
          <progress value="0" max="1" class="progress"></progress>
        </div>
      </div>
      <div class="form-control">
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Perfect (ms)</span>
          <input
            type="range"
            id="perfect_judgment"
            name="perfectJudgment"
            min={minJudgment}
            max="150"
            bind:value={preferences.perfectJudgment}
            class="range range-sm join-item w-7/12"
            on:input={(e) => {
              const perfectJudgment = parseInt(e.currentTarget.value);
              if (
                preferences.goodJudgment <
                Math.max(perfectJudgment + minJudgment, perfectJudgment * 1.125)
              ) {
                preferences.goodJudgment = Math.round(
                  Math.max(perfectJudgment + minJudgment, perfectJudgment * 1.125),
                );
              }
            }}
          />
          <input
            type="text"
            value={preferences.perfectJudgment}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.perfectJudgment}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < minJudgment) {
                e.currentTarget.value = `${minJudgment}`;
              } else if (parseInt(e.currentTarget.value) > 150) {
                e.currentTarget.value = '150';
              }
              preferences.perfectJudgment = parseInt(e.currentTarget.value);
              if (
                preferences.goodJudgment <
                Math.max(
                  preferences.perfectJudgment + minJudgment,
                  preferences.perfectJudgment * 1.125,
                )
              ) {
                preferences.goodJudgment = Math.round(
                  Math.max(
                    preferences.perfectJudgment + minJudgment,
                    preferences.perfectJudgment * 1.125,
                  ),
                );
              }
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Good (ms)</span>
          <input
            type="range"
            id="good_judgment"
            name="goodJudgment"
            min={Math.round(
              Math.max(
                preferences.perfectJudgment + minJudgment,
                preferences.perfectJudgment * 1.125,
              ),
            )}
            max="300"
            bind:value={preferences.goodJudgment}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.goodJudgment}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${Math.round(preferences.goodJudgment)}`;
                return;
              }
              if (
                parseInt(e.currentTarget.value) <
                Math.max(
                  preferences.perfectJudgment + minJudgment,
                  preferences.perfectJudgment * 1.125,
                )
              ) {
                e.currentTarget.value = `${Math.round(
                  Math.max(
                    preferences.perfectJudgment + minJudgment,
                    preferences.perfectJudgment * 1.125,
                  ),
                )}`;
              } else if (parseInt(e.currentTarget.value) > 300) {
                e.currentTarget.value = '300';
              }
              preferences.goodJudgment = parseInt(e.currentTarget.value);
            }}
          />
        </div>
        <div class="flex items-center gap-2 h-[45px]">
          <span class="w-1/4 text-sm dark:text-neutral-300">Bad (ms)</span>
          <span class="w-1/4 dark:text-white">{badJudgment}</span>
          <span class="w-1/4 text-sm dark:text-neutral-300">RKS factor</span>
          <span class="w-1/4 dark:text-white">{rksFactor.toFixed(4)}</span>
        </div>
        <div class="flex items-center gap-2 h-[45px]">
          <span class="w-1/4 text-sm dark:text-neutral-300">Simultaneous note hint</span>
          <div class="w-1/4">
            <input
              type="checkbox"
              id="simultaneous_note_hint"
              name="simultaneousNoteHint"
              bind:checked={preferences.simultaneousNoteHint}
              class="form-checkbox w-6 h-6 shrink-0 rounded-lg mt-0.5 transition border-gray-200 text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
            />
          </div>
          <span class="w-1/4 text-sm dark:text-neutral-300">FC/AP indicator</span>
          <div class="w-1/4">
            <input
              type="checkbox"
              id="fc_ap_indicator"
              name="fcApIndicator"
              bind:checked={preferences.fcApIndicator}
              class="form-checkbox w-6 h-6 shrink-0 rounded-lg mt-0.5 transition border-gray-200 text-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-base-100 dark:border-neutral-700 dark:checked:bg-blue-500 dark:checked:border-blue-500 dark:focus:ring-offset-gray-800"
            />
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Note size</span>
          <input
            type="range"
            id="note_size"
            name="noteSize"
            min="0.4"
            max="2"
            step="0.01"
            bind:value={preferences.noteSize}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.noteSize}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?([0-9]*[.])?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.noteSize}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.noteSize = parseFloat(e.currentTarget.value);
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Line thickness</span>
          <input
            type="range"
            id="line_thickness"
            name="lineThickness"
            min="0.4"
            max="2"
            step="0.01"
            bind:value={preferences.lineThickness}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.lineThickness}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?([0-9]*[.])?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.lineThickness}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.lineThickness = parseFloat(e.currentTarget.value);
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Background luminance (%)</span>
          <input
            type="range"
            id="background_luminance"
            name="backgroundLuminance"
            min="0"
            max="100"
            value={preferences.backgroundLuminance * 100}
            class="range range-sm join-item w-7/12"
            on:input={(e) => {
              const backgroundLuminance = parseInt(e.currentTarget.value);
              preferences.backgroundLuminance = backgroundLuminance / 100;
            }}
          />
          <input
            type="text"
            value={preferences.backgroundLuminance}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.backgroundLuminance}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.backgroundLuminance = parseInt(e.currentTarget.value) / 100;
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Background blur</span>
          <input
            type="range"
            id="background_blur"
            name="backgroundBlur"
            min="0"
            max="2"
            step="0.1"
            bind:value={preferences.backgroundBlur}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.backgroundBlur}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?([0-9]*[.])?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.backgroundBlur}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.backgroundBlur = parseFloat(e.currentTarget.value);
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Chart offset (ms)</span>
          <input
            type="range"
            id="chart_offset"
            name="chartOffset"
            min="-600"
            max="600"
            bind:value={preferences.chartOffset}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.chartOffset}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.chartOffset}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.chartOffset = parseInt(e.currentTarget.value);
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Hit sound volume (%)</span>
          <input
            type="range"
            id="Hit sound volume"
            name="hitSoundVolume"
            min="0"
            max="100"
            value={preferences.hitSoundVolume * 100}
            class="range range-sm join-item w-7/12"
            on:input={(e) => {
              const hitSoundVolume = parseInt(e.currentTarget.value);
              preferences.hitSoundVolume = hitSoundVolume / 100;
            }}
          />
          <input
            type="text"
            value={preferences.hitSoundVolume}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.hitSoundVolume}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.hitSoundVolume = parseInt(e.currentTarget.value) / 100;
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Music volume (%)</span>
          <input
            type="range"
            id="music_volume"
            name="musicVolume"
            min="0"
            max="100"
            value={preferences.musicVolume * 100}
            class="range range-sm join-item w-7/12"
            on:input={(e) => {
              const musicVolume = parseInt(e.currentTarget.value);
              preferences.musicVolume = musicVolume / 100;
            }}
          />
          <input
            type="text"
            value={preferences.musicVolume}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.musicVolume}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.musicVolume = parseInt(e.currentTarget.value) / 100;
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1/4 text-sm dark:text-neutral-300">Time scale</span>
          <input
            type="range"
            id="time_scale"
            name="timeScale"
            min="0.1"
            max="3"
            step="0.01"
            bind:value={preferences.timeScale}
            class="range range-sm join-item w-7/12"
          />
          <input
            type="text"
            value={preferences.timeScale}
            class="form-input border-transparent shadow-sm rounded-lg focus:z-10 transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:text-neutral-300 dark:placeholder-neutral-500 dark:focus:ring-neutral-600 w-1/6 text-right"
            on:focusout={(e) => {
              if (!/^[+-]?([0-9]*[.])?[0-9]+$/.test(e.currentTarget.value)) {
                e.currentTarget.value = `${preferences.timeScale}`;
                return;
              }
              if (parseInt(e.currentTarget.value) < 0) {
                e.currentTarget.value = '0';
              } else if (parseInt(e.currentTarget.value) > 100) {
                e.currentTarget.value = '100';
              }
              preferences.timeScale = parseFloat(e.currentTarget.value);
            }}
          />
        </div>
      </div>
      <label class="join w-full">
        <span
          class="btn no-animation join-item w-1/4 min-w-[64px] font-normal text-sm dark:text-neutral-300"
        >
          Chart flipping
        </span>
        <select
          id="chart_flipping"
          name="chartFlipping"
          bind:value={preferences.chartFlipping}
          class="form-select border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600 join-item w-3/4"
        >
          {#each ['Off', 'Horizontal', 'Vertical', 'Horizontal and Vertical'] as text, value}
            <option {value}>
              {text}
            </option>
          {/each}
        </select>
      </label>
      <label class="join w-full">
        <span
          class="btn no-animation join-item w-1/4 min-w-[64px] font-normal text-sm dark:text-neutral-300"
        >
          Aspect ratio
        </span>
        <select
          id="aspect_ratio_1"
          name="aspectRatio1"
          value={aspectRatio1}
          class="form-select border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600 join-item w-[37.5%]"
          on:input={(e) => {
            aspectRatio1 = parseInt(e.currentTarget.value);
            preferences.aspectRatio =
              aspectRatio1 > 0 && aspectRatio2 > 0 ? [aspectRatio1, aspectRatio2] : null;
          }}
        >
          <option value={0}>Auto</option>
          {#each Array.from({ length: 30 }, (_, index) => index + 1) as value}
            <option {value}>{value}</option>
          {/each}
        </select>
        <span
          class="py-3 px-2 inline-flex items-center min-w-fit border border-gray-200 text-sm text-gray-500 -ms-px w-auto first:rounded-s-lg mt-0 first:ms-0 first:rounded-se-none last:rounded-es-none last:rounded-e-lg bg-base-100 dark:border-neutral-700 dark:text-neutral-400"
        >
          :
        </span>
        <select
          id="aspect_ratio_2"
          name="aspectRatio2"
          value={aspectRatio2}
          class="form-select border-gray-200 rounded-lg transition hover:border-blue-500 hover:ring-blue-500 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none bg-base-100 dark:border-neutral-700 dark:text-neutral-300 dark:focus:ring-neutral-600 join-item w-[37.5%]"
          on:input={(e) => {
            aspectRatio2 = parseInt(e.currentTarget.value);
            preferences.aspectRatio =
              aspectRatio1 > 0 && aspectRatio2 > 0 ? [aspectRatio1, aspectRatio2] : null;
          }}
        >
          {#if aspectRatio1 > 0}
            {#each Array.from({ length: aspectRatio1 }, (_, index) => index + 1).filter((number) => gcd(number, aspectRatio1) === 1) as value}
              <option {value}>{value}</option>
            {/each}
          {:else}
            <option value={0}>Auto</option>
          {/if}
        </select>
      </label>
    </div>
  </div>
</dialog>
