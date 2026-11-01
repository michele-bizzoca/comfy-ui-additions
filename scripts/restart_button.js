import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { restartAndReload } from "./button_utils.js";

const SETTING_ID = "ComfyUIAdditions.RestartButton.Enabled";
const TAB_ID = "manga_rework_restart";
let running = false;
let registered = false;

async function restartOnly() {
  if (running) return true;
  running = true;
  const toast = app.extensionManager.toast;
  const progress = toast.loading("Riavvio di ComfyUI in corso");
  try {
    const response = await api.fetchApi("/manga-rework/update-status", { cache: "no-store" });
    if (!response.ok) throw new Error("Impossibile verificare lo stato di ComfyUI");
    const status = await response.json();
    if (status.busy) throw new Error("Attendi che la coda di ComfyUI sia vuota prima di riavviare.");
    await restartAndReload(status.boot_id);
  } catch (error) {
    toast.error("Comfy UI Additions", {
      description: error.message || String(error),
      duration: 15000
    });
  } finally {
    toast.dismiss(progress);
    running = false;
  }
  return true;
}

function syncButton(enabled) {
  const shouldRegister = enabled !== false;
  if (shouldRegister && !registered) {
    app.extensionManager.registerSidebarTab({
      id: TAB_ID,
      type: "custom",
      title: "Restart ComfyUI",
      label: "Restart",
      tooltip: "Riavvia ComfyUI senza aggiornare le estensioni",
      icon: "icon-[lucide--play]",
      render() {},
      onToggle: restartOnly
    });
    registered = true;
  } else if (!shouldRegister && registered) {
    app.extensionManager.unregisterSidebarTab(TAB_ID);
    registered = false;
  }
}

app.registerExtension({
  name: "comfy-ui-additions.restart-button",
  setup() {
    app.ui.settings.addSetting({
      id: SETTING_ID,
      category: ["Comfy UI Additions"],
      name: "Restart Button",
      type: "boolean",
      defaultValue: true,
      tooltip: "Show or hide the Restart button in the ComfyUI sidebar.",
      onChange: syncButton
    });
    syncButton(app.ui.settings.getSettingValue(SETTING_ID) !== false);
  }
});
