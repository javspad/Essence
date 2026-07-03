import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";

interface ArcadeShellProps {
  title: ReactNode;
  kicker: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function ArcadeShell({ title, kicker, children, badge, className = "" }: ArcadeShellProps) {
  return (
    <section className={`mx-auto flex w-full max-w-xl flex-col items-center p-4 sm:p-6 ${className}`}>
      <Card font="normal" className="w-full border-[#fff4bf] bg-[#171120]/94 text-[#fff8d6] shadow-[0_20px_60px_rgb(0_0_0/0.38)]">
        <CardHeader font="normal" className="gap-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <p className="retro text-[10px] uppercase text-[#c7bddc]">{kicker}</p>
            {badge && (
              <Badge className="border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] uppercase text-[#062116]">
                {badge}
              </Badge>
            )}
          </div>
          <CardTitle font="normal" className="text-pretty text-2xl font-black leading-tight text-[#fff8d6] sm:text-3xl">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent font="normal" className="flex flex-col gap-5">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
