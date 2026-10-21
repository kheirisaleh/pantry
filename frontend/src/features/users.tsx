import { setUser, useBoot, userStore, useUser } from "@/app/session";
import type { User } from "@/lib/types";
import { Avatar } from "@/ui/common";
import { openSheet, SheetLayout } from "@/ui/modal";

function Chooser({ close, onPicked }: { close: () => void; onPicked?: (user: User) => void }) {
  const boot = useBoot();
  return (
    <SheetLayout title="Who is using this device?" onClose={close}>
      <div className="row wrap" style={{ justifyContent: "center", gap: "18px", padding: "12px 0" }}>
        {boot.users.map((user) => (
          <button
            key={user.id}
            type="button"
            className="btn"
            style={{ minHeight: "88px", minWidth: "140px", flexDirection: "column", borderColor: user.color }}
            onClick={() => {
              setUser(user);
              close();
              onPicked?.(user);
            }}
          >
            <Avatar name={user.name} color={user.color} size={34} />
            {user.name}
          </button>
        ))}
      </div>
    </SheetLayout>
  );
}

export function userChooser(onPicked?: (user: User) => void): void {
  openSheet((close) => <Chooser close={close} {...(onPicked ? { onPicked } : {})} />, { label: "Choose who is using this device" });
}

export function UserBadge() {
  const user = useUser();
  if (!user) return <span />;
  return (
    <button type="button" className="btn ghost small" title="Switch user" onClick={() => userChooser()}>
      <Avatar name={user.name} color={user.color} />
      {user.name}
    </button>
  );
}

export function needsUser(): boolean {
  return userStore.get() === null;
}
