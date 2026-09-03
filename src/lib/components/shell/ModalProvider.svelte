<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$lib/paraglide/messages';

  /**
   * Sandbox-safe replacements for `window.alert` / `window.confirm` /
   * `window.prompt`. Bilibili Toy hosts the page in a sandboxed iframe
   * without the `allow-modals` keyword, so the native dialogs are silently
   * ignored ("Ignored call to 'confirm()'"). This provider renders its own
   * modal UI and globally overrides the three functions, so every call site
   * (including bare `alert(...)` / `confirm(...)` in browser code) works.
   *
   * Mount once in the root layout. The overrides are installed on mount and
   * restored on destroy.
   */

  type AlertOptions = { title?: string; okText?: string };
  type ConfirmOptions = { title?: string; okText?: string; cancelText?: string };
  type PromptOptions = { title?: string; okText?: string; cancelText?: string; placeholder?: string };

  let open = $state(false);
  let kind = $state<'alert' | 'confirm' | 'prompt'>('alert');
  let title = $state('');
  let message = $state('');
  let okText = $state('');
  let cancelText = $state('');
  let placeholder = $state('');
  let inputValue = $state('');
  let resolveFn: ((value: boolean | string | null) => void) | null = null;

  const show = (
    k: 'alert' | 'confirm' | 'prompt',
    msg: string,
    opts: AlertOptions | ConfirmOptions | PromptOptions = {},
  ) =>
    new Promise<boolean | string | null>((resolve) => {
      kind = k;
      message = msg;
      title = (opts as AlertOptions).title ?? '';
      okText = (opts as AlertOptions).okText ?? (k === 'alert' ? m.ok() : m.confirm());
      cancelText = (opts as ConfirmOptions).cancelText ?? m.cancel();
      placeholder = (opts as PromptOptions).placeholder ?? '';
      inputValue = '';
      resolveFn = resolve;
      open = true;
    });

  const close = (value: boolean | string | null) => {
    open = false;
    resolveFn?.(value);
    resolveFn = null;
  };

  const onOk = () => {
    if (kind === 'prompt') close(inputValue);
    else close(true);
  };
  const onCancel = () => close(kind === 'prompt' ? null : false);

  const install = () => {
    // The native functions are synchronous (boolean/string), but our
    // replacements return Promises — call sites that `await` them work fine,
    // and call sites that don't still get the modal shown. Cast through
    // `unknown` to satisfy the DOM typings.
    window.alert = ((msg?: unknown) =>
      show('alert', String(msg ?? ''))) as unknown as typeof window.alert;
    window.confirm = ((msg?: unknown) =>
      show('confirm', String(msg ?? ''))) as unknown as typeof window.confirm;
    window.prompt = ((msg?: unknown, defaultText?: string) =>
      show('prompt', String(msg ?? ''), {
        placeholder: defaultText ?? '',
      })) as unknown as typeof window.prompt;
  };

  const restore = () => {
    // @ts-expect-error - restoring the native functions
    delete window.alert;
    // @ts-expect-error - restoring the native functions
    delete window.confirm;
    // @ts-expect-error - restoring the native functions
    delete window.prompt;
  };

  $effect(() => {
    install();
    return restore;
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-sm" showCloseButton={false}>
    {#if title}
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
      </Dialog.Header>
    {/if}
    <div class="text-sm text-muted-foreground">{message}</div>
    {#if kind === 'prompt'}
      <Input
        bind:value={inputValue}
        {placeholder}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOk();
          }
        }}
      />
    {/if}
    <Dialog.Footer class="flex gap-2">
      {#if kind !== 'alert'}
        <Button variant="outline" onclick={onCancel}>{cancelText}</Button>
      {/if}
      <Button onclick={onOk}>{okText}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>