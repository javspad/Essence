# S7 Validation Checklist

Use the local app at `http://localhost:5173` with both the client and server running.

## Event Builder

- [ ] Open `/event-builder`, select **Peaje del mas rico**, and verify its consequence is a 4-coin transfer from **Most coins** to the triggering player.
- [ ] Select **Vaquita express** and verify its redistribution consequence collects the configured amount from the other players for the triggering player.
- [ ] Verify consequence Type offers immediate changes and named `Effect: ...` entries, with no **Timing**, **Resolve now**, or **Attach to user** controls.
- [ ] Change a consequence Type to a named Effect and verify the Effect summary shows its description and duration. Change it back before saving.
- [ ] Add a ranking payout to a scored Activity, target winner/rank selectors, and verify the Triggered/Results preview shows the configured coin changes.
- [ ] With no authored ranking payout, verify the Activity still previews the legacy `coinPayout` values.

## Effect Builder

- [ ] Open an Effect from Event Builder and verify **Duration** is edited on the Effect, while each lifecycle consequence owns its **Runs** hook and optional condition.
- [ ] Create a test Effect with a coin consequence, set **Runs** to **Turn end**, set Duration to **3 rounds**, and verify the coin amount is editable in the Effect consequence.
- [ ] Apply that Effect from an Event consequence and verify the Event only stores the Effect reference, not an inline hook or duration.
- [ ] In a two-player game, attach the test Effect to one player and verify it fires only on that player's turn end, once per eligible lifecycle, until it expires.

## Artifact Builder And Shop

- [ ] Open `/artifact-builder`, select **Mochila de Gaston**, and verify it has one **Apply effect** consequence targeting the chosen player.
- [ ] Verify Artifact Builder has one Consequences list, with no separate reusable-effects list and no inline Timing controls.
- [ ] Use an artifact with an immediate coin consequence and verify the result is shown in the artifact-use event.
- [ ] Buy an artifact or cosmetic in a game and verify insufficient funds cause no balance or ownership change; a successful purchase deducts coins and grants the item together.

## Compatibility And Persistence

- [ ] Import legacy Event JSON containing `actions`/`outcomes`; export it again and verify it uses `consequences` with `appliesTo`.
- [ ] Import a legacy inline timed consequence; export it again and verify the Event/Artifact contains `applyEffect` while the generated Effect owns duration and lifecycle fields.
- [ ] Import a legacy artifact with `effects: ["effect-id"]`; export it again and verify the artifact contains an `applyEffect` consequence.
- [ ] Refresh after editing and verify the selected content and canonical consequence data remain intact.

## Responsive And Polish

- [ ] At desktop width, verify the catalog, preview, editors, and Consequences panel remain independently scrollable and do not overlap.
- [ ] At about 390 x 844, verify Event Builder and Artifact Builder have no horizontal page overflow, truncated catalog labels remain readable, and controls stay within their panels.
- [ ] Verify missing Effect references show a clear missing-state label and validation error rather than silently disappearing.
