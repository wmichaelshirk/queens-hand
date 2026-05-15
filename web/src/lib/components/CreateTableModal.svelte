<script lang="ts">
  import { convex, watchQuery, guestSession } from "$lib/convex";

  interface GameOption {
    type: "select";
    key: string;
    label: string;
    default: string;
    choices: { value: string; label: string }[];
  }

  interface GameEntry {
    type: string;
    name: string;
    icon: string;
    options: GameOption[];
  }

  interface Props {
    onClose: () => void;
    onCreated: (gameId: string) => void;
  }

  let { onClose, onCreated }: Props = $props();

  const catalog = watchQuery<GameEntry[]>("games:getGameCatalog" as any, {});

  let selectedType = $state<string | null>(null);
  let localSettings = $state<Record<string, string>>({});
  let busy = $state(false);

  // Set default selection and settings once catalog loads
  $effect(() => {
    const entries = $catalog;
    if (!entries || entries.length === 0) return;
    if (selectedType === null) {
      selectedType = entries[0].type;
      localSettings = buildDefaults(entries[0]);
    }
  });

  function buildDefaults(entry: GameEntry): Record<string, string> {
    const out: Record<string, string> = {};
    for (const opt of entry.options) out[opt.key] = opt.default;
    return out;
  }

  function selectGame(entry: GameEntry) {
    selectedType = entry.type;
    localSettings = buildDefaults(entry);
  }

  const selectedEntry = $derived($catalog?.find((e) => e.type === selectedType) ?? null);

  async function submit() {
    if (busy || !selectedType) return;
    busy = true;
    try {
      const gameId = await convex.mutation("games:createTable" as any, {
        gameType: selectedType,
        settings: localSettings,
        guestUserId: $guestSession?.userId,
      });
      onCreated(gameId as string);
    } finally {
      busy = false;
    }
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onBackdropClick}>
  <div class="modal-card">
    <div class="modal-header">
      <h2 class="modal-title">Create New Table</h2>
      <button class="close-btn" onclick={onClose} aria-label="Close">×</button>
    </div>

    {#if !$catalog}
      <div class="loading">Loading…</div>
    {:else}
      <div class="section-label">Game</div>
      <div class="game-picker">
        {#each $catalog as entry (entry.type)}
          <button
            class="pick-btn"
            class:selected={selectedType === entry.type}
            onclick={() => selectGame(entry)}
          >
            <span class="pick-icon">{entry.icon}</span>
            {entry.name}
          </button>
        {/each}
      </div>

      {#if selectedEntry && selectedEntry.options.length > 0}
        <div class="options-panel">
          <div class="section-label">Options</div>
          {#each selectedEntry.options as opt (opt.key)}
            <div class="option-row">
              <label class="option-label" for="opt-{opt.key}">{opt.label}</label>
              {#if opt.type === "select"}
                <select
                  id="opt-{opt.key}"
                  class="select-input"
                  value={localSettings[opt.key] ?? opt.default}
                  onchange={(e) => {
                    localSettings = { ...localSettings, [opt.key]: (e.target as HTMLSelectElement).value };
                  }}
                >
                  {#each opt.choices as choice (choice.value)}
                    <option value={choice.value}>{choice.label}</option>
                  {/each}
                </select>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="modal-footer">
      <button
        class="btn accent-sm"
        onclick={submit}
        disabled={busy || !selectedType}
      >
        {busy ? "Creating…" : "Create Table"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal-card {
    background: #12213a;
    border: 1px solid #1a4a80;
    border-radius: 10px;
    padding: 1.5rem;
    width: 360px;
    max-width: calc(100vw - 2rem);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-size: 1rem;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.2rem;
  }

  .close-btn:hover { color: #ccc; }

  .section-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .game-picker {
    display: flex;
    gap: 0.5rem;
  }

  .pick-btn {
    flex: 1;
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #888;
    font-size: 0.82rem;
    padding: 0.5rem 0.4rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }

  .pick-btn:hover { background: #1a4a80; color: #ccc; }
  .pick-btn.selected { border-color: #e94560; color: #e0e0e0; background: #1a2a40; }

  .pick-icon { font-size: 1rem; }

  .options-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .option-label {
    font-size: 0.85rem;
    color: #aaa;
  }

  .select-input {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 5px;
    color: #e0e0e0;
    font-size: 0.85rem;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    outline: none;
  }

  .select-input:focus { border-color: #e94560; }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.25rem;
  }

  .btn {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .btn:hover    { background: #1a4a80; }
  .btn:disabled { opacity: 0.45; cursor: default; }

  .btn.accent-sm {
    background: #e94560;
    border-color: #e94560;
    color: #fff;
    padding: 0.4rem 1rem;
    font-size: 0.85rem;
  }

  .btn.accent-sm:hover    { background: #c73652; }
  .btn.accent-sm:disabled { opacity: 0.45; cursor: default; }

  .loading {
    color: #555;
    font-size: 0.85rem;
    font-style: italic;
    padding: 0.5rem 0;
  }
</style>
