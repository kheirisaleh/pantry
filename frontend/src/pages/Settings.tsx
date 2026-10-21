import { useState } from "react";
import { useMobile } from "@/app/mobile";
import { enablePush, pushStatus, type PushState } from "@/app/push";
import { refreshBoot, setUser, useBoot, userStore, useUser } from "@/app/session";
import { View } from "@/app/View";
import { AlexaPanel, AssistantPanel, AutomationPanel } from "@/features/settings";
import { userChooser } from "@/features/users";
import { get } from "@/lib/api";
import { parseNumber, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { AiStatus, User } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { PageHead } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { toast } from "@/ui/toast";

function PersonRow({ user }: { user: User }) {
  const [name, setName] = useState(user.name);
  const [color, setColor] = useState(user.color);
  return (
    <div className="row" style={{ marginTop: "10px" }}>
      <input type="color" aria-label={"Colour for " + user.name} value={color} onChange={(event) => setColor(event.target.value)} style={{ width: "44px", height: "40px", border: "0", background: "transparent" }} />
      <input className="input" aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <button
        type="button"
        className="btn small"
        onClick={() => {
          act<User[]>("PATCH", "/api/users/" + String(user.id), { name, color }).then(async (users) => {
            await refreshBoot();
            const fresh = users.find((entry) => entry.id === user.id);
            if (fresh && userStore.get()?.id === user.id) setUser(fresh);
            toast("Saved");
          }, () => undefined);
        }}
      >
        Save
      </button>
    </div>
  );
}

function ServingsPanel() {
  const boot = useBoot();
  const [servings, setServings] = useState(trim(boot.default_servings, 1));
  return (
    <section className="panel">
      <h3>Planning</h3>
      <div className="row" style={{ marginTop: "10px" }}>
        <span className="grow soft">People per meal by default</span>
        <input className="input num" inputMode="decimal" aria-label="People per meal" style={{ width: "90px" }} value={servings} onChange={(event) => setServings(event.target.value)} />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            act("PATCH", "/api/settings", { default_servings: parseNumber(servings) }).then(async () => {
              await refreshBoot();
              toast("Saved");
            }, () => undefined);
          }}
        >
          Save
        </button>
      </div>
    </section>
  );
}

function PushPanel({ state, onChange }: { state: PushState; onChange: () => void }) {
  return (
    <section className="panel">
      <h3>Notifications on this device</h3>
      <p className="soft" style={{ margin: "8px 0" }}>
        {state === "on" ? "On." : state === "unsupported" ? "Not available here. On iPhone, open Pantry from the home screen icon." : "Off."}
      </p>
      <div className="row">
        {state === "off" ? (
          <button
            type="button"
            className="btn primary small"
            onClick={() => {
              enablePush().then((ok) => (ok ? onChange() : undefined), () => toast("Notifications could not be turned on", true));
            }}
          >
            <Icon name="bell" />
            Turn on
          </button>
        ) : null}
        {state === "on" ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              act<{ sent: number }>("POST", "/api/push/test").then((result) => toast("Sent to " + String(result.sent) + " device" + (result.sent === 1 ? "" : "s")), () => undefined);
            }}
          >
            Send a test
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function SettingsPage() {
  const mobile = useMobile();
  const boot = useBoot();
  const user = useUser();
  const data = useResource(
    async (signal) => {
      const [ai, push] = await Promise.all([get<AiStatus>("/api/ai", { signal }), pushStatus().catch((): PushState => "unsupported")]);
      return { ai, push };
    },
    [],
    ["settings", "boot"],
  );
  return (
    <View route="settings" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => (
        <>
          <PageHead title="Settings" />
          <div className="report-grid">
            <section className="panel">
              <h3>People</h3>
              {boot.users.map((entry) => (
                <PersonRow key={entry.id} user={entry} />
              ))}
              <div className="row" style={{ marginTop: "12px" }}>
                <span className="soft grow">This device: {user ? user.name : "nobody"}</span>
                <button type="button" className="btn small" onClick={() => userChooser()}>
                  Switch
                </button>
              </div>
            </section>
            <ServingsPanel />
            <PushPanel state={data.data!.push} onChange={data.reload} />
            <AssistantPanel key={JSON.stringify(data.data!.ai.models.map((entry) => entry.name))} ai={data.data!.ai} />
            <AlexaPanel />
            <AutomationPanel />
            {!mobile ? (
              <section className="panel">
                <h3>Phone app</h3>
                <p className="soft" style={{ marginTop: "8px" }}>
                  Open the mobile version on the phone through your home network or VPN address, then Share, Add to Home Screen.
                </p>
                <a className="btn small" href="/m" style={{ marginTop: "10px" }}>
                  Open mobile version
                </a>
              </section>
            ) : null}
          </div>
        </>
      )}
    </View>
  );
}
