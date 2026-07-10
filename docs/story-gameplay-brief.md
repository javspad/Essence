# Story And Gameplay Brief

This brief is for the person expanding the game's story, map, player personalities, minigame phrases/images, artifacts, and gameplay flavor. It is grounded in the current checkout on `main`, plus the roadmap's planned systems.

## Current Source Of Truth

- The game is a synchronized board game with server-authoritative state and local minigames.
- Content lives mainly in `shared/content.json`.
- The active map is `farewell-loop`: 54 board cells, 56 routes, 9 terraces, and 78 decorative Map Props.
- Current authored events: 22.
- Current reusable activity engines: 15.
- Current characters/player slots: 10.
- Current cosmetics: 76, visual-only.
- Current gameplay artifacts: 6.
- Current reusable effects: 8.

## Vocabulary Boundaries

- Event: anything triggered by a board cell.
- Activity: the interactive resolver inside an event. A minigame is one kind of activity.
- Story Beat: an anecdote or narrative setup that can flavor events, artifacts, effects, map zones, or player traits.
- Consequence: immediate outcome. Examples: gain coins, lose coins, move, move back, take a shot, skip turn, swap positions.
- Effect: duration-based modifier. Examples: half movement for 2 rounds, dice bias, skip next turn, trigger something on a future roll.
- Character Trait: a default effect or rule attached to a character.
- Cosmetic: visual-only item. It can be funny, but it must not change gameplay.
- Artifact: gameplay item bought in the shop and used through consequence/effect logic.
- Map Prop: decorative object on the board. Do not call these artifacts in story/gameplay docs.

## Current Minigames And Activities

These are the authored entries already in `shared/content.json`.

| ID | Engine | Current content hook | Best story/content extension |
| --- | --- | --- | --- |
| `event-bostezo` | `timing` | Tap when the professor is not watching. | Swap label/lose text/images for classroom, work, party, or inside-joke timing moments. |
| `event-lujan` | `judge` | Write a message inviting Lujan for ice cream. | Add judge personas and prompts where the funniest written answer wins. |
| `event-mas-probable-1` | `vote` | Who falls asleep first tonight? | Add "most likely to..." accusations tied to players. |
| `event-mas-probable-2` | `vote` | Who loses their phone tonight? | Same as above. |
| `event-quien-dijo-1` | `vote` | Who said "last one and we leave"? | Use quotes and recurring group phrases. |
| `event-dos-verdades-1` | `vote` | Two truths and one lie about the groom. | Add anecdote-based liar/truth prompts. |
| `event-estimate-frang` | `estimate` | How many rejections did FranG get in 15 years? | Add numeric lore questions with units and exact answers. |
| `event-estimate-noche` | `estimate` | What time will the first person go to sleep? | Add prediction/guessing questions about the night. |
| `event-reaction-1` | `reaction` | Wait for green, fastest wins, false start loses. | Re-skin as reflex tests around real group moments. |
| `event-trivia-novio-1` | `buzzer` | Groom trivia with multiple choice. | Add funny groom/player trivia with correct answers. |
| `event-trivia-novio-2` | `buzzer` | Groom trip/airport-bag trivia. | Add story-specific multiple choice questions. |
| `event-whack-amigos` | `whack` | Hit the correct face. | Use real faces/images, themed targets, decoys, and phrase variants. |
| `event-arcade-maze` | `maze` | Find the maze exit. | Re-theme walls/exit around story locations. |
| `event-arcade-flappy` | `flappy` | Fly through the night's chaos. | Re-theme obstacles, label, and imagery. |
| `event-arcade-snake` | `snake` | Survive the previous-party snake. | Re-theme arena, food, danger, and fail text. |
| `event-arcade-horserace` | `horserace` | Mash the indicated arrows to race. | Re-theme as running to the club, catching a bus, escaping a story scene. |
| `event-arcade-redlight` | `redlight` | Move on green, stop on red. | Re-theme as not being caught, not moving in class, not revealing a prank. |

The activity engine list also includes `prompt`, `hostPick`, and `selfTap`. These are configured directly inside events for dares, confirmation flows, host decisions, and quick offline actions.

## Current Board Events

The active board already uses these categories:

- Competitive/local minigames: timing, reaction, buzzer/trivia, estimate, whack, maze, flappy, snake, horserace, redlight.
- Voting events: most-likely, who-said-it, two-truths-style prompts.
- Judge events: written answer evaluated by a persona or vote phase.
- Dares/prendas: `event-dare-shot-1`, `event-dare-shot-2`, `event-dare-reto-1`.
- Fate events: move back 2, gain 5 coins.
- Groom-specific cells: currently reuse groom trivia.
- Finish cell: first player to reach finish wins; coins are secondary ranking/tie-breaker.

## General Minigame Logic

The shared loop is:

1. A player lands on a board cell.
2. The cell points to an Event.
3. The Event may show a Story Beat and start an Activity.
4. Each local client runs the activity and submits `{ score, payload }`.
5. The server resolves ranking, applies optional rigging, awards coins, and builds a Reveal.
6. Consequences apply immediately or Effects attach to players for future turns/rounds/uses.
7. The game returns to the board flow.

Important implementation constraints:

- Higher score is better for all engines.
- The server is authoritative for ranking, coins, rigging, consequences, effects, and turn state.
- Clients can present funny UI/images and submit input, but should not decide final game state.
- Reveals should explain who did what, ranking, scores/details, coin changes, and consequences.
- Offline actions like shots or physical dares should use confirmation flows.

## What Can Be Extended Without New Game Engines

The content person can safely create or propose:

- New labels, prompts, titles, setup text, reward text, and fail/win flavor.
- New `vote` questions.
- New `buzzer` trivia questions with options and correct answer index.
- New `estimate` questions with numeric answer and unit.
- New `judge` prompts and judge personas.
- New `timing` windows and lose flavor.
- New `reaction` min/max delays and labels.
- New `whack` target lists and visual concepts.
- New arcade labels, durations, grid sizes, track lengths, and obstacle themes where supported.
- New prompt/prenda text and confirmation rules.
- New event story text and map-zone labels.
- New cosmetics as visual-only anchored items.
- New Story Beat tags that connect anecdotes to players, places, activity types, artifacts, and traits.

## Consequences And Effects We Can Reuse

Immediate consequences currently supported by the shared vocabulary:

- Display text.
- Gain or lose coins.
- Move forward/back by delta.
- Move to a specific cell.
- Skip turn.
- Extra turn.
- Offline action such as take a shot, with confirmation.
- Apply an effect.
- Swap positions.
- Move to nearest player ahead or behind.

Duration effects currently supported by the roadmap/code vocabulary:

- Movement multiplier, including half movement.
- Dice bias for a specific die face.
- Skip turn.
- Extra turn.
- Coin changes on lifecycle hooks.
- Move or move-to on lifecycle hooks.
- Swap positions.
- Move to nearest player.
- Conditional consequences, for example "if the target rolls 6, trigger a shot."

Effect timing hooks:

- Before roll.
- After roll.
- Before movement.
- After movement.
- On cell enter.
- On activity result.
- On turn end.

Effect duration modes:

- Uses.
- Turns.
- Rounds.
- Whole game.

Target selectors:

- Acting player.
- Selected target player.
- Everyone.
- Fixed player.
- Ranking winner.
- Ranking loser.
- Rank or rank range.
- Nearest player ahead.
- Nearest player behind.

## Roadmap Systems To Design For

The story/gameplay work should be compatible with the full roadmap, even if some systems are not implemented in this checkout yet.

### Artifacts

Artifacts are gameplay items. They can have price, rarity, target mode, consequences, effects, visuals, and animations.

Planned shop behavior:

- Landing on a shop starts an artifact shop visit.
- A shop roll offers four artifacts.
- A player can inspect each artifact.
- A player can buy only one artifact per shop visit.
- Coins are deducted immediately.
- Purchase closes the shop and starts immediate use.
- If the artifact needs a target, the player selects a target from the player list/board focus UI.

Seed artifact:

- `Mochila de Gaston`.
- Gaston delivers a backpack.
- Visual: backpack in front of the target character's chest/arms.
- Effect: target advances only half of die-roll movement.
- Conditional consequence: if target rolls 6, target takes a shot.
- Duration: 2 rounds.

Good artifact ideas should specify:

- Name.
- One-sentence joke/story.
- Price.
- Rarity: common, epic, legendary.
- Target mode: self, target player, everyone, fixed player, ranking-based, nearest ahead/behind.
- Immediate consequence.
- Optional duration effect.
- Optional visual.
- Optional incoming/outgoing animation.
- Reveal/announcement copy.

### Character Traits

Traits are character-attached effects. They should be funny, personal, and bounded.

Seed trait ideas from the roadmap:

- Javi: if he advances fewer than 5 spaces across two turns, he implodes and moves backward.
- Facu: the game changes language for one turn because he "does not know the language."
- Nico: if he rolls more than 4 twice in a row, he complains too little about luck and moves back 5 spaces.
- Willy: if he rolls 4 or more twice in a row, he loses a turn because he went to the countryside with his girlfriend.
- Beltran: in a "Belgrano at 4pm" zone, he moves back 3 spaces out of fear.
- Frang: if he rolls 4 or more, he gets a simple finance/math challenge and moves back 1 space if he fails.

Good trait ideas should specify:

- Character.
- Trigger.
- Effect/consequence.
- Duration.
- Whether everyone sees it before the game starts or only when it triggers.
- One-liner reveal copy.

### Economy

Coins need coherent sources and sinks.

Current sources/sinks:

- Minigame ranking pays `[10, 7, 5, 3, 2, 1, 0]` by place.
- Fate can grant coins.
- Cosmetics can be bought/equipped.

Planned sources/sinks:

- Shot/offline prompt rewards.
- Coin cells.
- Artifact purchases.
- Steal/redistribute artifacts.
- Communist-style artifact that steals from everyone and gives to the acting player.
- Better reveal/action logs explaining why coins changed.

### Story Beat Bank

The roadmap already lists raw anecdotes to turn into structured content:

- Bomba de cloro.
- Bolidora de caca.
- Petardos por la ventana.
- Beltran atado en UPD.
- Faltaron al examen de biologia.
- Vinchuca y Chagas.
- Palazo en los huevos a Javi.
- Frang y Gaston yendo al bano de la mano.
- Portazo de Gaston en Bariloche.
- Gaston rompio el vidrio.
- Palo de hockey rompiendo vidrio, Javi y Willy.
- Pelotazo a Martina.
- Martina llorando porque Nico le dio un abrazo.
- Durmiendo a la intemperie: Marco Clopet diciendo "tengo frio".
- Willy encerrado en el armario durante clase de Alan.
- Gritarle a Jony y esconderse abajo de la ventana.
- Esconderse en los lockers de Jony.
- Palazo en los huevos de Anna.
- Javi discutiendo con Ana de historia, momento incomodo.
- La lengua loca de padornmania extrema.
- Caldo en el taxi, bajar a dar ropa a Gaston.
- Jugar al Just Dance en el Kinect del atico de Martinez.
- Orgia en el campo.
- Subir el tronco al aula.
- Tirar sillas en el aula.
- Cuando rompieron el vidrio por jugar a tirar el palo de hockey.
- Regalarme el coso amarillo de la ciudad todo meado.
- Cuando rompimos el arbol.
- Cuando nos acusaron de robar cosas del quiosco de los mas chicos.

Recommended structure for each Story Beat:

- Title.
- Short setup.
- Punchline/reveal line.
- People involved.
- Location/era.
- Tags.
- Safe display text.
- Allowed uses: vote, trivia, estimate, judge, prompt, artifact, trait, map zone, cosmetic, audio cue.
- Optional image idea.
- Optional consequence/effect idea.

## Task Outline For The Creative Contributor

1. Complete the roster.
   - Provide every player/character name.
   - Add core personality traits.
   - Mark the groom.
   - Suggest face photo/cosmetic ideas.
   - Propose one trait per character.

2. Turn anecdotes into Story Beats.
   - Use the structure above.
   - Tag each beat by player, place, mood, and allowed gameplay uses.
   - Keep raw anecdotes separate from final on-screen copy.

3. Expand minigame content.
   - Add many new entries using existing engines before proposing new engines.
   - For each entry, specify engine, prompt/label, answer if needed, players involved, image idea, and consequence idea.
   - Prioritize vote, trivia, estimate, judge, prompt, and whack because they are fastest to fill with story.

4. Improve the map plan.
   - Name map zones from real group history.
   - Assign Story Beats to zones/cells.
   - Mark where shops, coin cells, hard events, chill/funny events, and groom-specific events should appear.
   - Suggest decorative Map Props only as scenery, not gameplay artifacts.

5. Design artifacts.
   - Start with 8 to 12 artifact ideas.
   - Include at least 4 common, 3 epic, and 1 or 2 legendary.
   - Every artifact must say what it does using consequence/effect vocabulary.
   - Include visual/animation ideas, but keep the gameplay rule first.

6. Design economy beats.
   - Decide which actions earn coins.
   - Decide which consequences cost coins or steal coins.
   - Suggest rough prices for cosmetics and artifacts.

7. Add presentation ideas.
   - Suggest sounds for coins, artifacts, event starts, reveal moments, and effect expiration.
   - Suggest funny images for minigame prompts and artifact reveals.
   - Keep audio/visual ideas optional polish unless they clarify gameplay.

## Scope Rules

- Prefer new content using existing engines over new engine requests.
- New engine requests are allowed, but must include why existing engines cannot express the idea.
- Do not mix Artifacts and Cosmetics.
- Do not use Map Props as gameplay items.
- Do not reintroduce stars as scoring.
- Keep manual/free camera out of scope; map inspection uses player focus and full-map overview.
- Consequences happen now; effects last over time.
- Offline actions need confirmation.
- If a content idea affects gameplay, write it as a consequence, effect, artifact, trait, or special cell.
- If a content idea is visual only, write it as a cosmetic, image, animation, sound, or Map Prop.

## Fastest High-Impact Additions

For a first pass, focus on:

1. Complete the seven-player roster and personality notes.
2. Convert the anecdote list into tagged Story Beats.
3. Add 20 to 30 new vote/trivia/estimate/judge/prompt entries.
4. Draft 8 to 12 artifacts with clear effects.
5. Draft one trait per character.
6. Assign story beats to map zones and board cell categories.
