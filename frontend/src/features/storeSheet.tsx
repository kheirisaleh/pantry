import { useState } from "react";
import { useBoot } from "@/app/session";
import { openSheet, SheetLayout } from "@/ui/modal";
import { startSession } from "./shop";

function StoreBody({ close, onStarted }: { close: () => void; onStarted?: (() => void) | undefined }) {
  const stores = useBoot().stores;
  const [name, setName] = useState("");
  return (
    <SheetLayout
      title="Where are you shopping?"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              close();
              startSession(name).then(
                () => onStarted?.(),
                () => undefined,
              );
            }}
          >
            Start
          </button>
        </>
      }
    >
      <div className="stack">
        <input className="input" placeholder="Rewe, Aldi, Lidl, Persian shop" list="pantry-stores" aria-label="Store" value={name} onChange={(event) => setName(event.target.value)} />
        <datalist id="pantry-stores">
          {stores.map((store) => (
            <option key={store} value={store} />
          ))}
        </datalist>
        {stores.length ? (
          <div className="row wrap">
            {stores.slice(0, 6).map((store) => (
              <button key={store} type="button" className="chip" onClick={() => setName(store)}>
                {store}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </SheetLayout>
  );
}

export function openStoreSheet(onStarted?: () => void): void {
  openSheet((close) => <StoreBody close={close} onStarted={onStarted} />, { label: "Where are you shopping?" });
}
