"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { MarketPriceChart } from "@/components/MarketPriceChart";
import { useGame } from "@/lib/game/GameContext";
import { formatNaq, MAX_ATTACK_TURNS } from "@/lib/game/economy";
import {
  COMMODITY_LABEL,
  ensureMarket,
  fairBasePrice,
  galaxyResourceStats,
  marketBoard,
  quoteTrade,
} from "@/lib/game/market";
import type { MarketCommodity, MarketSide } from "@/lib/db/schema";

export default function MarketPage() {
  return (
    <PlayGate stageMode="market">
      <Market />
    </PlayGate>
  );
}

function Market() {
  const { save, player, marketTrade } = useGame();
  const [commodity, setCommodity] = useState<MarketCommodity>("untrained");
  const [side, setSide] = useState<MarketSide>("sell");
  const [qty, setQty] = useState(25);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const board = useMemo(() => {
    if (!save) return [];
    return marketBoard(save);
  }, [save]);

  const stats = useMemo(() => {
    if (!save) return null;
    return galaxyResourceStats(save);
  }, [save]);

  const quote = useMemo(() => {
    if (!save) return null;
    ensureMarket(save);
    return quoteTrade(save, commodity, side, qty);
  }, [save, commodity, side, qty]);

  const trades = useMemo(() => {
    if (!save?.market?.trades) return [];
    return save.market.trades.slice(0, 24);
  }, [save]);

  const priceHistory = useMemo(() => {
    if (!save?.market) return [];
    return save.market.priceHistory ?? [];
  }, [save]);

  if (!player || !save || !stats) return null;

  const have =
    commodity === "untrained"
      ? Math.floor(player.units.untrained)
      : Math.floor(player.attackTurns);

  const maxBuyTurns = Math.max(
    0,
    MAX_ATTACK_TURNS - Math.floor(player.attackTurns),
  );

  const run = (err: string | null, okText: string) => {
    if (err) setMsg({ ok: false, text: err });
    else setMsg({ ok: true, text: okText });
  };

  return (
    <>
      <h1 className="gw-title">Open Market</h1>
      <p className="gw-lead">
        Spot exchange for untrained units and attack turns, settled in open
        Naquadah. The book has no inventory or order-size caps — dumps stay on
        the board forever. Prices still soften when flooded and firm when scarce.
      </p>

      <div className="gw-card">
        <h2>Galaxy resources</h2>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginTop: 0 }}>
          Live totals across {formatNaq(stats.livingRealms)} living realms
          {stats.deadRealms > 0
            ? ` (${formatNaq(stats.deadRealms)} destroyed)`
            : ""}
          . Market book value is inventory × current mid (not spendable).
        </p>
        <div className="gw-stats">
          <div className="gw-stat">
            <span>Total Naq</span>
            <strong>{formatNaq(stats.totalNaq)}</strong>
          </div>
          <div className="gw-stat">
            <span>Open Naq</span>
            <strong>{formatNaq(stats.openNaq)}</strong>
          </div>
          <div className="gw-stat">
            <span>Banked Naq</span>
            <strong>{formatNaq(stats.bankNaq)}</strong>
          </div>
          <div className="gw-stat">
            <span>Market book (est.)</span>
            <strong>{formatNaq(stats.marketNaqEstimate)}</strong>
          </div>
          <div className="gw-stat">
            <span>All units</span>
            <strong>{formatNaq(stats.totalUnits)}</strong>
          </div>
          <div className="gw-stat">
            <span>Untrained</span>
            <strong>{formatNaq(stats.untrained)}</strong>
          </div>
          <div className="gw-stat">
            <span>Miners</span>
            <strong>{formatNaq(stats.miners)}</strong>
          </div>
          <div className="gw-stat">
            <span>Offence</span>
            <strong>{formatNaq(stats.offence)}</strong>
          </div>
          <div className="gw-stat">
            <span>Defence</span>
            <strong>{formatNaq(stats.defence)}</strong>
          </div>
          <div className="gw-stat">
            <span>Covert</span>
            <strong>{formatNaq(stats.covert)}</strong>
          </div>
          <div className="gw-stat">
            <span>Anti-covert</span>
            <strong>{formatNaq(stats.antiCovert)}</strong>
          </div>
          <div className="gw-stat">
            <span>Attack turns</span>
            <strong>{formatNaq(stats.attackTurns)}</strong>
          </div>
          <div className="gw-stat">
            <span>Weapons</span>
            <strong>{formatNaq(stats.weapons)}</strong>
          </div>
          <div className="gw-stat">
            <span>Planets</span>
            <strong>{formatNaq(stats.planets)}</strong>
          </div>
          <div className="gw-stat">
            <span>Book UU</span>
            <strong>{formatNaq(stats.marketInventory.untrained)}</strong>
          </div>
          <div className="gw-stat">
            <span>Book turns</span>
            <strong>{formatNaq(stats.marketInventory.attackTurns)}</strong>
          </div>
        </div>
      </div>

      <div className="gw-card">
        <h2>24h mid prices</h2>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginTop: 0 }}>
          Mid price sampled about every 5 minutes. Flooded dumps pull lines down;
          scarcity pushes them up.
        </p>
        <MarketPriceChart history={priceHistory} />
      </div>

      <div className="gw-card">
        <h2>Live board</h2>
        <table className="gw-table">
          <thead>
            <tr>
              <th>Commodity</th>
              <th>Buy (you pay)</th>
              <th>Sell (you get)</th>
              <th>Fair mid</th>
              <th>Inventory</th>
              <th>Flood</th>
            </tr>
          </thead>
          <tbody>
            {board.map((row) => {
              const cheap = row.buy < row.fair * 0.9;
              const rich = row.sell > row.fair * 1.1;
              return (
                <tr key={row.commodity}>
                  <td>
                    <button
                      type="button"
                      className="gw-btn gw-btn-ghost"
                      onClick={() => {
                        setCommodity(row.commodity);
                        setMsg(null);
                      }}
                    >
                      {row.label}
                    </button>
                  </td>
                  <td style={cheap ? { color: "var(--race-glow)" } : undefined}>
                    {formatNaq(row.buy)} /u
                  </td>
                  <td style={rich ? { color: "var(--race-glow)" } : undefined}>
                    {formatNaq(row.sell)} /u
                  </td>
                  <td>{formatNaq(row.mid)}</td>
                  <td>
                    {formatNaq(row.inventory)}
                    <span style={{ color: "var(--gw-muted)", fontSize: "0.75rem" }}>
                      {" "}
                      (ref {formatNaq(row.baseline)})
                    </span>
                  </td>
                  <td>
                    {row.flood < 0.85
                      ? "Flooded"
                      : row.flood > 1.2
                        ? "Scarce"
                        : "Balanced"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginTop: "0.75rem" }}>
          Scaled fair: UU {formatNaq(fairBasePrice(save, "untrained"))} Naq · Turns{" "}
          {formatNaq(fairBasePrice(save, "attackTurns"))} Naq (scales with galaxy
          income). Your open Naq: {formatNaq(player.naquadah)} · UU{" "}
          {formatNaq(player.units.untrained)} · Turns {Math.floor(player.attackTurns)}/
          {MAX_ATTACK_TURNS}
        </p>
      </div>

      <div className="gw-card">
        <h2>Trade desk</h2>
        <div className="gw-row">
          <div className="gw-field">
            <label htmlFor="mkt-comm">Commodity</label>
            <select
              id="mkt-comm"
              className="gw-input"
              value={commodity}
              onChange={(e) => {
                setCommodity(e.target.value as MarketCommodity);
                setMsg(null);
              }}
            >
              <option value="untrained">{COMMODITY_LABEL.untrained}</option>
              <option value="attackTurns">{COMMODITY_LABEL.attackTurns}</option>
            </select>
          </div>
          <div className="gw-field">
            <label htmlFor="mkt-side">Side</label>
            <select
              id="mkt-side"
              className="gw-input"
              value={side}
              onChange={(e) => {
                setSide(e.target.value as MarketSide);
                setMsg(null);
              }}
            >
              <option value="sell">Sell for Naq</option>
              <option value="buy">Buy with Naq</option>
            </select>
          </div>
          <div className="gw-field">
            <label htmlFor="mkt-qty">Quantity</label>
            <input
              id="mkt-qty"
              className="gw-input"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
            />
          </div>
        </div>
        <p style={{ color: "var(--gw-muted)", margin: "0.65rem 0" }}>
          You have {formatNaq(have)} {COMMODITY_LABEL[commodity].toLowerCase()}.
          Quote:{" "}
          {quote?.ok
            ? `${side === "buy" ? "Pay" : "Receive"} ${formatNaq(quote.naqTotal)} Naq (~${formatNaq(quote.unitPrice)} /u)`
            : quote?.reason ?? "—"}
        </p>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              const err = marketTrade({ commodity, side, quantity: qty });
              run(
                err,
                err
                  ? ""
                  : `${side === "buy" ? "Bought" : "Sold"} ${qty} ${COMMODITY_LABEL[commodity].toLowerCase()}`,
              );
            }}
          >
            Execute {side === "buy" ? "buy" : "sell"}
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() =>
              setQty(
                side === "sell"
                  ? Math.max(1, have)
                  : commodity === "attackTurns"
                    ? Math.max(1, maxBuyTurns)
                    : Math.max(
                        1,
                        Math.floor(
                          player.naquadah /
                            Math.max(1, quote?.unitPrice ?? board.find((b) => b.commodity === commodity)?.buy ?? 1),
                        ),
                      ),
              )
            }
          >
            Max
          </button>
        </div>
        {msg && (
          <div className={`gw-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
        )}
      </div>

      <div className="gw-card">
        <h2>Recent fills</h2>
        {trades.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            No trades yet — AI rivals will start using the board on pulses.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Trader</th>
                <th>Side</th>
                <th>Commodity</th>
                <th>Qty</th>
                <th>Naq</th>
                <th>/u</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.at).toLocaleString()}</td>
                  <td>
                    <RealmLink realmId={t.realmId}>{t.realmName}</RealmLink>
                  </td>
                  <td>{t.side}</td>
                  <td>{COMMODITY_LABEL[t.commodity]}</td>
                  <td>{formatNaq(t.quantity)}</td>
                  <td>{formatNaq(t.naqTotal)}</td>
                  <td>{formatNaq(t.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
