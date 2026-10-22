import { useState } from "react";
import { refreshBoot, useBoot } from "@/app/session";
import { get } from "@/lib/api";
import { durationLabel, shortDate } from "@/lib/format";
import { act } from "@/lib/offline";
import { invalidate } from "@/lib/store";
import type { AiModelStatus, AiStatus, Integrations } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { CodeLine } from "@/ui/controls";
import { Icon } from "@/ui/icons";
import { confirmSheet, openSheet, SheetLayout } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";

function reloadSettings(): void {
  invalidate("settings");
  void refreshBoot();
}

export function moveUp<T>(list: T[], index: number): T[] {
  if (index <= 0 || index >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index - 1, 0, item!);
  return next;
}

function ModelRow({ name, index, info, count, onUp, onRemove }: { name: string; index: number; info: AiModelStatus | undefined; count: number; onUp: () => void; onRemove: () => void }) {
  const [result, setResult] = useState("");
  const stats = info ?? { name, ok_today: 0, limited_today: 0, failed_today: 0, blocked_seconds: 0, last_error: null };
  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      <span className="chip">{index === 0 ? "first" : "backup " + String(index)}</span>
      <div className="grow stack tight" style={{ minWidth: 0 }}>
        <b className="ellipsis">{name}</b>
        <span className="muted" style={{ fontSize: "var(--s-1)" }}>
          Today: {stats.ok_today} answered, {stats.limited_today} over limit, {stats.failed_today} failed
        </span>
        {stats.blocked_seconds ? <span className="chip warn">Free quota used up, back in {durationLabel(stats.blocked_seconds)}</span> : <span className="chip">Available</span>}
        {stats.last_error ? (
          <span className="muted ellipsis" style={{ fontSize: "var(--s-1)" }} title={stats.last_error}>
            Last error {stats.last_error}
          </span>
        ) : null}
        <span className="muted">{result}</span>
      </div>
      <div className="row">
        <button type="button" className="btn small ghost" disabled={index === 0} onClick={onUp}>
          Up
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            setResult("Testing...");
            act<{ ok: boolean; seconds?: number; error?: string }>("POST", "/api/ai/test", { model: name }).then(
              (answer) => setResult(answer.ok ? "Works, answered in " + String(answer.seconds) + " s" : "Failed: " + String(answer.error)),
              () => setResult(""),
            );
          }}
        >
          Test
        </button>
        <button type="button" className="btn small ghost danger" disabled={count === 1} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export function AssistantPanel({ ai }: { ai: AiStatus }) {
  const [key, setKey] = useState("");
  const [order, setOrder] = useState(() => ai.models.map((entry) => entry.name));
  const [available, setAvailable] = useState<{ name: string; label: string }[]>([]);
  const tone = !ai.enabled || !ai.key_set ? "off" : ai.queued ? "busy" : "";
  const state = !ai.enabled ? "Paused, tasks wait until you turn it back on" : !ai.key_set ? "No key set" : ai.queued ? String(ai.queued) + " task" + (ai.queued === 1 ? "" : "s") + " waiting" : "Up to date";
  const run = (work: () => Promise<void>) => {
    work().then(reloadSettings, () => undefined);
  };
  return (
    <section className="panel">
      <div className="spread">
        <h3>Assistant</h3>
        <label className="row soft" style={{ gap: "6px" }}>
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              run(async () => {
                await act("PATCH", "/api/ai/settings", { enabled });
                toast(enabled ? "Assistant on" : "Assistant paused");
              });
            }}
          />
          {ai.enabled ? "On" : "Paused"}
        </label>
      </div>
      <div className="row" style={{ margin: "8px 0" }}>
        <span className={"ai-dot " + tone} />
        <span className="soft">{state}</span>
      </div>
      {ai.last_error ? <p className="muted">Last problem: {ai.last_error}</p> : null}
      {ai.cooldown_seconds ? <p className="muted">All models over the free limit, retrying in about {durationLabel(ai.cooldown_seconds)}</p> : null}
      <h4>Key</h4>
      <p className="muted" style={{ fontSize: "var(--s-1)" }}>
        {ai.key_source === "settings" ? "Using the key saved here." : ai.key_source === "server" ? "Using the key from the server configuration." : "No key yet."}
      </p>
      <div className="row">
        <input
          className="input"
          type="password"
          autoComplete="off"
          aria-label="Gemini API key"
          placeholder={ai.key_hint ? "Current key " + ai.key_hint : "Paste a Gemini API key"}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            if (!key.trim()) {
              toast("Paste a key first", true);
              return;
            }
            run(async () => {
              await act("PATCH", "/api/ai/settings", { api_key: key.trim() });
              setKey("");
              toast("Key saved");
            });
          }}
        >
          Save key
        </button>
        {ai.key_source === "settings" ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() =>
              run(async () => {
                await act("PATCH", "/api/ai/settings", { api_key: "" });
                toast("Back to the server key");
              })
            }
          >
            Use server key
          </button>
        ) : null}
      </div>
      <h4>Models in order of use</h4>
      <p className="muted" style={{ fontSize: "var(--s-1)" }}>
        The first model is used until it hits its free limit, then the next one takes over. Google does not report the remaining quota, so the counts below are what this server sent today.
      </p>
      <div className="stack">
        {order.map((name, index) => (
          <ModelRow
            key={name}
            name={name}
            index={index}
            info={ai.models.find((entry) => entry.name === name)}
            count={order.length}
            onUp={() => setOrder(moveUp(order, index))}
            onRemove={() => setOrder(order.filter((entry) => entry !== name))}
          />
        ))}
      </div>
      <div className="row" style={{ marginTop: "8px" }}>
        <select
          className="input grow"
          aria-label="Add a model"
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (value && !order.includes(value)) setOrder([...order, value]);
          }}
        >
          <option value="">Add a model...</option>
          {available.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.label} ({entry.name})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            get<{ models: { name: string; label: string }[] }>("/api/ai/models").then(
              (answer) => {
                setAvailable(answer.models);
                toast(String(answer.models.length) + " models found");
              },
              () => toast("Could not load models", true),
            );
          }}
        >
          Load models
        </button>
      </div>
      <div className="row" style={{ marginTop: "10px" }}>
        <button
          type="button"
          className="btn primary small"
          onClick={() =>
            run(async () => {
              await act("PATCH", "/api/ai/settings", { models: order });
              toast("Models saved");
            })
          }
        >
          Save models
        </button>
        {ai.queued && ai.enabled ? (
          <button
            type="button"
            className="btn small"
            onClick={() =>
              run(async () => {
                await act("POST", "/api/ai/wake");
                toast("Retrying now");
              })
            }
          >
            <Icon name="refresh" />
            Retry now
          </button>
        ) : null}
      </div>
    </section>
  );
}

const SAY = [
  "Alexa, open pantry home",
  "What is on the shopping list",
  "Add rice to the shopping list, then answer: two kilos",
  "Plan ghormeh sabzi for Friday",
  "What is planned for tomorrow",
  "Do we have eggs",
  "Alexa, öffne meine Speisekammer",
  "Setze Milch auf die Einkaufsliste",
];

export function AlexaPanel() {
  const boot = useBoot();
  const [skill, setSkill] = useState(boot.alexa_skill_id || "");
  const ready = Boolean(boot.alexa_skill_id);
  return (
    <section className="panel">
      <div className="spread">
        <h3>Alexa</h3>
        <span className={"chip " + (ready ? "good" : "bad")}>{ready ? "Connected" : "Skill ID missing"}</span>
      </div>
      <p className="soft" style={{ margin: "8px 0" }}>
        {ready
          ? "Alexa can read and fill the shopping list, plan dishes and tell you the plan, in English and German."
          : "Alexa requests are refused until the skill ID is saved here. Copy it from the Alexa developer console."}
      </p>
      <div className="row">
        <input className="input" placeholder="amzn1.ask.skill..." aria-label="Alexa skill ID" value={skill} onChange={(event) => setSkill(event.target.value)} />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            act("PATCH", "/api/settings", { alexa_skill_id: skill.trim() }).then(
              () => {
                void refreshBoot();
                toast("Saved");
              },
              () => undefined,
            );
          }}
        >
          Save
        </button>
      </div>
      <h4 style={{ marginTop: "14px" }}>Endpoint</h4>
      <CodeLine value={boot.alexa_endpoint || ""} />
      <h4 style={{ marginTop: "14px" }}>Language models</h4>
      <p className="muted" style={{ fontSize: "var(--s-1)" }}>
        Paste into the JSON editor of the skill. Download again after adding many dishes so Alexa recognises the new names.
      </p>
      <div className="row wrap">
        {["en-US", "en-GB", "de-DE"].map((locale) => (
          <a key={locale} className="btn small" href={"/api/alexa/model/" + locale} download={"pantry-" + locale + ".json"}>
            <Icon name="download" />
            {locale}
          </a>
        ))}
      </div>
      <details className="muted" style={{ marginTop: "12px", fontSize: "var(--s-1)" }}>
        <summary>What to say</summary>
        <ul className="say-list">
          {SAY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function SecretBody({ secret, close }: { secret: string; close: () => void }) {
  return (
    <SheetLayout title="Webhook added" onClose={close}>
      <div className="stack">
        <p className="soft">
          Every call carries the header X-Pantry-Signature, an HMAC SHA256 of timestamp, a dot and the body, signed with this secret. It is shown only once.
        </p>
        <CodeLine value={secret} />
      </div>
    </SheetLayout>
  );
}

export function AutomationPanel() {
  const data = useResource((signal) => get<Integrations>("/api/integrations", { signal }), [], ["settings"]);
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["*"]);
  const origin = window.location.origin;
  const integrations = data.data;
  if (!integrations) return <section className="panel automation-panel">{data.error ? <p className="bad">{data.error.message}</p> : <p className="muted">Loading</p>}</section>;

  const refresh = () => invalidate("settings");
  return (
    <section className="panel automation-panel">
      <div className="spread">
        <h3>Automation and export</h3>
        <span className="chip">{integrations.last_export ? "Last export " + shortDate(integrations.last_export.slice(0, 10)) : "Export runs at 4:00"}</span>
      </div>
      <p className="soft" style={{ margin: "8px 0" }}>
        Every night at 4:00 the nutrition of the previous day is saved per person and announced as an event. Other services read it with an API key.
      </p>
      <h4>API keys</h4>
      <div className="stack tight">
        {integrations.tokens.length ? (
          integrations.tokens.map((token) => (
            <div key={token.id} className="list-row">
              <Icon name="key" />
              <div className="grow">
                <b>{token.name}</b>
                <div className="muted" style={{ fontSize: "var(--s-1)" }}>
                  ends in {token.hint}
                  {token.last_used ? ", last used " + shortDate(token.last_used.slice(0, 10)) : ", never used"}
                </div>
              </div>
              <button
                type="button"
                className="btn small ghost danger"
                onClick={() => {
                  void confirmSheet("Revoke " + token.name + "?", "Anything using this key stops working right away.", "Revoke", true).then(async (ok) => {
                    if (!ok) return;
                    await act("DELETE", "/api/integrations/tokens/" + String(token.id));
                    refresh();
                  });
                }}
              >
                Revoke
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No keys yet. The gym app and automations need one.</p>
        )}
      </div>
      <div className="row" style={{ marginTop: "8px" }}>
        <input className="input" placeholder="Name, for example Gym app" aria-label="Key name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
        <button
          type="button"
          className="btn small primary"
          onClick={() => {
            act<{ token: string }>("POST", "/api/integrations/tokens", { name: tokenName }).then((created) => {
              setNewToken(created.token);
              setTokenName("");
              refresh();
            }, errorToast);
          }}
        >
          <Icon name="key" />
          Create key
        </button>
      </div>
      {newToken ? (
        <div className="new-token">
          <b>Copy this key now, it is shown only once.</b>
          <CodeLine value={newToken} />
        </div>
      ) : null}
      <h4 style={{ marginTop: "16px" }}>Endpoints</h4>
      <div className="endpoint-list">
        <div>
          <span className="muted">Nutrition per day and person, live</span>
          <CodeLine value={origin + "/api/export/nutrition?date=YYYY-MM-DD"} />
        </div>
        <div>
          <span className="muted">Saved daily exports</span>
          <CodeLine value={origin + "/api/export/nutrition/daily?start=YYYY-MM-DD"} />
        </div>
        <div>
          <span className="muted">Event feed for polling</span>
          <CodeLine value={origin + "/api/automation/events?after=0"} />
        </div>
        <div>
          <span className="muted">Current state</span>
          <CodeLine value={origin + "/api/automation/state"} />
        </div>
        <p className="muted" style={{ fontSize: "var(--s-1)" }}>
          Send the key as a header: Authorization: Bearer KEY. POST /api/automation/shopping and /api/automation/meals add items and dishes.
        </p>
      </div>
      <div className="row" style={{ marginTop: "8px" }}>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            act("POST", "/api/integrations/export-now").then(() => {
              toast("Exported");
              refresh();
            }, errorToast);
          }}
        >
          <Icon name="refresh" />
          Export now
        </button>
      </div>
      <h4 style={{ marginTop: "16px" }}>Webhooks</h4>
      <div className="stack tight">
        {integrations.webhooks.length ? (
          integrations.webhooks.map((hook) => (
            <div key={hook.id} className="list-row">
              <Icon name="link" />
              <div className="grow" style={{ minWidth: 0 }}>
                <b className="ellipsis" style={{ display: "block" }}>
                  {hook.name}
                </b>
                <div className="muted ellipsis" style={{ fontSize: "var(--s-1)" }}>
                  {hook.events.join(", ")}
                </div>
                {hook.last_status ? <span className={"chip " + (hook.last_status.startsWith("2") ? "good" : "bad")}>Last: {hook.last_status}</span> : null}
              </div>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  act<{ ok: boolean; status: string | null }>("POST", "/api/integrations/webhooks/" + String(hook.id) + "/test").then((result) => {
                    toast(result.ok ? "Delivered" : "Failed: " + String(result.status), !result.ok);
                    refresh();
                  }, errorToast);
                }}
              >
                Test
              </button>
              <button
                type="button"
                className="btn small ghost danger"
                onClick={() => {
                  act("DELETE", "/api/integrations/webhooks/" + String(hook.id)).then(refresh, errorToast);
                }}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No webhooks. Add one to push events to Home Gym, Home Assistant, n8n or your own service.</p>
        )}
      </div>
      <div className="stack tight" style={{ marginTop: "8px" }}>
        <input className="input" placeholder="https://..." aria-label="Webhook address" value={hookUrl} onChange={(event) => setHookUrl(event.target.value)} />
        <select
          className="input"
          multiple
          size={5}
          aria-label="Events"
          value={events}
          onChange={(event) => setEvents([...event.target.selectedOptions].map((option) => option.value))}
        >
          <option value="*">All events</option>
          {integrations.event_types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn small primary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            act<{ secret: string }>("POST", "/api/integrations/webhooks", { url: hookUrl, events: events.includes("*") || !events.length ? ["*"] : events }).then((created) => {
              openSheet((close) => <SecretBody secret={created.secret} close={close} />, { label: "Webhook added" });
              setHookUrl("");
              refresh();
            }, () => undefined);
          }}
        >
          <Icon name="link" />
          Add webhook
        </button>
      </div>
    </section>
  );
}
