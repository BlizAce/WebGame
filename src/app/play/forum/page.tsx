"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { useGame } from "@/lib/game/GameContext";
import { getAlliance } from "@/lib/game/guilds";
import { listForumPosts, MAX_POST_LENGTH } from "@/lib/game/forum";
import type { ForumChannelKind } from "@/lib/db/schema";

export default function ForumPage() {
  return (
    <PlayGate stageMode="forum">
      <Forum />
    </PlayGate>
  );
}

function Forum() {
  const { save, player, postForum, pulseAiMinds } = useGame();
  const [tab, setTab] = useState<ForumChannelKind>("open");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const guild = useMemo(() => {
    if (!save || !player) return null;
    return getAlliance(save, player.allianceId) ?? null;
  }, [save, player]);

  const posts = useMemo(() => {
    if (!save) return [];
    if (tab === "guild") {
      if (!player?.allianceId) return [];
      return listForumPosts(save, {
        channel: "guild",
        allianceId: player.allianceId,
      });
    }
    return listForumPosts(save, { channel: "open" });
  }, [save, player, tab]);

  useEffect(() => {
    if (tab === "guild" && !player?.allianceId) setTab("open");
  }, [tab, player?.allianceId]);

  if (!player || !save) return null;

  const canGuild = !!guild;

  return (
    <>
      <h1 className="gw-title">Forum</h1>
      <p className="gw-lead">
        Open chat for the whole galaxy, plus a private board for your guild.
        Rival commanders think with a 64k-context LLM (max 4 at once): they grow
        personas, write plans, execute them, and talk like real players.
      </p>

      <div className="gw-tips">
        <h3>Channels</h3>
        <ul>
          <li>
            <strong>Open:</strong> visible to everyone. Boast, trade tips, trash
            talk wartime foes.
          </li>
          <li>
            <strong>Guild:</strong> only your guildmates see it. Coordinate
            wars, donations, and market dumps.
          </li>
          <li>
            Rival commanders build personas and multi-step plans via the LLM
            (64k context, max 4 concurrent). They execute those plans in the
            wild — wars, market, guilds, forum. Use{" "}
            <em>Summon AI minds</em> to force a think wave.
          </li>
        </ul>
      </div>

      <div className="gw-card">
        <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
          <button
            type="button"
            className={`gw-btn ${tab === "open" ? "" : "gw-btn-ghost"}`}
            onClick={() => setTab("open")}
          >
            Open chat
          </button>
          <button
            type="button"
            className={`gw-btn ${tab === "guild" ? "" : "gw-btn-ghost"}`}
            onClick={() => canGuild && setTab("guild")}
            disabled={!canGuild}
            title={canGuild ? undefined : "Join a guild first"}
          >
            Guild board
            {guild ? ` [${guild.tag}]` : ""}
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={aiBusy || save.settings.aiEnabled === false}
            onClick={async () => {
              setAiBusy(true);
              setMsg(null);
              try {
                const result = await pulseAiMinds(true);
                setMsg({
                  ok: result.thought > 0 || result.posted > 0,
                  text:
                    result.thought > 0 || result.posted > 0
                      ? `Minds: ${result.thought} thought, ${result.executed} steps run, ${result.posted} forum posts.`
                      : result.error ?? "No AI minds responded.",
                });
              } finally {
                setAiBusy(false);
              }
            }}
          >
            {aiBusy ? "Thinking…" : "Summon AI minds"}
          </button>
        </div>

        <h2>
          {tab === "open"
            ? "Open channel"
            : `Guild channel — [${guild?.tag}] ${guild?.name}`}
        </h2>

        <div className="gw-forum-compose">
          <textarea
            className="gw-input gw-forum-input"
            rows={3}
            maxLength={MAX_POST_LENGTH}
            placeholder={
              tab === "guild"
                ? "Message your guild…"
                : "Address the galaxy…"
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="gw-row" style={{ marginTop: "0.65rem" }}>
            <button
              type="button"
              className="gw-btn"
              onClick={() => {
                const err = postForum(tab, body);
                if (err) setMsg({ ok: false, text: err });
                else {
                  setBody("");
                  setMsg({ ok: true, text: "Posted." });
                }
              }}
            >
              Post
            </button>
            <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              {body.length}/{MAX_POST_LENGTH}
            </span>
          </div>
        </div>

        {msg && (
          <div className={`gw-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
        )}

        <div className="gw-forum-feed">
          {posts.length === 0 ? (
            <p style={{ color: "var(--gw-muted)" }}>
              No messages yet
              {tab === "guild"
                ? " — say hello to your guild, or wait for AI mates."
                : " — be the first, or summon AI chatter."}
            </p>
          ) : (
            posts.map((p) => (
              <article key={p.id} className="gw-forum-post">
                <header>
                  <RealmLink realmId={p.authorId}>{p.authorName}</RealmLink>
                  {p.isAi ? (
                    <span className="gw-forum-badge">AI</span>
                  ) : null}
                  {p.channel === "guild" && p.allianceTag ? (
                    <span className="gw-forum-badge">[{p.allianceTag}]</span>
                  ) : null}
                  <time dateTime={new Date(p.at).toISOString()}>
                    {new Date(p.at).toLocaleString()}
                  </time>
                </header>
                <p>{p.body}</p>
              </article>
            ))
          )}
        </div>
      </div>
    </>
  );
}
