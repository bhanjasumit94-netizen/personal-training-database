"use client";

import {
  motion,
  useScroll,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
  cubicBezier,
} from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Curated editorial portrait set used as the default `images` for {@link ScrollTiltedGrid}.
 * Replaced with Unsplash portrait photos that are stable, freely-redistributable
 * demo images (so the file works fully offline-friendly on any CDN).
 */
export const DEFAULT_GRID_IMAGES: readonly string[] = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1531123897727-8f129e08e72f?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1488161628813-04466f872be2?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1517638851339-bcc6b9a4c6cf?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1542206395-9feb3edaa68d?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1543132220-3ec99c6094dc?w=800&q=80&auto=format&fit=crop",
];

const easeIntoFocus = cubicBezier(0.22, 1, 0.36, 1);
const easeOutOfFocus = cubicBezier(0, 0, 0.58, 1);
const focusEase: [typeof easeIntoFocus, typeof easeOutOfFocus] = [
  easeIntoFocus,
  easeOutOfFocus,
];

export type MaxWidthToken =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "none";

export type GapToken = 4 | 6 | 8 | 10 | 12 | 14;

const MAX_WIDTH_CLASS: Record<MaxWidthToken, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  none: "",
};

const GAP_CLASS: Record<GapToken, string> = {
  4: "gap-4",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
  14: "gap-14",
};

type Side = "L" | "R";

type TileConfig = {
  aspectRatio: string;
  perspective: number;
  maxTilt: number;
  maxBlur: number;
  rounded: string;
};

function Tile({
  src,
  side,
  config,
}: {
  src: string;
  side: Side;
  config: TileConfig;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const reduce = useReducedMotion();
  const sign = side === "L" ? -1 : 1;
  const { aspectRatio, perspective, maxTilt, maxBlur, rounded } = config;

  const blur     = useTransform(p, [0, 0.5, 1], [maxBlur, 0, maxBlur], { ease: focusEase });
  const bright   = useTransform(p, [0, 0.5, 1], [0, 1, 0],             { ease: focusEase });
  const contrast = useTransform(p, [0, 0.5, 1], [4, 1, 4],             { ease: focusEase });

  const ty = useTransform(p, [0, 0.5, 1], ["100%", "0%", "-100%"], { ease: focusEase });
  const tz = useTransform(p, [0, 0.5, 1], [300, 0, 300],           { ease: focusEase });
  const rx = useTransform(p, [0, 0.5, 1], [maxTilt, 0, -maxTilt],  { ease: focusEase });

  const tx = useTransform(p, [0, 0.5, 1],
    [`${sign * 40}%`, "0%", `${sign * 40}%`], { ease: focusEase });
  const rot = useTransform(p, [0, 0.5, 1], [-sign * 5, 0, sign * 5],   { ease: focusEase });
  const sk  = useTransform(p, [0, 0.5, 1], [sign * 20, 0, -sign * 20], { ease: focusEase });

  const innerSY = useTransform(p, [0, 0.5, 1], [1.8, 1, 1.8], { ease: focusEase });

  const filter = useMotionTemplate`blur(${blur}px) brightness(${bright}) contrast(${contrast})`;

  if (reduce) {
    return (
      <figure ref={ref} className="relative z-10 m-0">
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio, borderRadius: rounded }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${src}")` }}
          />
        </div>
      </figure>
    );
  }

  return (
    <motion.figure
      ref={ref}
      className="relative z-10 m-0"
      style={{ perspective, willChange: "transform" }}
    >
      <motion.div
        className="relative w-full overflow-hidden will-change-[filter,transform]"
        style={{
          aspectRatio,
          borderRadius: rounded,
          filter,
          x: tx,
          y: ty,
          z: tz,
          rotate: rot,
          rotateX: rx,
          skewX: sk,
        }}
      >
        <motion.div
          className="absolute inset-0 bg-cover bg-center will-change-transform"
          style={{
            backgroundImage: `url("${src}")`,
            scaleY: innerSY,
            backfaceVisibility: "hidden",
          }}
        />
      </motion.div>
    </motion.figure>
  );
}

export type ScrollTiltedGridProps = {
  /** Image URLs to render. Falls back to {@link DEFAULT_GRID_IMAGES}. */
  images?: readonly string[];
  /**
   * Cycle the source list and append more pairs as the user nears the bottom —
   * a perceptually infinite scroll. Default `false`.
   */
  loop?: boolean;
  /** Initial number of cycles to render when `loop` is on. Default `3`. */
  initialCycles?: number;
  /** CSS `aspect-ratio` value for each tile, e.g. `"3/4"`, `"2/3"`. Default `"3/4"`. */
  aspectRatio?: string;
  /** Tailwind `max-w-*` token controlling the column width. Default `"lg"`. */
  maxWidth?: MaxWidthToken;
  /** Tailwind `gap-*` token between tiles. Default `10`. */
  gap?: GapToken;
  /** CSS `perspective` in pixels applied to each tile. Default `900`. */
  perspective?: number;
  /**
   * Maximum `rotateX` tilt magnitude (in degrees) at the entry and exit poses.
   * Symmetric — entry tilts forward `+maxTilt`, exit tilts back `-maxTilt`.
   * Default `70`.
   */
  maxTilt?: number;
  /** Maximum blur (px) at the entry and exit poses. Default `8`. */
  maxBlur?: number;
  /**
   * CSS `border-radius` for the tile clipping mask. Accepts any CSS length value
   * (`"0.375rem"`, `"12px"`, `"1rem"`). Default `"0.375rem"` (Tailwind `rounded-md`).
   */
  rounded?: string;
  /** Additional className applied to the outer `<section>`. */
  className?: string;
};

/**
 * Editorial scroll-tilted image grid. Pairs of images rise from below tipped
 * forward, settle into a clean focus, then tilt back over the top edge as they
 * exit. Optionally loops infinitely via an IntersectionObserver-driven append.
 */
export function ScrollTiltedGrid({
  images = DEFAULT_GRID_IMAGES,
  loop = false,
  initialCycles = 3,
  aspectRatio = "3/4",
  maxWidth = "lg",
  gap = 10,
  perspective = 900,
  maxTilt = 70,
  maxBlur = 8,
  rounded = "0.375rem",
  className,
}: ScrollTiltedGridProps = {}) {
  const [cycles, setCycles] = useState(loop ? initialCycles : 1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loop) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCycles((c) => c + 2);
        }
      },
      { rootMargin: "1500px 0px 1500px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loop]);

  const items = useMemo(
    () =>
      loop
        ? Array.from({ length: cycles }, () => images).flat()
        : [...images],
    [loop, cycles, images],
  );

  const config = useMemo<TileConfig>(
    () => ({ aspectRatio, perspective, maxTilt, maxBlur, rounded }),
    [aspectRatio, perspective, maxTilt, maxBlur, rounded],
  );

  const gridClass = [
    "mx-auto mt-[20vh] mb-[10vh] grid w-full grid-cols-2 px-6 py-[20vh]",
    MAX_WIDTH_CLASS[maxWidth],
    GAP_CLASS[gap],
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={["relative w-full", className].filter(Boolean).join(" ")}
    >
      <div className={gridClass}>
        {items.map((src, i) => (
          <Tile
            key={`${i}-${src}`}
            src={src}
            side={i % 2 === 0 ? "L" : "R"}
            config={config}
          />
        ))}
      </div>
      {loop ? (
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      ) : null}
    </section>
  );
}
