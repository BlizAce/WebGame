"use client";

import { useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import {
  bankCapacity,
  bankUpgradeCost,
  depositFeeRate,
  formatNaq,
} from "@/lib/game/economy";

export default function BankPage() {
  return (
    <PlayGate stageMode="bank">
      <Bank />
    </PlayGate>
  );
}

function Bank() {
  const { player, save, deposit, withdraw, upgradeBank } = useGame();
  const [amount, setAmount] = useState(100);
  const [msg, setMsg] = useState<string | null>(null);
  if (!player || !save) return null;
  const race = RACES[player.race];
  const fee = depositFeeRate(player.race);
  const planets = save.planets ?? [];
  const cap = bankCapacity(player, planets);
  const room = Math.max(0, cap - player.bankNaquadah);
  const maxDepositGross = (() => {
    if (room <= 0) return 0;
    const rate = 1 - fee;
    const needed = Math.ceil(room / (rate > 0 ? rate : 1));
    return Math.min(player.naquadah, needed);
  })();

  return (
    <>
      <h1 className="gw-title">{race.bankName}</h1>
      <p className="gw-lead">
        Protected Naquadah cannot be stolen on attack.{" "}
        {fee === 0
          ? "Your race banks free of charge."
          : `Deposit fee: ${(fee * 100).toFixed(0)}%.`}
      </p>

      <div className="gw-card">
        <h2>Vault status</h2>
        <div className="gw-stats">
          <div className="gw-stat">
            <span>Open Naq</span>
            <strong>{formatNaq(player.naquadah)}</strong>
          </div>
          <div className="gw-stat">
            <span>Banked</span>
            <strong>{formatNaq(player.bankNaquadah)}</strong>
          </div>
          <div className="gw-stat">
            <span>Capacity</span>
            <strong>{formatNaq(cap)}</strong>
          </div>
          <div className="gw-stat">
            <span>Bank level</span>
            <strong>{player.bankLevel}</strong>
          </div>
        </div>
      </div>

      <div className="gw-card">
        <h2>Transfer</h2>
        <div className="gw-field" style={{ maxWidth: 200, marginBottom: "0.75rem" }}>
          <label htmlFor="amt">Amount</label>
          <input
            id="amt"
            className="gw-input"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              const err = deposit(amount);
              setMsg(err ?? `Deposited ${amount} (fee applied if any)`);
            }}
          >
            Deposit
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={maxDepositGross < 1}
            onClick={() => {
              const err = deposit(maxDepositGross);
              setMsg(
                err ?? `Deposited max ${formatNaq(maxDepositGross)} toward capacity`,
              );
            }}
          >
            Deposit Max ({formatNaq(maxDepositGross)})
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() => {
              const err = withdraw(amount);
              setMsg(err ?? `Withdrew ${amount}`);
            }}
          >
            Withdraw
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={player.bankNaquadah < 1}
            onClick={() => {
              const err = withdraw(player.bankNaquadah);
              setMsg(err ?? "Withdrew all banked Naq");
            }}
          >
            Withdraw Max
          </button>
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              const err = upgradeBank();
              setMsg(
                err ??
                  `Bank upgraded (cost ${formatNaq(bankUpgradeCost(player.bankLevel))} Naq)`,
              );
            }}
          >
            Upgrade vault ({formatNaq(bankUpgradeCost(player.bankLevel))} Naq)
          </button>
        </div>
        {msg && <div className="gw-msg">{msg}</div>}
      </div>
    </>
  );
}
