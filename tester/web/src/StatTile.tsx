import type { ReactNode } from "react";

export type StatTone = "default" | "ok" | "bad" | "muted";
export type StatSize = "lg" | "xl";

export type StatTileProps = {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  size?: StatSize;
};

export function StatTile({ label, value, tone = "default", size = "lg" }: StatTileProps) {
  return (
    <div className={`stat-tile stat-tile-${size}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value tone-${tone}`}>{value}</div>
    </div>
  );
}
