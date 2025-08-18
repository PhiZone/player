<script lang="ts">
  import { setFullscreen, alertError, IS_TAURI } from '$lib/utils';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import '../app.css';
    import { invoke } from '@tauri-apps/api/core';

  setFullscreen();
  addEventListener('error', (e) => alertError(e.error, e.message));
  addEventListener('unhandledrejection', (e) => alertError(e.reason));

  const debugFunc = console.debug;
  console.debug = (...args) => {
    if (IS_TAURI) {
      invoke('console_log', {
        message: String(args.join(' ')),
        severity: 'debug'
      });
    }
    debugFunc(...args);
  };

  const logFunc = console.log;
  console.log = (...args) => {
    if (IS_TAURI) {
      invoke('console_log', {
        message: String(args.join(' ')),
        severity: 'info'
      });
    }
    logFunc(...args);
  };

  const warnFunc = console.warn;
  console.warn = (...args) => {
    if (IS_TAURI) {
      invoke('console_log', {
        message: String(args.join(' ')),
        severity: 'warn'
      });
    }
    warnFunc(...args);
  };

  const errorFunc = console.error;
  console.error = (...args) => {
    if (IS_TAURI) {
      invoke('console_log', {
        message: String(args.join(' ')),
        severity: 'error'
      });
    }
    errorFunc(...args);
  };
</script>

<slot />
