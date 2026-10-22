import { refreshBoot } from "@/app/session";
import { invalidateAll } from "@/lib/store";

export function changed(): void {
  invalidateAll();
  void refreshBoot();
}
