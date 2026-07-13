"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { useGame } from "@/lib/game/GameContext";
import {
  ensureMail,
  mailCounterpartName,
  mailThreadPreview,
  threadsForRealm,
  MAX_MAIL_BODY,
  MAX_MAIL_SUBJECT,
} from "@/lib/game/mail";
import { formatNaq } from "@/lib/game/economy";

export default function MailPage() {
  return (
    <PlayGate stageMode="mail">
      <Mail />
    </PlayGate>
  );
}

function Mail() {
  const {
    save,
    player,
    sendMail,
    replyMail,
    readMailThread,
    pulseMailAi,
    mailUnread,
  } = useGame();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [toId, setToId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const threads = useMemo(() => {
    if (!save || !player) return [];
    ensureMail(save);
    return threadsForRealm(save, player.id);
  }, [save, player]);

  const selected = useMemo(() => {
    if (!selectedId || !save) return null;
    return ensureMail(save).threads.find((t) => t.id === selectedId) ?? null;
  }, [save, selectedId]);

  const recipients = useMemo(() => {
    if (!save || !player) return [];
    return save.realms
      .filter((r) => !r.dead && r.id !== player.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400);
  }, [save, player]);

  useEffect(() => {
    if (selected && player) {
      readMailThread(selected.id);
    }
  }, [selected?.id, player?.id]);

  if (!player || !save) return null;

  const isUnread = (threadId: string) => {
    const t = ensureMail(save).threads.find((x) => x.id === threadId);
    if (!t) return false;
    const last = t.messages[t.messages.length - 1];
    if (!last || last.authorId === player.id) return false;
    return last.at > (t.lastReadAt[player.id] ?? 0);
  };

  return (
    <>
      <h1 className="gw-title">Courier Mail</h1>
      <p className="gw-lead">
        Private dispatches between commanders — email-style threads the AI
        starts and continues with a 128k-token context budget.{" "}
        {mailUnread > 0
          ? `You have ${mailUnread} unread thread${mailUnread === 1 ? "" : "s"}.`
          : "Inbox clear."}
      </p>

      <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
        <button
          type="button"
          className="gw-btn"
          onClick={() => {
            setCompose(true);
            setSelectedId(null);
            setMsg(null);
          }}
        >
          Compose
        </button>
        <button
          type="button"
          className="gw-btn gw-btn-ghost"
          disabled={aiBusy}
          onClick={() => {
            setAiBusy(true);
            void pulseMailAi(true).then((r) => {
              setAiBusy(false);
              setMsg({
                ok: !r.error || r.sent > 0,
                text: r.error
                  ? `${r.sent} sent — ${r.error}`
                  : `AI mail wave: ${r.sent} dispatch(es)`,
              });
            });
          }}
        >
          {aiBusy ? "Routing…" : "Summon AI couriers"}
        </button>
      </div>

      {compose && (
        <div className="gw-card">
          <h2>New dispatch</h2>
          <div className="gw-field" style={{ marginBottom: "0.65rem" }}>
            <label htmlFor="mail-to">To</label>
            <select
              id="mail-to"
              className="gw-select"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              <option value="">Select commander…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.isPlayer ? "" : " [AI]"} — score{" "}
                  {formatNaq(r.naquadah)} Naq
                </option>
              ))}
            </select>
          </div>
          <div className="gw-field" style={{ marginBottom: "0.65rem" }}>
            <label htmlFor="mail-subj">Subject</label>
            <input
              id="mail-subj"
              className="gw-input"
              maxLength={MAX_MAIL_SUBJECT}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
            />
          </div>
          <div className="gw-field">
            <label htmlFor="mail-body">Message</label>
            <textarea
              id="mail-body"
              className="gw-input gw-forum-input"
              rows={5}
              maxLength={MAX_MAIL_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your dispatch…"
            />
          </div>
          <div className="gw-row" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="gw-btn"
              onClick={() => {
                const err = sendMail({ toId, subject, body });
                if (err) setMsg({ ok: false, text: err });
                else {
                  setMsg({ ok: true, text: "Dispatch sent" });
                  setCompose(false);
                  setToId("");
                  setSubject("");
                  setBody("");
                }
              }}
            >
              Send
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => setCompose(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="gw-mail-layout">
        <div className="gw-card gw-mail-list">
          <h2>Inbox</h2>
          {threads.length === 0 ? (
            <p style={{ color: "var(--gw-muted)" }}>
              No mail yet — AI couriers will open threads on their own.
            </p>
          ) : (
            <ul className="gw-mail-threads">
              {threads.map((t) => {
                const unread = isUnread(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`gw-mail-thread ${selectedId === t.id ? "is-active" : ""} ${unread ? "is-unread" : ""}`}
                      onClick={() => {
                        setSelectedId(t.id);
                        setCompose(false);
                        setReply("");
                        setMsg(null);
                      }}
                    >
                      <span className="gw-mail-thread-top">
                        <strong>
                          {mailCounterpartName(save, t, player.id)}
                        </strong>
                        <time>
                          {new Date(t.updatedAt).toLocaleString()}
                        </time>
                      </span>
                      <span className="gw-mail-subj">{t.subject}</span>
                      <span className="gw-mail-preview">
                        {mailThreadPreview(t)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="gw-card gw-mail-read">
          {!selected ? (
            <>
              <h2>Thread</h2>
              <p style={{ color: "var(--gw-muted)" }}>
                Select a dispatch from your inbox.
              </p>
            </>
          ) : (
            <>
              <h2>{selected.subject}</h2>
              <p style={{ color: "var(--gw-muted)", marginTop: 0 }}>
                With{" "}
                <RealmLink realmId={selected.participantIds.find((id) => id !== player.id)!}>
                  {mailCounterpartName(save, selected, player.id)}
                </RealmLink>
                {" · "}
                {selected.messages.length} message
                {selected.messages.length === 1 ? "" : "s"}
              </p>
              <div className="gw-mail-messages">
                {selected.messages.map((m) => (
                  <article
                    key={m.id}
                    className={`gw-mail-msg ${m.authorId === player.id ? "is-mine" : ""}`}
                  >
                    <header>
                      <RealmLink realmId={m.authorId}>{m.authorName}</RealmLink>
                      {m.isAi && <span className="gw-forum-badge">AI</span>}
                      <time>{new Date(m.at).toLocaleString()}</time>
                    </header>
                    <p>{m.body}</p>
                  </article>
                ))}
              </div>
              <div className="gw-field" style={{ marginTop: "0.85rem" }}>
                <label htmlFor="mail-reply">Reply</label>
                <textarea
                  id="mail-reply"
                  className="gw-input gw-forum-input"
                  rows={4}
                  maxLength={MAX_MAIL_BODY}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Continue the thread…"
                />
              </div>
              <button
                type="button"
                className="gw-btn"
                style={{ marginTop: "0.55rem" }}
                onClick={() => {
                  const err = replyMail({
                    threadId: selected.id,
                    body: reply,
                  });
                  if (err) setMsg({ ok: false, text: err });
                  else {
                    setMsg({ ok: true, text: "Reply sent" });
                    setReply("");
                  }
                }}
              >
                Send reply
              </button>
            </>
          )}
        </div>
      </div>

      {msg && (
        <div className={`gw-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
      )}
    </>
  );
}
