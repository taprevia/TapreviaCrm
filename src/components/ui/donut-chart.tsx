'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  total?: number;
  centerLabel?: string;
  className?: string;
}

const GAP_DEGREES = 2;

export function DonutChart({
  segments,
  size = 120,
  thickness = 12,
  total,
  centerLabel,
  className,
}: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const grandTotal = total ?? segments.reduce((sum, s) => sum + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = grandTotal > 0 ? (GAP_DEGREES / 360) * circumference : 0;

  let acc = 0;

  return (
    <div className={cn('inline-flex flex-col items-center gap-3', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={centerLabel ?? 'Distribution chart'}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={thickness} />
          {grandTotal > 0 &&
            segments.map((segment, i) => {
              const len = (segment.value / grandTotal) * circumference;
              const dash = Math.max(0, len - gap);
              const element = (
                <circle
                  key={segment.label}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={hovered === i ? thickness + 2 : thickness}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-acc}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <title>{`${segment.label}: ${segment.value.toLocaleString()}`}</title>
                </circle>
              );
              acc += len;
              return element;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-lg font-bold leading-none tabular-nums text-white">
              {grandTotal.toLocaleString()}
            </p>
            {centerLabel && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">
                {centerLabel}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2">
        {segments.map((segment) => {
          const pct = grandTotal > 0 ? (segment.value / grandTotal) * 100 : 0;
          return (
            <div key={segment.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="truncate text-sm text-ink-mute">{segment.label}</span>
              <span className="ml-auto text-sm tabular-nums text-ink">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
