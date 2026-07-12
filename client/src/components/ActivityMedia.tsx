import type { CSSProperties } from "react";
import type { ActivityMediaPlacement, ActivityMediaRef, ContentMediaAssetDef } from "@essence/shared";
import { Card } from "@/components/ui/8bit/card";

interface ActivityMediaStripProps {
  assets?: Record<string, ContentMediaAssetDef>;
  media?: ActivityMediaRef[];
  placement: Exclude<ActivityMediaPlacement, "both">;
  compact?: boolean;
  presentation?: "strip" | "spotlight";
}

export function mediaForPlacement(
  media: ActivityMediaRef[] | undefined,
  placement: Exclude<ActivityMediaPlacement, "both">
): ActivityMediaRef[] {
  return (media ?? []).filter((ref) => {
    const refPlacement = ref.placement ?? "both";
    return refPlacement === "both" || refPlacement === placement;
  });
}

export default function ActivityMediaStrip({ assets, media, placement, compact = false, presentation = "strip" }: ActivityMediaStripProps) {
  const refs = mediaForPlacement(media, placement);
  if (!refs.length) return null;
  return (
    <div className={`grid w-full gap-3 ${presentation === "spotlight" ? "" : compact ? "mt-3" : "my-4"} ${refs.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {refs.map((ref, index) => (
        <ActivityMediaFigure key={`${ref.assetId}-${placement}-${index}`} asset={assets?.[ref.assetId]} refDef={ref} compact={compact} presentation={presentation} />
      ))}
    </div>
  );
}

export function ActivityMediaFigure({
  asset,
  refDef,
  compact = false,
  surface = "game",
  presentation = "strip",
}: {
  asset?: ContentMediaAssetDef;
  refDef: ActivityMediaRef;
  compact?: boolean;
  /** Game screens use the pixel frame; authoring tools use a neutral preview. */
  surface?: "game" | "tool";
  presentation?: "strip" | "spotlight";
}) {
  if (!asset) {
    return (
      <figure className="rounded-md border border-rose-300/25 bg-rose-500/10 p-3 text-center text-xs font-black text-rose-100">
        Missing media: {refDef.assetId}
      </figure>
    );
  }
  const image = (
    <div className={`relative w-full overflow-hidden bg-black/40 ${presentation === "spotlight" ? "aspect-[4/3] max-h-[52dvh]" : compact ? "aspect-[16/9]" : "aspect-[4/3] max-h-[42vh]"}`}>
      <img src={asset.src} alt={asset.alt ?? asset.caption ?? refDef.caption ?? ""} className="absolute max-w-none" style={mediaImageCropStyle(asset)} />
    </div>
  );

  if (presentation === "spotlight") {
    const caption = refDef.caption ?? asset.caption;
    return (
      <figure className="border border-[#fff4bf]/35 bg-[#090711] p-2 shadow-[0_8px_0_rgb(0_0_0/0.24),0_24px_60px_rgb(0_0_0/0.38)]">
        <div className="border border-white/10 bg-[#05040a]">{image}</div>
        {caption && <figcaption className="px-1 pb-0.5 pt-2 text-center text-xs font-black leading-4 text-[#d8d1e8]">{caption}</figcaption>}
      </figure>
    );
  }

  return <figure>{surface === "game" ? <Card font="normal" className="overflow-hidden border-[#fff4bf] bg-[#10131a]">{image}</Card> : <div className="overflow-hidden rounded-md border border-white/10 bg-black/25">{image}</div>}</figure>;
}

export function mediaImageCropStyle(asset: ContentMediaAssetDef): CSSProperties {
  const crop = asset.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = Math.max(crop.width, 0.01);
  const height = Math.max(crop.height, 0.01);
  return {
    width: `${100 / width}%`,
    height: `${100 / height}%`,
    left: `${(-crop.x / width) * 100}%`,
    top: `${(-crop.y / height) * 100}%`,
    objectFit: asset.fit ?? "cover",
  };
}
