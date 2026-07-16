import { useMemo, useState } from "react";
import type { GameContent, MapDefinition } from "@essence/shared";
import { Activity, Check, Clipboard, Dices, Play, Users } from "lucide-react";
import { simulateMapGames, type MapSimulationResult } from "../mapSimulation";

type CellSort = "path" | "landings" | "reach" | "events";

interface MapSimulationPanelProps {
  content: GameContent;
  map: MapDefinition;
  result: MapSimulationResult | null;
  onResult: (result: MapSimulationResult) => void;
  selectedCellId?: number;
  onSelectCell: (id: number) => void;
  onEditSelected: () => void;
}

const MAX_SIMULATED_GAMES = 25_000;
const MAX_SIMULATED_PLAYERS = 12;
const MAX_SIMULATION_SEED = 2_147_483_647;

export default function MapSimulationPanel({
  content,
  map,
  result,
  onResult,
  selectedCellId,
  onSelectCell,
  onEditSelected,
}: MapSimulationPanelProps) {
  const [playerCount, setPlayerCount] = useState(() => result?.config.playerCount ?? Math.min(4, Math.max(1, content.players.length || 4)));
  const [games, setGames] = useState(() => result?.config.games ?? 1_000);
  const [seed, setSeed] = useState(() => result?.config.seed ?? hashStringToSeed(map.id));
  const [includeTraits, setIncludeTraits] = useState(() => result?.config.includeTraits ?? true);
  const [sort, setSort] = useState<CellSort>("path");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedCell = result?.cells.find((cell) => cell.tileId === selectedCellId);
  const sortedCells = useMemo(() => {
    if (!result) return [];
    const cells = [...result.cells];
    if (sort === "landings") return cells.sort((a, b) => b.landings - a.landings || a.boardIndex - b.boardIndex);
    if (sort === "reach") return cells.sort((a, b) => b.gameReachRate - a.gameReachRate || a.boardIndex - b.boardIndex);
    if (sort === "events") return cells.sort((a, b) => b.eventTriggers - a.eventTriggers || a.boardIndex - b.boardIndex);
    return cells.sort((a, b) => a.boardIndex - b.boardIndex);
  }, [result, sort]);

  const runSimulation = async () => {
    const normalizedPlayers = clampInteger(playerCount, 1, MAX_SIMULATED_PLAYERS);
    const normalizedGames = clampInteger(games, 1, MAX_SIMULATED_GAMES);
    const normalizedSeed = clampInteger(seed, 0, MAX_SIMULATION_SEED);
    setPlayerCount(normalizedPlayers);
    setGames(normalizedGames);
    setSeed(normalizedSeed);
    setRunning(true);
    setError(null);
    setCopied(false);

    // Yield once so the busy state paints before a large synchronous batch.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      onResult(
        simulateMapGames(content, map, {
          playerCount: normalizedPlayers,
          games: normalizedGames,
          seed: normalizedSeed,
          includeTraits,
          traceLimit: 80,
        })
      );
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : "The simulation could not be completed.");
    } finally {
      setRunning(false);
    }
  };

  const copyReport = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildSimulationReport(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "The report could not be copied.");
    }
  };

  return (
    <div data-testid="map-simulation-panel" className="grid gap-5 pb-5">
      <section className="overflow-hidden rounded-md border border-amber-200/20 bg-[linear-gradient(145deg,rgba(251,191,36,0.11),rgba(255,255,255,0.025)_58%)]">
        <div className="h-1 bg-[linear-gradient(90deg,#fde68a,#fb923c,#e11d48)]" />
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-amber-200">Board telemetry</p>
              <h2 className="mt-1 text-base font-black text-white">Gameplay simulation</h2>
              <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-400">
                Run deterministic games without playing activities, then inspect where players actually land.
              </p>
            </div>
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <SimulationNumberInput
              label="Players"
              value={playerCount}
              min={1}
              max={MAX_SIMULATED_PLAYERS}
              onChange={setPlayerCount}
            />
            <SimulationNumberInput
              label="Simulated games"
              value={games}
              min={1}
              max={MAX_SIMULATED_GAMES}
              onChange={setGames}
            />
          </div>

          <label className="mt-2 block text-xs font-bold text-slate-300">
            Seed
            <input
              type="number"
              min={0}
              max={MAX_SIMULATION_SEED}
              step={1}
              inputMode="numeric"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
              aria-label="Seed"
              className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-2 py-2 font-mono text-xs text-white outline-none focus:border-amber-300"
            />
          </label>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-md border border-white/10 bg-black/20 p-2.5 text-xs font-bold text-slate-200">
            <input
              type="checkbox"
              checked={includeTraits}
              onChange={(event) => setIncludeTraits(event.target.checked)}
              aria-label="Character traits"
              className="mt-0.5 size-4 shrink-0 accent-amber-400"
            />
            <span>
              Character traits
              <span className="mt-0.5 block text-[0.64rem] leading-4 text-slate-500">Apply supported starting and turn-based character effects.</span>
            </span>
          </label>

          <button
            type="button"
            onClick={runSimulation}
            disabled={running}
            aria-label="Run simulation"
            data-testid="map-simulation-run"
            className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-amber-200/45 bg-amber-300 px-3 text-xs font-black text-amber-950 shadow-sm transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-65"
          >
            <Play className={`h-3.5 w-3.5 ${running ? "animate-pulse" : ""}`} />
            {running ? "Simulating…" : `Run ${formatInteger(games)} games`}
          </button>

          {error && (
            <p role="alert" className="mt-2 rounded-md border border-rose-300/25 bg-rose-400/10 px-2.5 py-2 text-xs font-bold leading-4 text-rose-100">
              {error}
            </p>
          )}
        </div>
      </section>

      {!result && !error && (
        <section className="rounded-md border border-dashed border-white/15 bg-white/[0.025] p-4 text-sm text-slate-300">
          <Dices className="h-5 w-5 text-amber-200" />
          <p className="mt-3 font-black text-white">Ready to roll the board</p>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
            A fixed seed makes every run reproducible, so map changes can be compared fairly.
          </p>
        </section>
      )}

      {result && (
        <>
          <section data-testid="map-simulation-summary" aria-live="polite">
            <SectionHeading label="Run summary" aside={`${result.summary.runtimeMs.toFixed(1)} ms`} />
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Completed" value={`${formatInteger(result.summary.completedGames)} / ${formatInteger(result.summary.games)}`} />
              <MetricCard label="Completion" value={formatPercent(result.summary.completionRate)} />
              <MetricCard label="Avg. turns" value={formatDecimal(result.summary.averageTurnsPerGame)} />
              <MetricCard label="Avg. rounds" value={formatDecimal(result.summary.averageRoundsPerGame)} />
              <MetricCard label="Landings" value={formatInteger(result.summary.totalLandings)} />
              <MetricCard label="Rolls" value={formatInteger(result.summary.totalRolls)} />
            </div>
            {result.summary.cappedGames > 0 && (
              <p className="mt-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-2.5 py-2 text-[0.68rem] font-bold leading-4 text-amber-100">
                {formatInteger(result.summary.cappedGames)} game{result.summary.cappedGames === 1 ? "" : "s"} reached the safety turn cap.
              </p>
            )}
            <div data-testid="map-simulation-heatmap" className="mt-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
              <div className="flex items-center justify-between text-[0.56rem] font-black uppercase tracking-wide text-slate-500">
                <span>Map heat</span>
                <span>Trigger landings</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[0.58rem] font-bold text-slate-500">
                <span>Fewer</span>
                <span className="h-2 flex-1 rounded-full bg-[linear-gradient(90deg,#facc15,#fb923c,#fb7185)]" />
                <span>More</span>
              </div>
            </div>
          </section>

          <section data-testid="map-simulation-activity-mix">
            <SectionHeading label="Activity mix" aside={`${formatInteger(sumActivityTriggers(result))} triggers`} />
            <div className="grid gap-1.5">
              {result.activityTypes
                .filter((entry) => entry.triggers > 0)
                .sort((a, b) => b.triggers - a.triggers || a.activityType.localeCompare(b.activityType))
                .map((entry) => {
                  const total = Math.max(1, sumActivityTriggers(result));
                  const width = Math.max(2, (entry.triggers / total) * 100);
                  return (
                    <div key={entry.activityType} className="relative overflow-hidden rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
                      <span className="absolute inset-y-0 left-0 bg-cyan-300/10" style={{ width: `${width}%` }} />
                      <div className="relative flex items-center justify-between gap-3 text-xs font-bold">
                        <span className="truncate text-slate-300">{activityTypeLabel(entry.activityType)}</span>
                        <span className="shrink-0 tabular-nums text-cyan-100">{formatInteger(entry.triggers)}</span>
                      </div>
                    </div>
                  );
                })}
              {!result.activityTypes.some((entry) => entry.triggers > 0) && (
                <p className="rounded-md border border-white/10 bg-black/20 p-3 text-xs font-bold text-slate-500">No activities were triggered.</p>
              )}
            </div>
          </section>

          <details className="rounded-md border border-white/10 bg-white/[0.025]" data-testid="map-simulation-dice-audit">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-slate-300">Dice &amp; winner audit</summary>
            <div className="grid gap-4 border-t border-white/10 px-3 py-3">
              <div>
                <p className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500">Physical die</p>
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {Object.entries(result.dice.baseRolls)
                    .sort(([left], [right]) => Number(left) - Number(right))
                    .map(([face, count]) => (
                      <div key={face} className="rounded border border-white/10 bg-black/20 px-1 py-1.5 text-center">
                        <span className="block text-xs font-black text-amber-100">{face}</span>
                        <span className="mt-0.5 block text-[0.52rem] font-bold tabular-nums text-slate-500">{formatPercent(count / Math.max(1, result.summary.totalRolls))}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div>
                <p className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500">Effective movement</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(result.dice.effectiveRolls)
                    .filter(([, count]) => count > 0)
                    .sort(([left], [right]) => Number(left) - Number(right))
                    .map(([movement, count]) => (
                      <span key={movement} className="rounded border border-cyan-200/15 bg-cyan-300/[0.06] px-2 py-1 text-[0.6rem] font-bold text-cyan-100">
                        {movement} cells · {formatPercent(count / Math.max(1, result.summary.totalRolls))}
                      </span>
                    ))}
                </div>
              </div>
              <div>
                <p className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500">Winners</p>
                <div className="mt-2 grid gap-1.5">
                  {[...result.winners]
                    .sort((a, b) => b.wins - a.wins || a.playerName.localeCompare(b.playerName))
                    .map((winner) => (
                      <div key={winner.playerId} className="flex items-center justify-between rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[0.65rem] font-bold">
                        <span className="text-slate-300">{winner.playerName}</span>
                        <span className="tabular-nums text-emerald-200">{formatInteger(winner.wins)} · {formatPercent(winner.wins / Math.max(1, result.summary.finishedGames))}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </details>

          <section data-testid="map-simulation-cell-table">
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">All cells</h2>
                <p className="mt-1 text-[0.64rem] font-bold text-slate-500">Select a row to locate it on the authored map.</p>
              </div>
              <label className="shrink-0 text-[0.58rem] font-black uppercase tracking-wide text-slate-500">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as CellSort)}
                  aria-label="Cell sorting"
                  className="mt-1 block rounded-md border border-white/10 bg-[#0d120d] px-2 py-1.5 text-[0.65rem] font-bold normal-case tracking-normal text-white outline-none focus:border-amber-300"
                >
                  <option value="path">Path order</option>
                  <option value="landings">Hot first</option>
                  <option value="reach">Reach first</option>
                  <option value="events">Events first</option>
                </select>
              </label>
            </div>

            <div className="max-h-[23rem] overflow-auto rounded-md border border-white/10 bg-black/20">
              <table className="w-full border-collapse text-left text-[0.68rem]">
                <thead className="sticky top-0 z-10 bg-[#182018] text-[0.56rem] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Cell</th>
                    <th className="px-1.5 py-2 text-right">Land</th>
                    <th className="px-1.5 py-2 text-right">Reach</th>
                    <th className="px-2 py-2 text-right">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCells.map((cell) => {
                    const selected = cell.tileId === selectedCellId;
                    return (
                      <tr
                        key={cell.tileId}
                        data-simulation-row-cell-id={cell.tileId}
                        data-selected={selected || undefined}
                        onClick={() => onSelectCell(cell.tileId)}
                        className={`cursor-pointer border-t border-white/[0.07] ${selected ? "bg-amber-300/14" : "hover:bg-white/[0.035]"}`}
                      >
                        <td className="min-w-0 px-2 py-1.5">
                          <button
                            type="button"
                            aria-label={`Select cell ${cell.tileId}`}
                            className="block w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                          >
                            <span className="block truncate font-black text-white">#{cell.tileId} · {cell.label || cell.type}</span>
                            <span className="mt-0.5 block text-[0.56rem] font-black uppercase tracking-wide text-slate-500">{cell.type}</span>
                          </button>
                        </td>
                        <td className="px-1.5 py-1.5 text-right font-black tabular-nums text-amber-100">
                          {formatInteger(cell.landings)}
                          <span className="block text-[0.55rem] text-slate-500">{formatDecimal(cell.landingsPerGame)}/g</span>
                        </td>
                        <td className="px-1.5 py-1.5 text-right font-bold tabular-nums text-slate-300">{formatPercent(cell.gameReachRate)}</td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-cyan-100">{formatInteger(cell.eventTriggers)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section data-testid="map-simulation-selected-cell">
            <SectionHeading label="Selected cell" aside={selectedCell ? `#${selectedCell.tileId}` : "None"} />
            {selectedCell ? (
              <div className="rounded-md border border-amber-200/20 bg-amber-300/[0.07] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{selectedCell.label || `Cell ${selectedCell.tileId}`}</p>
                    <p className="mt-1 text-[0.58rem] font-black uppercase tracking-[0.16em] text-amber-200">{selectedCell.type} · {selectedCell.eventCount} event{selectedCell.eventCount === 1 ? "" : "s"}</p>
                  </div>
                  <button type="button" onClick={onEditSelected} className="builder-button compact shrink-0" aria-label="Edit selected cell">
                    Edit cell
                  </button>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
                  <CellMetric label="Landings" value={formatInteger(selectedCell.landings)} />
                  <CellMetric label="Games reached" value={`${formatInteger(selectedCell.gamesReached)} · ${formatPercent(selectedCell.gameReachRate)}`} />
                  <CellMetric label="Pass-throughs" value={formatInteger(selectedCell.passThroughs)} />
                  <CellMetric label="Shop stops" value={formatInteger(selectedCell.shopStops)} />
                  <CellMetric label="Event triggers" value={formatInteger(selectedCell.eventTriggers)} />
                  <CellMetric label="Effect arrivals" value={formatInteger(selectedCell.consequenceArrivals)} />
                </dl>
                <PlayerLandingBreakdown value={selectedCell.byPlayer} />
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-white/15 bg-white/[0.025] p-3 text-xs font-bold leading-5 text-slate-500">
                Select a cell in the table or on the map to inspect its traffic.
              </p>
            )}
          </section>

          <details open className="rounded-md border border-white/10 bg-white/[0.025]" data-testid="map-simulation-assumptions">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-slate-300">Simulation assumptions</summary>
            <ul className="grid gap-1.5 border-t border-white/10 px-3 py-3 text-[0.68rem] font-bold leading-4 text-slate-400">
              {result.assumptions.map((assumption, index) => <li key={`${index}-${String(assumption)}`}>• {String(assumption)}</li>)}
            </ul>
          </details>

          <section data-testid="map-simulation-diagnostics">
            <SectionHeading label="Diagnostics" aside={result.diagnostics.length ? `${result.diagnostics.length}` : "Clear"} />
            {result.diagnostics.length ? (
              <ul className="grid gap-1.5 text-[0.68rem] font-bold leading-4 text-amber-100">
                {result.diagnostics.map((diagnostic, index) => (
                  <li key={`${index}-${String(diagnostic)}`} className="rounded-md border border-amber-300/20 bg-amber-300/[0.07] p-2.5">
                    {String(diagnostic)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] p-3 text-xs font-bold text-emerald-100">No simulation warnings.</p>
            )}
          </section>

          <details className="rounded-md border border-white/10 bg-white/[0.025]" data-testid="map-simulation-trace">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-slate-300">
              First-game trace · {result.sampleTrace.length} turns
            </summary>
            <div className="max-h-[24rem] overflow-auto border-t border-white/10">
              <table className="w-full border-collapse text-left text-[0.65rem]">
                <thead className="sticky top-0 bg-[#182018] text-[0.54rem] font-black uppercase tracking-wide text-slate-500">
                  <tr><th className="px-2 py-2">Turn</th><th className="px-2 py-2">Player</th><th className="px-2 py-2">Roll</th><th className="px-2 py-2">Journey</th></tr>
                </thead>
                <tbody>
                  {result.sampleTrace.map((entry, index) => (
                    <tr key={`${entry.turn}-${entry.playerId}-${index}`} className="border-t border-white/[0.07] align-top">
                      <td className="px-2 py-2 font-black tabular-nums text-slate-300">{entry.turn}<span className="block text-[0.52rem] text-slate-600">R{entry.round}</span></td>
                      <td className="px-2 py-2 font-bold text-white">{entry.playerName}</td>
                      <td className="px-2 py-2 font-black tabular-nums text-amber-100">{entry.baseRoll}{entry.effectiveRoll !== entry.baseRoll ? ` → ${entry.effectiveRoll}` : ""}</td>
                      <td className="px-2 py-2 font-bold leading-4 text-slate-400">
                        {entry.fromIndex} → {entry.landedIndex}{entry.finalIndex !== entry.landedIndex ? ` → ${entry.finalIndex}` : ""}
                        <span className="block text-cyan-100">cell #{entry.tileId} · {entry.tileType}</span>
                        {entry.activityType && <span className="block text-slate-500">{activityTypeLabel(entry.activityType)}</span>}
                        {entry.effects.length > 0 && <span className="block text-amber-200/80">{entry.effects.join(" · ")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.sampleTrace.length && <p className="p-3 text-xs font-bold text-slate-500">No trace entries were recorded.</p>}
            </div>
          </details>

          <button
            type="button"
            onClick={copyReport}
            className="builder-button w-full"
            aria-label="Copy simulation report"
            data-testid="map-simulation-copy-report"
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-300" /> : <Clipboard className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Report copied" : "Copy report"}
          </button>
        </>
      )}
    </div>
  );
}

function SimulationNumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-bold text-slate-300">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-2 py-2 text-sm font-black tabular-nums text-white outline-none focus:border-amber-300"
      />
    </label>
  );
}

function SectionHeading({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">{label}</h2>
      {aside && <span className="text-[0.6rem] font-black uppercase tracking-wide text-slate-500">{aside}</span>}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2.5 py-2.5">
      <p className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black tabular-nums text-white">{value}</p>
    </div>
  );
}

function CellMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-black tabular-nums text-slate-200">{value}</dd></div>;
}

function PlayerLandingBreakdown({ value }: { value: unknown }) {
  const entries = normalizePlayerLandings(value);
  if (!entries.length) return null;
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <p className="text-[0.56rem] font-black uppercase tracking-wide text-slate-500"><Users className="mr-1 inline h-3 w-3" />By player</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map(([name, landings]) => <span key={name} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[0.62rem] font-bold text-slate-300">{name} · {formatInteger(landings)}</span>)}
      </div>
    </div>
  );
}

function normalizePlayerLandings(value: unknown): [string, number][] {
  if (Array.isArray(value)) {
    return value.flatMap((entry): [string, number][] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const name = String(record.playerName ?? record.name ?? record.playerId ?? "Player");
      const landings = Number(record.landings ?? record.value ?? record.count ?? 0);
      return Number.isFinite(landings) ? [[name, landings]] : [];
    });
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([name, raw]): [string, number][] => {
      const landings = typeof raw === "number" ? raw : Number((raw as Record<string, unknown> | null)?.landings ?? 0);
      return Number.isFinite(landings) ? [[name, landings]] : [];
    });
  }
  return [];
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function hashStringToSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 & MAX_SIMULATION_SEED;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function activityTypeLabel(type: string): string {
  if (type === "cardVote") return "Card vote";
  if (type === "hostPick") return "Host pick";
  if (type === "selfTap") return "Self tap";
  if (type === "horserace") return "Horse race";
  if (type === "redlight") return "Red light";
  return type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : "Prompt / story";
}

function sumActivityTriggers(result: MapSimulationResult): number {
  return result.activityTypes.reduce((total, entry) => total + entry.triggers, 0);
}

function buildSimulationReport(result: MapSimulationResult): string {
  const lines = [
    `# ${result.map.name} gameplay simulation`,
    "",
    `- Seed: ${result.config.seed}`,
    `- Players: ${result.summary.players}`,
    `- Games: ${formatInteger(result.summary.games)}`,
    `- Character traits: ${result.config.includeTraits ? "enabled" : "disabled"}`,
    `- Completion: ${formatPercent(result.summary.completionRate)} (${formatInteger(result.summary.completedGames)}/${formatInteger(result.summary.games)})`,
    `- Average turns: ${formatDecimal(result.summary.averageTurnsPerGame)}`,
    `- Average rounds: ${formatDecimal(result.summary.averageRoundsPerGame)}`,
    `- Total landings: ${formatInteger(result.summary.totalLandings)}`,
    `- Runtime: ${result.summary.runtimeMs.toFixed(1)} ms`,
    "",
    "## Activity mix",
    ...result.activityTypes
      .filter((entry) => entry.triggers > 0)
      .sort((a, b) => b.triggers - a.triggers)
      .map((entry) => `- ${activityTypeLabel(entry.activityType)}: ${formatInteger(entry.triggers)}`),
    "",
    "## Winner distribution",
    ...[...result.winners]
      .sort((a, b) => b.wins - a.wins)
      .map((winner) => `- ${winner.playerName}: ${formatInteger(winner.wins)} (${formatPercent(winner.wins / Math.max(1, result.summary.finishedGames))})`),
    "",
    "## Physical die distribution",
    ...Object.entries(result.dice.baseRolls)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([face, count]) => `- ${face}: ${formatInteger(count)} (${formatPercent(count / Math.max(1, result.summary.totalRolls))})`),
    "",
    "## Cell traffic",
    "| Cell | Type | Landings | Per game | Games reached | Event triggers |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...[...result.cells]
      .sort((a, b) => a.boardIndex - b.boardIndex)
      .map((cell) => `| #${cell.tileId} ${cell.label || ""} | ${cell.type} | ${cell.landings} | ${formatDecimal(cell.landingsPerGame)} | ${formatPercent(cell.gameReachRate)} | ${cell.eventTriggers} |`),
    "",
    "## Assumptions",
    ...result.assumptions.map((assumption) => `- ${String(assumption)}`),
    "",
    "## Diagnostics",
    ...(result.diagnostics.length ? result.diagnostics.map((diagnostic) => `- ${String(diagnostic)}`) : ["- No warnings."]),
  ];
  return lines.join("\n");
}
