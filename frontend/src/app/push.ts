import { act } from "@/lib/offline";
import { toast } from "@/ui/toast";
import { bootStore } from "./session";

export type PushState = "on" | "off" | "unsupported";

export function urlBase64ToUint8Array(text: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob((text + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function pushStatus(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return "off";
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

export async function enablePush(): Promise<boolean> {
  const vapid = bootStore.get()?.vapid;
  if (!supported() || !vapid) {
    toast("On iPhone, add Pantry to the home screen first, then turn on notifications from there.", true);
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notifications were not allowed", true);
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) });
  await act("POST", "/api/push/subscribe", subscription.toJSON());
  toast("Notifications are on");
  return true;
}
