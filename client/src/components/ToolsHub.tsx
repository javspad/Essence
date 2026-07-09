import { ArrowRight, Gamepad2, Home, Map, Palette, SlidersHorizontal, Sparkles, UserRound, Wrench } from "lucide-react";

const TOOL_LINKS = [
  {
    href: "/character-builder",
    title: "Character builder",
    eyebrow: "Characters",
    body: "Identity, face anchors, character sets",
    icon: UserRound,
    accent: "amber",
  },
  {
    href: "/map-builder",
    title: "Map builder",
    eyebrow: "Maps",
    body: "Cells, routes, terrain, map props",
    icon: Map,
    accent: "emerald",
  },
  {
    href: "/event-builder",
    title: "Event builder",
    eyebrow: "Events",
    body: "Activities, stories, consequences",
    icon: Gamepad2,
    accent: "cyan",
  },
  {
    href: "/cosmetic-builder",
    title: "Cosmetic builder",
    eyebrow: "Visual items",
    body: "Anchored cosmetics, prices, previews",
    icon: Palette,
    accent: "fuchsia",
  },
  {
    href: "/artifact-builder",
    title: "Artifact builder",
    eyebrow: "Gameplay items",
    body: "Rarity, effects, targeting, shop rolls",
    icon: Sparkles,
    accent: "emerald",
  },
  {
    href: "/effect-builder",
    title: "Effect builder",
    eyebrow: "Shared rules",
    body: "Reusable effects, hooks, conditions",
    icon: SlidersHorizontal,
    accent: "cyan",
  },
];

export default function ToolsHub() {
  return (
    <main className="min-h-full bg-[#11151b] text-slate-100">
      <header className="border-b border-white/10 bg-[#151b22] px-4 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-amber-200">Essence tools</p>
            <h1 className="truncate text-xl font-black tracking-normal text-white">Tools hub</h1>
          </div>
          <a
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 text-xs font-black text-slate-100 transition hover:bg-white/10"
          >
            <Home className="h-4 w-4" />
            Game
          </a>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-5 md:grid-cols-2">
        {TOOL_LINKS.map((tool) => {
          const Icon = tool.icon;
          const accent =
            tool.accent === "emerald"
              ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
              : tool.accent === "amber"
                ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                : tool.accent === "fuchsia"
                  ? "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100"
                  : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
          return (
            <a
              key={tool.href}
              href={tool.href}
              className={`group flex min-h-36 flex-col justify-between rounded-lg border p-4 shadow-xl shadow-black/20 transition hover:-translate-y-0.5 hover:bg-white/[0.07] ${accent}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] opacity-75">{tool.eyebrow}</p>
                  <h2 className="mt-1 text-2xl font-black tracking-normal text-white">{tool.title}</h2>
                </div>
                <Icon className="h-7 w-7 shrink-0" />
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <p className="max-w-[18rem] text-sm font-bold text-white/70">{tool.body}</p>
                <ArrowRight className="h-5 w-5 shrink-0 transition group-hover:translate-x-1" />
              </div>
            </a>
          );
        })}
      </section>
      <footer className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 pb-6 text-xs font-bold text-slate-500">
        <Wrench className="h-4 w-4" />
        Content JSON stays portable across builders.
      </footer>
    </main>
  );
}
