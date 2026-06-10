"use client";

import { useState } from "react";
import type { ImpactOutput, EngineerImpact } from "@/scripts/score-impact";
import { ThemeToggle } from "./ThemeToggle";

// ─── Types ────────────────────────────────────────────────────────────────

type DimKey = "productImpact" | "orgLeverage" | "reliabilityQuality" | "ownershipComplexity";
type Lens = "all" | DimKey;

const DIMS: DimKey[] = ["productImpact", "orgLeverage", "reliabilityQuality", "ownershipComplexity"];

const DIM_LABEL: Record<DimKey, string> = {
  productImpact:       "Product Impact",
  orgLeverage:         "Org Leverage",
  reliabilityQuality:  "Reliability & Quality",
  ownershipComplexity: "Ownership & Complexity",
};

const WEIGHTS: Record<DimKey, string> = {
  productImpact:       "40%",
  orgLeverage:         "30%",
  reliabilityQuality:  "20%",
  ownershipComplexity: "10%",
};

const LENS_TABS: { id: Lens; label: string }[] = [
  { id: "all",                label: "Overall" },
  { id: "productImpact",      label: "Product" },
  { id: "orgLeverage",        label: "Org Leverage" },
  { id: "reliabilityQuality", label: "Reliability" },
  { id: "ownershipComplexity",label: "Ownership" },
];

const DIM_WHAT: Record<DimKey, string> = {
  productImpact:       "Shipped meaningful product work",
  orgLeverage:         "Helped others ship through reviews & collaboration",
  reliabilityQuality:  "Reduced bugs, risk, tech debt, or instability",
  ownershipComplexity: "Took on ambiguous or cross-system work",
};

const FORMULA: Record<DimKey, string> = {
  productImpact:
    "Feature/product PRs × 3 + PRs closing tracked issues × 2 + core-area PRs × 1. " +
    "chore: and revert: prefixes excluded regardless of keywords inside the title.",
  orgLeverage:
    "APPROVED / CHANGES_REQUESTED reviews on other engineers' PRs × 2 × complexity weight (0.5–1.0 by PR size). " +
    "Bonus: log₂(distinct colleagues reviewed + 1) × 2.",
  reliabilityQuality:
    "Bug fixes × 2 + real test file additions × 1.5 + performance work × 1.5 + refactors × 1 + " +
    "schema migrations × 1 + CI × 0.5. A PR can score across multiple sub-categories.",
  ownershipComplexity:
    "Cross-stack PRs (frontend + backend) × 2 + migration/schema PRs × 1.5 + infra × 1 + " +
    "per-PR file breadth capped at 30 files.",
};

function sortByLens(engineers: EngineerImpact[], lens: Lens): EngineerImpact[] {
  if (lens === "all") return engineers;
  return [...engineers].sort((a, b) => b.breakdown[lens].score - a.breakdown[lens].score);
}

// ─── Per-engineer avatar color (deterministic, consistent across renders) ──
const AVATAR_PALETTE = [
  "#5E6AD2", // indigo
  "#7C3AED", // violet
  "#2563EB", // blue
  "#0891B2", // cyan
  "#059669", // emerald
  "#D97706", // amber
  "#DC2626", // red
  "#DB2777", // pink
];

function avatarColor(login: string): string {
  let h = 0;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(login: string): string {
  const parts = login.replace(/[-_]/g, " ").split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// Per-dimension accent colors — subtle differentiation without going rainbow
const DIM_COLOR: Record<DimKey, string> = {
  productImpact:       "#5E6AD2", // indigo
  orgLeverage:         "#7C3AED", // violet
  reliabilityQuality:  "#2563EB", // blue
  ownershipComplexity: "#0891B2", // cyan
};

// ─── Icons ────────────────────────────────────────────────────────────────

function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconGitPR() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
      <path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}
function IconStar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  );
}
function IconExternalLink() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ─── Stat card (top row) ──────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5 transition-all duration-200"
      style={{ background: "var(--canvas)", borderColor: "var(--rim)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${color}55`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--rim)"; }}
    >
      {/* Icon circle */}
      <div
        className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: "var(--text-1)" }}>{value}</p>
      <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>{sub}</p>
      {/* Corner glow in card's own accent color */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-3xl"
        style={{ background: color, opacity: 0.07 }}
      />
      {/* Bottom accent line */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-full"
        style={{ background: `linear-gradient(90deg, ${color}60, transparent)` }}
      />
    </div>
  );
}

// ─── Dimension bar ────────────────────────────────────────────────────────

function DimBar({ score, delay = 0 }: { score: number; delay?: number }) {
  return (
    <div className="h-px w-full overflow-hidden rounded-full" style={{ background: "var(--rim)" }}>
      <div
        style={{
          width: `${score}%`,
          background: "var(--accent)",
          opacity: 0.7,
          transformOrigin: "left",
          height: "100%",
          transition: "width 400ms cubic-bezier(0.16,1,0.3,1)",
          animation: `growBar 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms both`,
        }}
      />
    </div>
  );
}

// ─── Left panel: engineer list item ──────────────────────────────────────

function EngineerRow({
  eng, rank, isSelected, onClick, lens,
}: {
  eng: EngineerImpact; rank: number; isSelected: boolean; onClick: () => void; lens: Lens;
}) {
  const score  = lens === "all" ? eng.overallScore : eng.breakdown[lens].score;
  const color  = avatarColor(eng.login);
  const abbr   = initials(eng.login);
  const dimColor = DIM_COLOR[eng.strongestDimension as DimKey];

  return (
    <button onClick={onClick} className="group w-full text-left">
      <div
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150"
        style={{
          background: isSelected ? `${color}12` : "transparent",
          borderLeft: `3px solid ${isSelected ? color : "transparent"}`,
        }}
      >
        {/* Avatar with initials */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}40`,
          }}
        >
          {abbr}
        </div>

        {/* Name + strongest dimension */}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium transition-colors duration-150"
            style={{ color: isSelected ? "var(--text-1)" : "var(--text-2)" }}
          >
            {eng.login}
          </p>
          <div className="mt-0.5 flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: dimColor }}
            />
            <span className="truncate text-[11px]" style={{ color: "var(--text-3)" }}>
              {DIM_LABEL[eng.strongestDimension as DimKey]}
            </span>
          </div>
        </div>

        {/* Score pill */}
        <span
          className="shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums"
          style={isSelected
            ? { background: `${color}20`, color }
            : { color: "var(--text-3)" }
          }
        >
          {score}
        </span>
      </div>
    </button>
  );
}

// ─── Right panel: detail ──────────────────────────────────────────────────

function DetailPanel({ eng, lens }: { eng: EngineerImpact; lens: Lens }) {
  const displayScore = lens === "all" ? eng.overallScore : eng.breakdown[lens].score;
  const scoreLabel  = lens === "all" ? "Overall Score" : DIM_LABEL[lens];
  const strongest   = eng.strongestDimension as DimKey;
  const engColor    = avatarColor(eng.login);
  const engAbbr     = initials(eng.login);

  const allSignals = [
    ...eng.breakdown.productImpact.signals,
    ...eng.breakdown.orgLeverage.signals,
    ...eng.breakdown.reliabilityQuality.signals,
    ...eng.breakdown.ownershipComplexity.signals,
  ].filter((s, i, a) => a.indexOf(s) === i);

  return (
    <div
      className="flex flex-col gap-6 overflow-hidden rounded-xl border transition-all duration-200"
      style={{ background: "var(--canvas)", borderColor: engColor + "44" }}
    >
      {/* Colored header band */}
      <div
        className="relative flex items-start justify-between gap-4 px-6 pt-6 pb-5"
        style={{
          borderBottom: `1px solid ${engColor}25`,
          background: `linear-gradient(135deg, ${engColor}10 0%, transparent 60%)`,
        }}
      >
        <div className="flex items-start gap-4 min-w-0">
          {/* Large avatar */}
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold"
            style={{
              background: `${engColor}20`,
              color: engColor,
              border: `1.5px solid ${engColor}50`,
            }}
          >
            {engAbbr}
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`https://github.com/${eng.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5"
              >
                <span
                  className="text-xl font-semibold transition-colors duration-150 group-hover:underline"
                  style={{ color: "var(--text-1)" }}
                >
                  {eng.login}
                </span>
                <span style={{ color: "var(--text-3)" }} className="opacity-0 transition-opacity group-hover:opacity-100">
                  <IconExternalLink />
                </span>
              </a>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: `${DIM_COLOR[strongest]}20`, color: DIM_COLOR[strongest] }}
              >
                ↑ {DIM_LABEL[strongest]}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
              {eng.explanation}
            </p>
          </div>
        </div>
        {/* Score circle — uses engineer's own color */}
        <div
          className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border"
          style={{
            background: `${engColor}12`,
            borderColor: `${engColor}35`,
          }}
        >
          <span className="text-2xl font-bold tabular-nums" style={{ color: engColor }}>
            {displayScore}
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
            {lens === "all" ? "overall" : "dimension"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-6 px-6 pb-6">

      {/* Dimension breakdown */}
      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
          {scoreLabel} Breakdown
        </p>
        <div className="space-y-3.5">
          {DIMS.map((key, i) => {
            const score = eng.breakdown[key].score;
            const isStrongest = key === strongest;
            const dc = DIM_COLOR[key];
            return (
              <div key={key}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* Per-dimension color dot */}
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dc }} />
                    <span
                      className="text-xs"
                      style={{ color: isStrongest ? "var(--text-1)" : "var(--text-2)", fontWeight: isStrongest ? 500 : 400 }}
                    >
                      {DIM_LABEL[key]}
                    </span>
                    {isStrongest && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                        style={{ background: `${dc}20`, color: dc }}
                      >
                        strongest
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <span
                      className="font-mono text-sm tabular-nums"
                      style={{ color: isStrongest ? dc : "var(--text-2)", fontWeight: isStrongest ? 600 : 400 }}
                    >
                      {score}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-3)" }}>/100</span>
                  </div>
                </div>
                {/* Bar uses this dimension's own color */}
                <div className="h-px w-full overflow-hidden rounded-full" style={{ background: "var(--rim)" }}>
                  <div
                    style={{
                      width: `${score}%`,
                      background: dc,
                      opacity: 0.65,
                      transformOrigin: "left",
                      height: "100%",
                      transition: "width 400ms cubic-bezier(0.16,1,0.3,1)",
                      animation: `growBar 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 60}ms both`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evidence + PRs side by side on large screens */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Evidence */}
        {allSignals.length > 0 && (
          <div>
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
              Supporting Evidence
            </p>
            <ul className="space-y-1.5">
              {allSignals.map((s) => (
                <li key={s} className="flex items-start gap-2 text-xs" style={{ color: "var(--text-2)" }}>
                  <span className="mt-px shrink-0" style={{ color: "var(--text-3)" }}>›</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Representative PRs */}
        {eng.representativePRs.length > 0 && (
          <div>
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
              Representative Work
            </p>
            <div className="space-y-2">
              {eng.representativePRs.map((pr) => (
                <a
                  key={pr.url}
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-all duration-150"
                  style={{
                    borderColor: "var(--rim)",
                    background: "var(--surface)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(94,106,210,0.4)";
                    (e.currentTarget as HTMLElement).style.background = "var(--canvas-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--rim)";
                    (e.currentTarget as HTMLElement).style.background = "var(--surface)";
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-xs font-medium transition-colors duration-150 group-hover:text-[var(--accent)]"
                      style={{ color: "var(--text-1)" }}
                    >
                      {pr.title}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>{pr.reason}</p>
                  </div>
                  <span className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--text-3)" }}>
                    <IconExternalLink />
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      </div>{/* end body */}
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border transition-colors duration-150" style={{ borderColor: "var(--rim)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors duration-150"
        style={{ background: open ? "var(--canvas)" : "transparent" }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = "var(--canvas-hover)"; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{title}</span>
        <span style={{ color: "var(--text-3)" }}><IconChevron open={open} /></span>
      </button>
      {open && (
        <div className="border-t px-5 py-5" style={{ borderColor: "var(--rim)", background: "var(--canvas)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────

export function Dashboard({ data }: { data: ImpactOutput }) {
  const [lens, setLens] = useState<Lens>("all");
  const [selectedLogin, setSelectedLogin] = useState(data.engineers[0]?.login ?? "");

  const sorted = sortByLens(data.engineers, lens);
  const selectedEng = sorted.find((e) => e.login === selectedLogin) ?? sorted[0];

  const top5  = sorted.slice(0, 5);
  const rest  = sorted.slice(5);

  return (
    <div className="min-h-screen transition-colors duration-200" style={{ background: "var(--surface)" }}>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6">

        {/* ── Header ── */}
        <header className="mb-8 pb-6" style={{ borderBottom: "1px solid var(--rim)" }}>
          <div className="flex items-start justify-between gap-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
              PostHog · Engineering Intelligence
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className="rounded-full border px-3 py-1 text-[11px]"
                style={{ borderColor: "var(--rim)", background: "var(--surface)", color: "var(--text-3)" }}
              >
                {data.daysAnalyzed < 80 ? "⚠ Partial" : "✓ Complete"} · {data.totalPRsAnalyzed.toLocaleString()} PRs · {data.daysAnalyzed} of 90 days
              </span>
              <ThemeToggle />
            </div>
          </div>
          <div className="mt-3 border-b pb-5" style={{ borderColor: "var(--rim)" }}>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[32px]" style={{ color: "var(--text-1)" }}>
              Engineering Impact Dashboard
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
              Identifying the engineers driving the greatest product, quality, and organisational outcomes at PostHog.
            </p>
          </div>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            Engineering impact is more than output. The most valuable engineers don&apos;t just ship code —
            they drive product outcomes, improve reliability, unblock teammates, and take ownership of complex problems.
            This dashboard analyses merged pull requests from the last 90 days to identify the engineers creating
            the greatest organisational impact at PostHog.
          </p>
        </header>

        {/* ── Stat cards ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<IconUsers />}
            label="Engineers Analysed"
            value={String(data.totalEngineersFound)}
            sub={`across ${data.daysAnalyzed}-day window`}
            color="#5E6AD2"
          />
          <StatCard
            icon={<IconGitPR />}
            label="Merged PRs"
            value={data.totalPRsAnalyzed.toLocaleString()}
            sub={data.enrichedPRCount ? `${data.enrichedPRCount} enriched with file paths` : "human-authored, bots excluded"}
            color="#7C3AED"
          />
          <StatCard
            icon={<IconCalendar />}
            label="Data Window"
            value={`${data.daysAnalyzed} days`}
            sub={`${new Date(data.windowStart).toLocaleDateString()} – ${new Date(data.windowEnd).toLocaleDateString()}`}
            color="#2563EB"
          />
          <StatCard
            icon={<IconStar />}
            label="Top Impact Score"
            value={`${data.engineers[0]?.overallScore ?? "—"} / 100`}
            sub={data.engineers[0]?.login ?? "—"}
            color="#0891B2"
          />
        </div>

        {/* ── Impact methodology ── */}
        <div
          className="mb-6 rounded-xl border px-5 py-5"
          style={{ background: "var(--canvas)", borderColor: "var(--rim)" }}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
            Impact Definition
          </p>
          <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            I define engineering impact as the extent to which an engineer helps the team ship meaningful product outcomes,
            improves the quality and reliability of the system, and increases the leverage of other engineers.
          </p>

          {/* Scoring table */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {DIMS.map((key) => (
              <div
                key={key}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                style={{ background: "var(--surface)" }}
              >
                <span
                  className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: DIM_COLOR[key] }}
                />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                      {DIM_LABEL[key]}
                    </span>
                    <span
                      className="rounded-full px-1.5 py-px text-[10px] font-semibold"
                      style={{ background: `${DIM_COLOR[key]}18`, color: DIM_COLOR[key] }}
                    >
                      {WEIGHTS[key]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-3)" }}>
                    {DIM_WHAT[key]}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Caveat note */}
          <div
            className="flex items-start gap-2.5 rounded-lg px-3.5 py-3"
            style={{ background: "rgba(94,106,210,0.06)", border: "1px solid rgba(94,106,210,0.18)" }}
          >
            <span className="mt-px shrink-0 text-xs" style={{ color: "var(--accent)" }}>ℹ</span>
            <div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                GitHub data is imperfect, so I use it as evidence of qualitative engineering behaviors rather than as a
                direct measure of value. The dashboard ranks engineers based on observable contribution patterns, then
                shows representative PRs so the results can be validated.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
                <strong style={{ color: "var(--text-2)" }}>Data strategy:</strong>{" "}
                Title, label, and linked-issue signals are collected for 100% of merged PRs.
                File paths (for area classification and cross-stack detection) are enriched for a representative sample
                of each active engineer&apos;s work. Review signals are captured via per-engineer{" "}
                <code className="rounded px-1 text-[10px]" style={{ background: "var(--surface)", color: "var(--accent)" }}>reviewed-by:</code>{" "}
                queries, covering all active contributors within the single-hour GraphQL budget.
              </p>
            </div>
          </div>
        </div>

        {/* ── Lens tabs ── */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Sort by</span>
          {LENS_TABS.map((tab) => {
            const isActive = lens === tab.id;
            const dimColor = tab.id !== "all" ? DIM_COLOR[tab.id as DimKey] : "#5E6AD2";
            return (
              <button
                key={tab.id}
                onClick={() => setLens(tab.id)}
                className="relative rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 active:scale-95"
                style={isActive
                  ? {
                      background: `${dimColor}22`,
                      color: dimColor,
                      border: `1.5px solid ${dimColor}80`,
                      boxShadow: `0 0 0 3px ${dimColor}18`,
                    }
                  : {
                      background: "var(--canvas)",
                      color: "var(--text-2)",
                      border: "1.5px solid var(--rim)",
                    }
                }
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.borderColor = `${dimColor}60`;
                    (e.currentTarget as HTMLElement).style.color = dimColor;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--rim)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-2)";
                  }
                }}
              >
                {isActive && (
                  <span
                    className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: dimColor }}
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Split layout: list + detail ── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">

          {/* Left: engineer list */}
          <div className="w-full rounded-xl border lg:w-64 lg:shrink-0 xl:w-72"
            style={{ background: "var(--canvas)", borderColor: "var(--rim)" }}>
            <div className="border-b px-4 py-3" style={{ borderColor: "var(--rim)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                Top {top5.length} Engineers
              </p>
            </div>
            <div className="p-2">
              {top5.map((eng, i) => (
                <EngineerRow
                  key={eng.login}
                  eng={eng}
                  rank={i + 1}
                  isSelected={selectedLogin === eng.login}
                  onClick={() => setSelectedLogin(eng.login)}
                  lens={lens}
                />
              ))}
            </div>

            {rest.length > 0 && (
              <>
                <div className="border-t px-4 py-3" style={{ borderColor: "var(--rim)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                    Also Notable
                  </p>
                </div>
                <div className="p-2 pb-3">
                  {rest.map((eng, i) => (
                    <EngineerRow
                      key={eng.login}
                      eng={eng}
                      rank={i + 6}
                      isSelected={selectedLogin === eng.login}
                      onClick={() => setSelectedLogin(eng.login)}
                      lens={lens}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: detail panel */}
          <div className="min-w-0 flex-1">
            {selectedEng && <DetailPanel eng={selectedEng} lens={lens} />}
          </div>
        </div>

        {/* ── Bottom collapsibles ── */}
        <div className="mt-6 space-y-2">
          <Collapsible title="Scoring formula detail">
            <div className="grid gap-3 sm:grid-cols-2">
              {DIMS.map((key) => (
                <div key={key} className="rounded-lg p-3" style={{ background: "var(--surface)" }}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full self-center" style={{ background: DIM_COLOR[key] }} />
                    <span className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>{DIM_LABEL[key]}</span>
                    <span className="text-[10px]" style={{ color: "var(--accent)" }}>{WEIGHTS[key]}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>{FORMULA[key]}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
              Each dimension is normalised 0–100 across the cohort with{" "}
              <code className="rounded px-1 text-[11px]" style={{ background: "var(--canvas)", color: "var(--accent)" }}>sqrt()</code>
              {" "}applied to dampen volume effects, then combined at the weights above. Every number is traceable to specific PRs in the GitHub repository.
            </p>
          </Collapsible>

        </div>

        {/* ── Footer ── */}
        <footer className="mt-6 border-t pt-5 text-[11px]" style={{ borderColor: "var(--rim)", color: "var(--text-3)" }}>
          Data sourced from{" "}
          <a href="https://github.com/PostHog/posthog" target="_blank" rel="noopener noreferrer"
            className="transition-colors duration-150 hover:underline"
            style={{ color: "var(--text-2)" }}>
            github.com/PostHog/posthog
          </a>{" "}
          via the GitHub GraphQL API · Generated {new Date(data.generatedAt).toLocaleDateString()}
        </footer>
      </div>
    </div>
  );
}
