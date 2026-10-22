import { describe, expect, it } from "vitest";
import { offlineText } from "../OfflinePill";
import { routeKey } from "../useAutoRefresh";
import { urlBase64ToUint8Array } from "../push";

describe("app helpers", () => {
  it("describes the offline state", () => {
    expect(offlineText(true, 0)).toBeNull();
    expect(offlineText(false, 0)).toBe("Offline");
    expect(offlineText(false, 2)).toBe("Offline, 2 changes waiting");
    expect(offlineText(true, 1)).toBe("Syncing 1 saved change");
    expect(offlineText(true, 3)).toBe("Syncing 3 saved changes");
  });

  it("finds the section of a path", () => {
    expect(routeKey("/")).toBe("today");
    expect(routeKey("/m")).toBe("today");
    expect(routeKey("/m/shop")).toBe("shop");
    expect(routeKey("/plan")).toBe("plan");
    expect(routeKey("/media")).toBe("media");
  });

  it("decodes the push key", () => {
    expect([...urlBase64ToUint8Array("AQID_w")]).toEqual([1, 2, 3, 255]);
  });
});
