<script lang="ts">
  import Player, { type GameReference } from '$lib/player/Player.svelte';
  import { getParams } from '$lib/utils';

  let gameRef: GameReference = { game: null, scene: null };
  let config = getParams();
</script>

<div data-theme="night" class="w-screen h-screen overflow-hidden flex flex-col justify-center items-center">
  <Player bind:gameRef {config} />
</div>
