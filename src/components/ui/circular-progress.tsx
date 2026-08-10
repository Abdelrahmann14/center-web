// Circular progress ring (teal, RTL-neutral). Two modes:
//   value === null  → indeterminate: a quarter arc spins continuously.
//   value 0..100    → determinate: the arc fills clockwise.
// Used for file/photo uploads: since the HTTP client is fetch-based with no
// upload-progress events, uploads render the indeterminate mode and the ring is
// unmounted by the caller the moment the request resolves.
"use client";

import { motion, useReducedMotion } from "motion/react";

export type CircularProgressProps = {
  value?: number | null;
  size?: number;
  stroke?: number;
  className?: string;
};

export function CircularProgress({
  value = null,
  size = 40,
  stroke = 4,
  className = "",
}: CircularProgressProps) {
  const reduced = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = value === null;
  const fraction = indeterminate ? 0 : Math.min(1, Math.max(0, value / 100));

  return (
    <span
      className={`inline-grid place-items-center ${className}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { "aria-valuenow": Math.round(fraction * 100) })}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="col-start-1 row-start-1"
        style={{ transformOrigin: "center" }}
        animate={indeterminate && !reduced ? { rotate: 360 } : { rotate: 0 }}
        transition={
          indeterminate && !reduced
            ? { duration: 0.9, ease: "linear", repeat: Infinity }
            : { duration: 0 }
        }
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200/80"
        />
        {/* Arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent"
          strokeDasharray={circumference}
          // Indeterminate → fixed quarter arc; determinate → grows with value.
          initial={false}
          animate={{
            strokeDashoffset: indeterminate
              ? circumference * 0.72
              : circumference * (1 - fraction),
          }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 34 }}
          // Start the arc at 12 o'clock.
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </motion.svg>
    </span>
  );
}

export default CircularProgress;
