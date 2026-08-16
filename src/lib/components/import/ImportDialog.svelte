<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$lib/paraglide/messages';
  import FileUpIcon from '@lucide/svelte/icons/file-up';
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
  import ClipboardIcon from '@lucide/svelte/icons/clipboard';

  let {
    open = $bindable(false),
    onFiles,
    onDirectory,
    onPasteUrl,
    showDirectory = false,
  }: {
    open?: boolean;
    onFiles: (files: File[]) => void;
    onDirectory: (files: FileList) => void;
    onPasteUrl: () => void;
    showDirectory?: boolean;
  } = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let dirInput: HTMLInputElement | undefined = $state();

  const ACCEPT =
    '.pez,.pec,.yml,.yaml,.shader,.glsl,.frag,.fsh,.fs,.ttf,.otf,.fnt,application/zip,application/json,image/*,video/*,audio/*,text/*';
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{m.import_title()}</Dialog.Title>
      <Dialog.Description>{m.import_description()}</Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-2">
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        class="hidden"
        onchange={(e) => {
          const files = e.currentTarget.files;
          if (files && files.length > 0) {
            onFiles(Array.from(files));
            open = false;
          }
          e.currentTarget.value = '';
        }}
      />
      {#if showDirectory}
        <input
          bind:this={dirInput}
          type="file"
          multiple
          webkitdirectory
          class="hidden"
          onchange={(e) => {
            const files = e.currentTarget.files;
            if (files && files.length > 0) {
              onDirectory(files);
              open = false;
            }
            e.currentTarget.value = '';
          }}
        />
      {/if}
      <Button variant="outline" class="h-12 justify-start gap-3" onclick={() => fileInput?.click()}>
        <FileUpIcon class="size-4" />
        {m.import_files()}
      </Button>
      {#if showDirectory}
        <Button
          variant="outline"
          class="h-12 justify-start gap-3"
          onclick={() => dirInput?.click()}
        >
          <FolderOpenIcon class="size-4" />
          {m.import_directory()}
        </Button>
      {/if}
      <Button
        variant="outline"
        class="h-12 justify-start gap-3"
        onclick={() => {
          onPasteUrl();
          open = false;
        }}
      >
        <ClipboardIcon class="size-4" />
        {m.import_from_clipboard()}
      </Button>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>
        {m.cancel()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
