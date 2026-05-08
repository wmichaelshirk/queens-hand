<script lang="ts">
  import { onMount } from "svelte";
  import { handleCallback } from "$lib/convex";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();

  onMount(() => {
    // Exchange OAuth/magic-link code if present in the URL
    handleCallback();
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
