import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

export const inputVariants = cva("", {
  variants: {
    font: {
      normal: "",
      retro: "retro",
    },
  },
  defaultVariants: {
    font: "retro",
  },
});

export interface BitInputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {
  asChild?: boolean;
}

function Input({ className, font, asChild: _asChild, ...props }: BitInputProps) {
  const fieldClasses = className
    ?.split(" ")
    .filter(
      (c) =>
        c.startsWith("text-") ||
        c.startsWith("font-") ||
        c.startsWith("leading-") ||
        c.startsWith("tracking-") ||
        c.startsWith("placeholder:") ||
        c.startsWith("disabled:") ||
        c === "uppercase" ||
        c === "lowercase" ||
        c === "normal-case"
    )
    .join(" ");

  return (
    <div
      className={cn(
        "relative flex items-center border-y-6 border-foreground !p-0 dark:border-ring",
        className
      )}
    >
      <input
        {...props}
        className={cn(
          "h-full w-full min-w-0 border-0 bg-transparent px-4 py-0 text-inherit outline-none ring-0 placeholder:text-current/55 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed",
          font !== "normal" && "retro",
          fieldClasses
        )}
      />

      <div
        className="absolute inset-0 border-x-6 -mx-1.5 border-foreground dark:border-ring pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}

export { Input };
