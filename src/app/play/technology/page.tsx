"use client";

import { useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import {
  ensureTech,
  formatNaq,
  TECH_BRANCH_META,
  techBranchCost,
  type TechBranch,
} from "@/lib/game/economy";

const BRANCHES: TechBranch[] = [
  "general",
  "mining",
  "offence",
  "defence",
  "covert",
  "equipment",
];

export default function TechnologyPage() {
  return (
    <PlayGate stageMode="tech">
      <Technology />
    </PlayGate>
  );
}

function Technology() {
  const { player, upgradeTechBranch, upgradeTechBranchMax } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  if (!player) return null;
  const tech = ensureTech(player);

  return (
    <>
      <h1 className="gw-title">Technology</h1>
      <p className="gw-lead">
        Research branching tech to boost mining income, unit power, covert ops,
        and unlock better equipment. Each track is permanent.
      </p>
      <div className="gw-card">
        <h2>Research branches</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {BRANCHES.map((branch) => {
            const meta = TECH_BRANCH_META[branch];
            const level = tech[branch];
            const cost = techBranchCost(branch, level);
            return (
              <div
                key={branch}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "0.75rem",
                  alignItems: "center",
                  padding: "0.75rem",
                  borderRadius: 10,
                  border: "1px solid var(--gw-border)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-display)", letterSpacing: "0.06em" }}>
                    {meta.label} · Lv {level}
                  </div>
                  <div style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
                    {meta.blurb}
                  </div>
                  <div style={{ color: "var(--gw-muted)", fontSize: "0.8rem", marginTop: 4 }}>
                    Next: {formatNaq(cost)} Naq
                  </div>
                </div>
                <div className="gw-row">
                  <button
                    type="button"
                    className="gw-btn"
                    onClick={() => {
                      const err = upgradeTechBranch(branch);
                      setMsg(err ?? `${meta.label} → ${level + 1}`);
                    }}
                  >
                    Research +1
                  </button>
                  <button
                    type="button"
                    className="gw-btn gw-btn-ghost"
                    onClick={() => {
                      const { count, error } = upgradeTechBranchMax(branch, 10);
                      setMsg(
                        count > 0
                          ? `${meta.label} +${count}`
                          : error ?? "Could not research",
                      );
                    }}
                  >
                    Buy Max
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {msg && <div className="gw-msg">{msg}</div>}
      </div>
    </>
  );
}
