<script>
  import { setFullscreen, alertError } from '../player/utils';
  import '../app.css';

  setFullscreen();
  addEventListener('error', (e) => alertError(e.error, e.message));
  addEventListener('unhandledrejection', (e) => alertError(e.reason));
</script>

<slot />
