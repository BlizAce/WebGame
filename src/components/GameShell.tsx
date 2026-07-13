"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useGame } from "@/lib/game/GameContext";
import { useGameClock } from "@/lib/game/gameClock";
import { RACES } from "@/lib/game/races";
import {
  formatNaq,
  incomePerTurn,
  strikeAction,
  defenceAction,
  covertAction,
  antiCovertAction,
} from "@/lib/game/economy";
import { VectorStage } from "@/components/VectorStage";
import { RealmLink } from "@/components/RealmLink";
import { FACTIONS, allianceCombatBonus, allianceIncomeBonus, factionOf, getAlliance, guildFundIncome } from "@/lib/game/guilds";
import { STAGE_CAPTIONS, stageHullCaption, type StageMode } from "@/lib/gfx/stageThemes";
import { GuildLink } from "@/components/GuildLink";
import { AscensionLightning } from "@/components/AscensionLightning";

const NAV = [
  { href: "/play/command-center", label: "Command Center" },
  { href: "/play/rankings", label: "Rankings" },
  { href: "/play/attack", label: "Attack" },
  { href: "/play/attack-log", label: "Attack Log" },
  { href: "/play/armory", label: "Armory" },
  { href: "/play/mothership", label: "Mothership" },
  { href: "/play/training", label: "Training" },
  { href: "/play/technology", label: "Technology" },
  { href: "/play/planets", label: "Planets" },
  { href: "/play/guilds", label: "Guilds" },
  { href: "/play/war-room", label: "War Room" },
  { href: "/play/contracts", label: "Contracts" },
  { href: "/play/market", label: "Open Market" },
  { href: "/play/forum", label: "Forum" },
  { href: "/play/mail", label: "Mail" },
  { href: "/play/ascension", label: "Ascension" },
  { href: "/play/intelligence", label: "Intelligence" },
  { href: "/play/bank", label: "Bank / Vault" },
  { href: "/play/settings", label: "Settings" },
];

function formatCountdown(ms: number) {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function GameShell({
  children,
  stageMode = "command",
}: {
  children: ReactNode;
  stageMode?: StageMode;
}) {
  const pathname = usePathname();
  const { player, ready, save, mailUnread } = useGame();
  const { msToTurn, msToAiPulse } = useGameClock();

  if (!ready) {
    return (
      <div className="gw-loading">
        <div className="gw-loading-ring" aria-hidden />
        <span>Loading realm…</span>
      </div>
    );
  }

  if (!player) {
    return <>{children}</>;
  }

  const race = RACES[player.race];
  const aiOn = save?.settings.aiEnabled !== false;
  const pulses = save?.settings.aiPulsesPerHour ?? 8;
  const social = save ? allianceCombatBonus(player, save) : 1;
  const guild = save ? getAlliance(save, player.allianceId) : undefined;
  const faction = factionOf(player);

  return (
    <div
      className={`gw-shell min-h-screen${
        (player.ascensionLevel ?? 0) > 0 ? " is-ascended" : ""
      }`}
      style={
        {
          "--race-primary": race.colors.primary,
          "--race-glow": race.colors.glow,
          "--race-accent": race.colors.accent,
          "--race-secondary": race.colors.secondary,
        } as CSSProperties
      }
    >
      <div className="gw-grid">
        <aside className="gw-nav">
          <div className="gw-brand">
            <span className="gw-brand-mark">GW</span>
            <div>
              <div className="gw-brand-title">GateWars</div>
              <div className="gw-brand-sub">
                {(player.ascensionLevel ?? 0) > 0 && player.ascendedTitle
                  ? player.ascendedTitle
                  : race.name}
              </div>
            </div>
          </div>

          <div className="gw-hud">
            <HudRow
              label="Commander"
              value={<RealmLink realmId={player.id}>{player.name}</RealmLink>}
            />
            <HudRow
              label="Faction"
              value={FACTIONS[faction].name}
            />
            <HudRow
              label="Guild"
              value={
                guild ? (
                  <GuildLink allianceId={guild.id}>[{guild.tag}]</GuildLink>
                ) : (
                  "—"
                )
              }
            />
            <HudRow label="Naquadah" value={formatNaq(player.naquadah)} />
            <HudRow
              label={race.bankName}
              value={formatNaq(player.bankNaquadah)}
            />
            <HudRow label="Attack Turns" value={String(player.attackTurns)} />
            <HudRow label="Covert Cap" value={String(player.covertCapacity)} />
            <HudRow
              label="Income/turn"
              value={formatNaq(
                incomePerTurn(
                  player,
                  save?.planets ?? [],
                  save ? allianceIncomeBonus(player, save) : 1,
                ) + (save ? guildFundIncome(player, save) : 0),
              )}
            />
            <HudRow label="Next turn" value={formatCountdown(msToTurn)} />
            <HudRow
              label="G&R"
              value={formatNaq(player.gloryReputation ?? 0)}
            />
            <HudRow
              label="Ascension"
              value={`L${player.ascensionLevel ?? 0} · ${formatNaq(player.ascensionPoints ?? 0)} AP`}
            />
            <HudRow
              label="AI pulse"
              value={
                aiOn
                  ? `${formatCountdown(msToAiPulse)} (${pulses}/hr)`
                  : "off"
              }
            />
          </div>

          <nav className="gw-links">
            {NAV.map((item) => {
              const active = pathname === item.href;
              const label =
                item.href === "/play/mail" && mailUnread > 0
                  ? `Mail (${mailUnread})`
                  : item.label;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`gw-link ${active ? "is-active" : ""}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="gw-power">
            <div className="gw-power-title">Military</div>
            <HudRow
              label="Strike"
              value={formatNaq(strikeAction(player, save?.planets ?? [], social))}
            />
            <HudRow
              label="Defence"
              value={formatNaq(defenceAction(player, save?.planets ?? [], social))}
            />
            <HudRow label="Covert" value={formatNaq(covertAction(player))} />
            <HudRow label="Anti-Covert" value={formatNaq(antiCovertAction(player))} />
          </div>
        </aside>

        <main className="gw-main">
          <div
            className={`gw-stage ${
              stageMode === "battle" ||
              stageMode === "planets" ||
              stageMode === "mothership" ||
              stageMode === "war"
                ? "battle"
                : ""
            }`}
          >
            <VectorStage
              race={player.race}
              mode={stageMode}
              ascensionLevel={player.ascensionLevel ?? 0}
            />
            <AscensionLightning
              ascensionLevel={player.ascensionLevel ?? 0}
              glow={race.colors.glow}
              accent={race.colors.accent}
            />
            <div className="gw-stage-caption">
              {race.name}
              {(player.ascensionLevel ?? 0) > 0 && player.ascendedTitle
                ? ` · ${player.ascendedTitle}`
                : ""}
              {" · "}
              {STAGE_CAPTIONS[stageMode]}
              {(() => {
                const hull = stageHullCaption(player.ascensionLevel ?? 0);
                return hull ? ` · ${hull}` : "";
              })()}
            </div>
          </div>
          <div className="gw-panel">{children}</div>
        </main>
      </div>
    </div>
  );
}

function HudRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="gw-hud-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
