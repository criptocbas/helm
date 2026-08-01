import { invoke } from "@tauri-apps/api/core";

export function notifyOs(title: string, body: string) {
  void invoke("show_notification", { title, body }).catch(() => {
    /* optional */
  });
}
