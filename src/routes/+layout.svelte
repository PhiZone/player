<script lang="ts">
  import { setFullscreen, alertError, IS_TAURI_LIKE } from '$lib/utils';
  import { tauriInvoke } from '$lib/services/tauriIpc';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import '../app.css';

  setFullscreen();
  addEventListener('error', (e) => alertError(e.error, e.message));
  addEventListener('unhandledrejection', (e) => alertError(e.reason));

  const logFunc = console.log;
  console.log = (...args) => {
    if (IS_TAURI_LIKE) {
      tauriInvoke('console_log', {
        message: String(args.join(' ')),
        severity: 'info',
      });
    }
    logFunc(...args);
  };

  const warnFunc = console.warn;
  console.warn = (...args) => {
    if (IS_TAURI_LIKE) {
      tauriInvoke('console_log', {
        message: String(args.join(' ')),
        severity: 'warn',
      });
    }
    warnFunc(...args);
  };

  const errorFunc = console.error;
  console.error = (...args) => {
    if (IS_TAURI_LIKE) {
      tauriInvoke('console_log', {
        message: String(args.join(' ')),
        severity: 'error',
      });
    }
    errorFunc(...args);
  };
</script>

<slot />
