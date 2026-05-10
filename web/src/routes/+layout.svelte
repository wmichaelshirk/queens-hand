<script lang="ts">
  import { onMount } from "svelte";
  import { replaceState } from "$app/navigation";
  import { handleCallback, authResolving } from "$lib/convex";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();

  onMount(async () => {
    const hadCode = new URLSearchParams(window.location.search).has("code");
    if (hadCode) authResolving.set(true);
    let err: string | null = null;
    try {
      err = await handleCallback();
    } finally {
      authResolving.set(false);
    }
    if (hadCode) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("code");
      replaceState(clean.toString(), {});
    }
    if (err) sessionStorage.setItem("auth_error", err);
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Queen's Hand</title>
</svelte:head>

{@render children()}

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: system-ui, sans-serif;
    background: #00512C;
    color: #e0e0e0;
    min-height: 100vh;
  }
</style>
