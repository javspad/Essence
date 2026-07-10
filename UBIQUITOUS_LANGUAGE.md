# Ubiquitous Language

This glossary is a working draft for Essence, based on the planning notes and the current codebase. It is intentionally opinionated so the roadmap can avoid building duplicate concepts under different names.

## Game structure

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Game** | A full play session from lobby through final winner. | Match, partida |
| **Room** | A multiplayer instance identified by a short code where one group plays a **Game**. | Sala when naming code, lobby when the game has started |
| **Host** | The **Player** who created the **Room** and can start/force/advance shared flows. | Admin, owner |
| **Board Cell** | A position on the board that can trigger an **Event**, movement, shop, or finish. | Tile, casilla |
| **Route** | A directed connection between two **Board Cells**. | Path, edge |
| **Map Prop** | A decorative object placed on the 3D board map. | Artifact, artefacto |
| **Event** | Content resolved when a **Player** lands on a **Board Cell**. | Minigame, dare, fate when speaking generically |
| **Activity** | An interactive **Event** resolver that collects player input and produces results. | Minigame engine when it is not competitive |
| **Story Beat** | A reusable anecdote or narrative prompt that gives flavor to an **Event**, **Artifact**, or **Effect**. | Historia, anecdote as implementation terms |
| **Win Condition** | The rule that decides the winner when the game ends. | Stars, victory points |

## Player identity

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Player Slot** | A claimable position in a **Room** backed by one **Character** from the selected **Character Set**. | Player definition, roster entry |
| **Player** | A connected or reconnectable participant inside a **Room**. | Character, user |
| **Character** | An authored visual/personality identity profile that can become a **Player Slot** in a **Room**. | Player, avatar |
| **Character Set** | The reusable roster of **Characters** selected when creating a **Room**. | Player set, roster |
| **Face Photo** | The image used as the visual face of a **Character**. | Avatar image |
| **Face Anchor** | A marked position and angle on the **Face Photo** used to attach visuals such as eyes, mouth, glasses, or moustache. | Eye position, mouth position when used generically |
| **Character Trait** | A default positive or negative **Effect** attached to a **Character**. | Buff, default effect |

## Events and results

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Result** | A submitted score and payload from one **Player** for an **Activity**. | Minigame result when discussing generic activity output |
| **Activity Score** | A numeric value used to rank **Subjects** inside one **Activity**. | Points, final score |
| **Ranking** | The server-authoritative ordering of subjects after scores and rigging are applied. | Leaderboard when referring to one resolved activity |
| **Reveal** | The shared results screen shown after an **Activity** resolves. | Results modal |
| **Consequence** | An immediate rule outcome that changes game state or asks for an offline action. | Effect, punishment |
| **Consequence Rule** | One or more **Consequences** that share a selected subject and resolve together when an **Event** completes. | Immediate action, outcome branch |
| **Confirmation** | A required acknowledgement that an offline action or prompt was completed. | Ready, listo |
| **Subject** | A **Player** who can be ranked or targeted by an **Activity**. | Participant when the player did not submit input |
| **Participant** | A **Player** who must submit input to complete an **Activity**. | Subject |
| **Acting Player** | The **Player** who triggers or uses something. | Caster, user, landing player |
| **Target Player** | The **Player** selected to receive a **Consequence** or **Effect**. | Affected player when selection is still pending |

## Items, effects, and economy

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Coin** | The spendable currency earned from minigames, cells, shots, and item effects. | Money, moneda in code |
| **Coin Source** | The authored or runtime reason a **Coin Transaction** exists, such as a ranking payout, shop purchase, cell, shot confirmation, artifact, or effect. | Generic reason string when it affects rules |
| **Coin Transaction** | A server-authoritative coin change with amount, source, affected player, and display text for reveal/log UI. | Silent balance mutation |
| **Economy Consequence** | A reusable **Consequence** that gains, loses, spends, transfers, steals, or redistributes **Coins**. | Economy rule outside the consequence engine |
| **Coin Selector** | A selector based on current coin balances, such as richest player, poorest player, coin rank, or coin rank range. | Activity ranking selector |
| **Coin Transfer** | An **Economy Consequence** that moves available **Coins** from one source selector to one recipient selector. | Two unrelated coin changes |
| **Ranking Payout Policy** | Authored rules that map an **Activity Ranking** to **Economy Consequences** after an **Activity** resolves. | Hard-coded coinPayout |
| **Cosmetic** | A purchasable visual item that can be owned and equipped without gameplay effects. | Artifact, effect item |
| **Artifact** | A purchasable gameplay item with an immediate use flow and optional visual representation. | Map artifact, cosmetic |
| **Artifact Offer** | One of the random shop options shown during a shop visit. | Shop card |
| **Shop Roll** | The generated set of **Artifact Offers** for one shop visit. | Reroll, shop reroll |
| **Shop Purchase** | An atomic shop command that validates offer, ownership, and balance before spending **Coins** and granting an item. | Authored consequence |
| **Effect** | A duration-based modifier that changes how a **Player** interacts with the game. | Consequence, buff |
| **Effect Instance** | A live **Effect** applied to a **Player**, with source, target, remaining duration, and optional visual. | Active buff |
| **Effect Visual** | A temporary character visual shown while an **Effect Instance** is active. | Cosmetic when it has gameplay meaning |
| **Artifact Visual** | The optional 3D or character attachment representing an **Artifact**. | Cosmetic |
| **Rarity** | A probability bucket that affects how often an **Artifact** appears in a **Shop Roll**. | Rate, tier |

## Builders and content

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Content JSON** | The portable data file that defines players, maps, events, minigames, items, and stories. | Config, database |
| **Map Builder** | The authoring tool for board cells, routes, terrain, and map props. | Board editor |
| **Event Builder** | The authoring tool for stories, activities, and consequence rules. | Minigame builder when editing non-minigame events |
| **Character Builder** | The authoring tool for characters, face anchors, default traits, and visual loadouts. | Avatar builder |
| **Artifact Builder** | The authoring tool for artifact pricing, rarity, targeting, consequences, effects, visuals, and simulations. | Item builder |
| **Cosmetic Builder** | The authoring tool for cosmetic assets, anchors, prices, and previews. | Visual builder |
| **Authoring Skill** | A repo-local guide for adding or editing one category of content safely. | Workflow doc |

## Relationships

- A **Room** runs exactly one **Game** at a time.
- A **Room** selects exactly one **Character Set**, and each connected **Player** claims exactly one **Player Slot** from that set.
- A **Character** belongs to one or more **Character Sets** and can define zero or more **Character Traits**.
- A **Board Cell** can point to one or more candidate **Events**.
- An **Event** can have zero or one **Activity** and zero or more **Consequences**.
- An **Activity** has **Participants**, **Subjects**, submitted **Results**, and one resolved **Ranking**.
- A **Reveal** displays **Results**, **Ranking**, awarded **Coins**, and applied **Consequences**.
- A **Ranking Payout Policy** converts an **Activity Ranking** into **Economy Consequences**.
- A **Player** may own zero or more **Cosmetics** in a **Room** and equip a visual loadout from that owned set.
- A **Cosmetic** may attach to a **Face Anchor**, body anchor, or board token, but never changes gameplay.
- An **Artifact** may produce **Consequences**, apply **Effects**, require a **Target Player**, and optionally display an **Artifact Visual** or **Effect Visual**.
- A **Coin Transfer** has at least one source selector and one recipient selector, and each applied transfer should produce **Coin Transaction** records for display.
- An **Effect Instance** belongs to exactly one **Target Player** and may reference one **Acting Player** as its source.
- A **Shop Roll** contains several **Artifact Offers**, and the **Acting Player** can buy at most one offer per shop visit under the current notes.
- A **Shop Purchase** may create **Coin Transactions**, but it is not itself an authored **Consequence** because it also grants ownership and must stay atomic.

## Stable Rules

- A **Consequence** is immediate: it changes state now, awards/removes **Coins**, moves a **Player**, or asks for a confirmed offline action.
- An **Event** has one list of consequence rules that resolves when the Event completes; ranking selectors become available when an Activity produced a Ranking.
- An **Effect** has duration: it modifies future interactions for turns, rounds, a trigger window, or the whole **Game**.
- Events and Artifacts apply persistent behavior by referencing an **Effect**; lifecycle hooks and duration are never authored directly on their Consequences.
- Spending **Coins** is all-or-nothing: a shop purchase or explicit spend either succeeds with enough balance or fails without changing state.
- Steal and redistribution **Economy Consequences** may clamp to available **Coins** when configured as an effect, but must never make a balance negative.
- **Coin Selectors** are different from **Activity Ranking** selectors; if ties occur, the server must use deterministic tie-breaking and log the selected players.
- A **Shop Purchase** reuses the same coin transaction path as consequences, but purchase validation and item grant stay in the shop command.
- Buying a **Cosmetic** may spend **Coins**, but equipping or rendering a **Cosmetic** never changes movement, scoring, events, activities, artifacts, effects, or minigame outcomes.
- Joining a **Room** claims an existing **Character** slot; free-text names are reconnection/import compatibility, not a way to invent a new **Character** during play.
- Decorative board objects are authored as **Map Props** in Content JSON (`mapProps`); legacy runtime/import code may still mirror them through `artifacts` until the implementation rename is safe.

## Example Dialogue

> **Dev:** "When the host creates a **Room**, do players type names or choose **Characters**?"
>
> **Domain expert:** "The host selects a **Character Set**, then each person claims a **Player Slot** backed by one **Character**."
>
> **Dev:** "So if Nico joins, the live **Player** id and board token come from the Nico **Character**?"
>
> **Domain expert:** "Exactly. The **Character** is authored content; the **Player** is the runtime participant connected to that slot."
>
> **Dev:** "Where do face positions and future glasses placement live?"
>
> **Domain expert:** "On the **Character**, through **Face Anchors** and body anchors. Later **Cosmetics** can attach there without changing gameplay."

## Flagged Ambiguities

- "Artifact" historically meant decorative map object in code (`MapArtifact`, `artifacts`). Recommendation: reserve **Artifact** for gameplay items, use **Map Prop** in domain/UI/schema language, and keep only compatibility mirrors for legacy imports/runtime.
- "Minigame" is used for every interactive activity, including votes, prompts, and judge flows. Recommendation: use **Activity** for the generic resolver and **Minigame** only for competitive arcade-style activities.
- "Buff", "default effect", and "character effect" overlap. Recommendation: call the reusable rule modifier an **Effect**, and call a default character-attached effect a **Character Trait**.
- "Consequence" and "Effect" overlap. Recommendation: **Consequence** is immediate; **Effect** has duration or modifies future interactions.
- "Player", "Character", and "avatar" overlap. Recommendation: **Player** is the live room participant; **Character** is the configured identity/visual profile.
- "name" and "display name" overlap in character/player code. Recommendation: use **displayName** for authored **Character** content and reserve runtime **Player.name** for the claimed slot's visible name.
- "Participant" and "affected player" overlap in artifacts and minigames. Recommendation: use **Participant** only for players who submit activity input, **Subject** for players who can be ranked, and **Target Player** for players selected by an item/effect.
- "Star" was removed from code as a score marker and is not part of product language. Recommendation: do not reintroduce stars as a scoring resource; use the configured **Win Condition** plus **Coins** for ranking context.
- "More coins" and "less coins" can mean current coin balance, activity score, or final standings. Recommendation: call current-balance targeting a **Coin Selector** and keep **Ranking** for resolved activity order.
- Minigame coin rewards can be confused with direct score output. Recommendation: define a **Ranking Payout Policy** that turns ranked activity results into reusable **Economy Consequences**.
