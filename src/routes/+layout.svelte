<script lang="ts">
  import '../app.css';
  import { setFullscreen, alertError } from '../player/utils';

  setFullscreen();
  addEventListener('error', (e) => alertError(e.error, e.message));
  addEventListener('unhandledrejection', (e) => alertError(e.reason));
</script>

<slot />
