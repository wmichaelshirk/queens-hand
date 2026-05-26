<script lang="ts">
  let { text }: { text: string | null } = $props();
</script>

{#if text}
  {#key text}
    <div class="bubble">
      {text}
      <div class="tail"></div>
    </div>
  {/key}
{/if}

<style>
  .bubble {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #ffffff;
    border: 1.5px solid #000000;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #333333;
    white-space: nowrap;
    z-index: 50;
    pointer-events: none;
    animation: bubble-pop 5s ease forwards;
  }

  .tail {
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 8px;
    height: 8px;
    background: #ffffff;
    border-right: 1.5px solid #000000;
    border-bottom: 1.5px solid #000000;
  }

  @keyframes bubble-pop {
    0%   { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    10%  { opacity: 1; transform: translateX(-50%) translateY(0); }
    80%  { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  }
</style>
