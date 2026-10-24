"use client";

import { useEffect, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { useGameClock } from "@/lib/game/gameClock";
import { fetchLlmModels, requestMindLlm } from "@/lib/game/llmClient";
import { RACE_LIST } from "@/lib/game/races";
import { formatDuration } from "@/lib/ui/time";
import { NebulaQualityControl } from "@/components/NebulaQualityControl";
import type { RaceId } from "@/lib/db/schema";

export default function SettingsPage() {
  return (
    <PlayGate stageMode="settings">
      <Settings />
    </PlayGate>
  );
}

function Settings() {
  const {
    player,
    save,
    setVacation,
    setTurnMinutes,
    renamePlayer,
    changeRace,
    resetGame,
    exportJson,
    importJson,
    aiPulseNow,
    setAiEnabled,
    setAiPulsesPerHour,
    setAiActorsPerPulse,
    setRankingsRefreshMinutes,
    refreshRankingsNow,
    setLlmSettings,
  } = useGame();
  const { msToAiPulse } = useGameClock();
  const [name, setName] = useState(player?.name ?? "");
  const [race, setRace] = useState<RaceId>(player?.race ?? "tauri");
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [llmBaseUrl, setLlmBaseUrl] = useState(
    save?.settings.llmBaseUrl ?? "",
  );
  const [llmModel, setLlmModel] = useState(save?.settings.llmModel ?? "");
  const [llmApiKey, setLlmApiKey] = useState(save?.settings.llmApiKey ?? "");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [llmBusy, setLlmBusy] = useState(false);

  useEffect(() => {
    if (!save) return;
    setLlmBaseUrl(save.settings.llmBaseUrl);
    setLlmModel(save.settings.llmModel);
    setLlmApiKey(save.settings.llmApiKey ?? "");
  }, [
    save?.settings.llmBaseUrl,
    save?.settings.llmModel,
    save?.settings.llmApiKey,
  ]);

  if (!player || !save) return null;

  const aiOn = save.settings.aiEnabled !== false;
  const pulses = save.settings.aiPulsesPerHour ?? 8;
  const batch = save.settings.aiActorsPerPulse ?? 25;
  const rankMins = save.settings.rankingsRefreshMinutes ?? 60;
  const livingAi = save.rankingsCache
    ? Math.max(0, save.rankingsCache.livingCount - (player && !player.dead ? 1 : 0))
    : save.realms.filter((r) => !r.isPlayer && !r.vacation && !r.dead).length;
  const rankAge = save.rankingsCache?.refreshedAt
    ? Date.now() - save.rankingsCache.refreshedAt
    : null;

  // Shared formatter: turn/pulse intervals can exceed an hour, which the old
  // local m:ss helper rendered as "73:12".
  const formatCountdown = formatDuration;

  function formatRotation(aiCount: number, actors: number, perHour: number) {
    const a = Math.max(1, actors);
    const p = Math.max(1, perHour);
    const pulsesNeeded = Math.ceil(aiCount / a);
    const hours = pulsesNeeded / p;
    if (hours < 1 / 60) return "<1 min";
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
    return `${(hours / 24).toFixed(1)} d`;
  }

  const refreshModels = async () => {
    setLlmBusy(true);
    setMsg(null);
    const res = await fetchLlmModels({
      baseUrl: llmBaseUrl.trim() || undefined,
      apiKey: llmApiKey,
    });
    setLlmBusy(false);
    if (res.error) {
      setMsg(`Models: ${res.error}`);
      return;
    }
    setModelOptions(res.models);
    if (res.models.length && !res.models.includes(llmModel)) {
      setLlmModel(res.models[0]!);
    }
    setMsg(
      res.models.length
        ? `Found ${res.models.length} model(s) on endpoint`
        : "Endpoint returned no models — type a model id manually",
    );
  };

  const saveLlm = async () => {
    setLlmBusy(true);
    const err = await setLlmSettings({
      baseUrl: llmBaseUrl,
      model: llmModel,
      apiKey: llmApiKey,
    });
    setLlmBusy(false);
    setMsg(err ?? "LLM settings saved to SQLite");
  };

  const testLlm = async () => {
    setLlmBusy(true);
    setMsg(null);
    const res = await requestMindLlm({
      systemPrompt: "You are a connectivity probe. Reply with exactly: OK",
      userPrompt: "ping",
      temperature: 0.1,
      maxTokens: 64,
      baseUrl: llmBaseUrl.trim() || undefined,
      model: llmModel.trim() || undefined,
      apiKey: llmApiKey,
    });
    setLlmBusy(false);
    if ("error" in res) setMsg(`Test failed: ${res.error}`);
    else setMsg(`Test OK — model replied: ${res.text.slice(0, 120)}`);
  };

  return (
    <>
      <h1 className="gw-title">Settings</h1>
      <p className="gw-lead">
        Save lives in a local SQLite file on the server (
        <code>data/gatewars.sqlite</code>). Export a JSON backup anytime.
      </p>

      <div className="gw-card">
        <h2>Realm</h2>
        <div className="gw-row">
          <div className="gw-field" style={{ flex: 1 }}>
            <label htmlFor="rename">Commander name</label>
            <input
              id="rename"
              className="gw-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="gw-btn"
            onClick={() => setMsg(renamePlayer(name) ?? "Name updated")}
          >
            Rename
          </button>
        </div>
        <div className="gw-row" style={{ marginTop: "0.85rem" }}>
          <div className="gw-field">
            <label htmlFor="race">Change race (costly)</label>
            <select
              id="race"
              className="gw-select"
              value={race}
              onChange={(e) => setRace(e.target.value as RaceId)}
            >
              {RACE_LIST.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="gw-btn gw-btn-danger"
            onClick={() => {
              if (
                !confirm(
                  "Change race? You lose tech, trained units, bank, and weapons.",
                )
              )
                return;
              setMsg(changeRace(race) ?? "Race changed");
            }}
          >
            Change race
          </button>
        </div>
        <div className="gw-row" style={{ marginTop: "0.85rem" }}>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() => {
              setVacation(!player.vacation);
              setMsg(player.vacation ? "Vacation ended" : "Vacation mode on");
            }}
          >
            {player.vacation ? "End vacation" : "Enter vacation mode"}
          </button>
        </div>
      </div>

      <div className="gw-card">
        <h2>Display</h2>
        <p style={{ color: "var(--gw-muted)" }}>
          Background effects are a device preference, so they are stored in this
          browser rather than in your realm save — exporting a realm will not
          carry another machine&apos;s GPU settings with it.
        </p>
        <NebulaQualityControl />
      </div>

      <div className="gw-card">
        <h2>Language model</h2>
        <p style={{ color: "var(--gw-muted)" }}>
          OpenAI-compatible endpoint used for AI minds and forum chat. Settings
          are stored in the SQLite save and applied on every LLM call.
        </p>
        <div className="gw-field" style={{ marginBottom: "0.75rem" }}>
          <label htmlFor="llm-url">Endpoint base URL</label>
          <input
            id="llm-url"
            className="gw-input"
            value={llmBaseUrl}
            onChange={(e) => setLlmBaseUrl(e.target.value)}
            placeholder="http://host:1234/v1"
            spellCheck={false}
          />
        </div>
        <div className="gw-field" style={{ marginBottom: "0.75rem" }}>
          <label htmlFor="llm-key">API key (optional)</label>
          <input
            id="llm-key"
            className="gw-input"
            type="password"
            autoComplete="off"
            value={llmApiKey}
            onChange={(e) => setLlmApiKey(e.target.value)}
            placeholder="Leave blank for local servers"
          />
        </div>
        <div className="gw-row" style={{ alignItems: "end" }}>
          <div className="gw-field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="llm-model-select">Model</label>
            {modelOptions.length > 0 ? (
              <select
                id="llm-model-select"
                className="gw-select"
                value={
                  modelOptions.includes(llmModel) ? llmModel : "__custom__"
                }
                onChange={(e) => {
                  if (e.target.value !== "__custom__") {
                    setLlmModel(e.target.value);
                  }
                }}
              >
                {!modelOptions.includes(llmModel) && llmModel.trim() && (
                  <option value="__custom__">{llmModel} (custom)</option>
                )}
                {modelOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="llm-model-select"
                className="gw-input"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="provider/model-id"
                spellCheck={false}
              />
            )}
          </div>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={llmBusy}
            onClick={() => void refreshModels()}
          >
            Refresh models
          </button>
        </div>
        {modelOptions.length > 0 && (
          <div className="gw-field" style={{ marginTop: "0.75rem" }}>
            <label htmlFor="llm-model-custom">Or type model id</label>
            <input
              id="llm-model-custom"
              className="gw-input"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}
        <div className="gw-row" style={{ marginTop: "0.85rem" }}>
          <button
            type="button"
            className="gw-btn"
            disabled={llmBusy}
            onClick={() => void saveLlm()}
          >
            Save LLM settings
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={llmBusy}
            onClick={() => void testLlm()}
          >
            Test connection
          </button>
        </div>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginBottom: 0 }}>
          Active: {save.settings.llmModel} @ {save.settings.llmBaseUrl}
        </p>
      </div>

      <div className="gw-card">
        <h2>AI rivals</h2>
        <p style={{ color: "var(--gw-muted)" }}>
          Living AI realms act in round-robin batches so everyone gets a turn over
          time. Tune batch size and pulse rate — small/frequent or large/rare.
          Next pulse in {aiOn ? formatCountdown(msToAiPulse) : "—"}.
        </p>
        <div className="gw-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              setAiEnabled(!aiOn);
              setMsg(aiOn ? "AI disabled" : "AI enabled");
            }}
          >
            {aiOn ? "Disable AI" : "Enable AI"}
          </button>
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              const n = aiPulseNow();
              setMsg(`Forced AI pulse — ${n} rival(s) acted`);
            }}
          >
            Force AI pulse
          </button>
        </div>

        <h3 style={{ fontSize: "0.95rem", margin: "12px 0 6px" }}>
          Pulses per hour
        </h3>
        <div className="gw-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {[8, 20, 60, 120].map((n) => (
            <button
              key={n}
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => {
                setAiPulsesPerHour(n);
                setMsg(`AI: ${n} pulses/hour`);
              }}
            >
              {n} / hour
            </button>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Custom
            </span>
            <input
              type="number"
              min={1}
              max={120}
              value={pulses}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setAiPulsesPerHour(n);
              }}
              style={{ width: 72 }}
            />
          </label>
        </div>

        <h3 style={{ fontSize: "0.95rem", margin: "14px 0 6px" }}>
          Actors per pulse
        </h3>
        <div className="gw-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {[25, 50, 100, 200, 500].map((n) => (
            <button
              key={n}
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => {
                setAiActorsPerPulse(n);
                setMsg(`AI batch: ${n} actors/pulse`);
              }}
            >
              {n}
            </button>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Custom
            </span>
            <input
              type="number"
              min={1}
              max={5000}
              value={batch}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setAiActorsPerPulse(n);
              }}
              style={{ width: 80 }}
            />
          </label>
        </div>

        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginBottom: 0 }}>
          {aiOn ? "" : "AI paused. "}
          {pulses} pulses/hour · {batch} actors/pulse
          {livingAi > 0
            ? ` · full rotation ~${formatRotation(livingAi, batch, pulses)}`
            : ""}
        </p>
      </div>

      <div className="gw-card">
        <h2>Rankings &amp; stats</h2>
        <p style={{ color: "var(--gw-muted)" }}>
          Leaderboards, overall ranks, and guild power are rebuilt on a timer —
          not on every action. Between refreshes the UI reads a snapshot so the
          game stays responsive at large populations.
        </p>
        <div className="gw-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {[15, 30, 60, 120, 360].map((n) => (
            <button
              key={n}
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => {
                setRankingsRefreshMinutes(n);
                setMsg(
                  n >= 60
                    ? `Rankings refresh every ${n / 60} hour(s)`
                    : `Rankings refresh every ${n} min`,
                );
              }}
            >
              {n >= 60 ? `${n / 60}h` : `${n}m`}
            </button>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Minutes
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              value={rankMins}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setRankingsRefreshMinutes(n);
              }}
              style={{ width: 80 }}
            />
          </label>
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              void refreshRankingsNow().then(() =>
                setMsg("Rankings snapshot rebuilt"),
              );
            }}
          >
            Refresh now
          </button>
        </div>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem", marginBottom: 0 }}>
          Every {rankMins} min
          {rankAge == null
            ? " · snapshot pending"
            : ` · last refresh ${formatCountdown(rankAge)} ago`}
        </p>
      </div>

      <div className="gw-card">
        <h2>Turn clock</h2>
        <p style={{ color: "var(--gw-muted)" }}>
          Production turns every {save.settings.turnMinutes} minute(s). Use a short
          interval while testing.
        </p>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              setTurnMinutes(30);
              setMsg("Turn length: 30 minutes");
            }}
          >
            30 min (classic)
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() => {
              setTurnMinutes(1);
              setMsg("Turn length: 1 minute");
            }}
          >
            1 min
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() => {
              setTurnMinutes(0.05);
              setMsg("Turn length: 3 seconds (dev)");
            }}
          >
            3 sec (dev)
          </button>
        </div>
      </div>

      <div className="gw-card">
        <h2>Save data</h2>
        <div className="gw-row" style={{ marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="gw-btn"
            onClick={() => {
              const json = exportJson();
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "gatewars-save.json";
              a.click();
              URL.revokeObjectURL(url);
              setMsg("Save exported");
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-danger"
            onClick={() => {
              if (!confirm("Delete local save and return to title?")) return;
              resetGame();
              window.location.href = "/";
            }}
          >
            Reset game
          </button>
        </div>
        <div className="gw-field">
          <label htmlFor="import">Import JSON</label>
          <textarea
            id="import"
            className="gw-input"
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste save JSON…"
          />
        </div>
        <button
          type="button"
          className="gw-btn"
          style={{ marginTop: "0.6rem" }}
          onClick={() => setMsg(importJson(importText) ?? "Save imported")}
        >
          Import
        </button>
      </div>
      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}
