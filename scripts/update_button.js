import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { restartAndReload } from "./button_utils.js";

const SETTING_ID = "ComfyUIAdditions.UpdateButton.Enabled";
const TAB_ID = "manga_rework_update_restart";
let running = false;
let registered = false;

async function updateAndRestart() {
  if (running) return true;
  running = true;
  const toast = app.extensionManager.toast;
  let progress = toast.loading("Aggiornamento delle estensioni in corso");
  try {
    const response = await api.fetchApi("/manga-rework/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.output) console.info("[Comfy UI Additions]", result.output);
      if (result.errors?.length) {
        console.error("[Comfy UI Additions] Repository non aggiornati:", result.errors);
        const failedRepositories = result.errors.map(item => item.extension).filter(Boolean);
        if (failedRepositories.length) {
          throw new Error(`Pull non riuscito per: ${failedRepositories.join(", ")}. ComfyUI non verrà riavviato.`);
        }
      }
      throw new Error(result.error || "Aggiornamento non riuscito");
    }

    console.info("[Comfy UI Additions]", result.output);
    toast.dismiss(progress);
    if (result.changed !== true) {
      toast.info("Tutte le estensioni sono già aggiornate. Nessun riavvio necessario.");
      return true;
    }
    progress = toast.loading("Riavvio di ComfyUI in corso");
    await restartAndReload(result.boot_id);
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
      title: "Update Extensions",
      label: "Update",
      tooltip: "Aggiorna le estensioni elencate in extensions.txt e riavvia ComfyUI se almeno una cambia",
      icon: "pi pi-refresh",
      render() {},
      onToggle: updateAndRestart
    });
    registered = true;
  } else if (!shouldRegister && registered) {
    app.extensionManager.unregisterSidebarTab(TAB_ID);
    registered = false;
  }
}

app.registerExtension({
  name: "comfy-ui-additions.update-button",
  setup() {
    const style = document.createElement("style");
    style.id = "comfy-ui-additions-sidebar-action-order";
    style.textContent = `
      [data-testid="sidebar-top-group"] > [data-testid="manga_rework_update_restart-tab-button"] { order: 10000; }
      [data-testid="sidebar-top-group"] > [data-testid="manga_rework_restart-tab-button"] { order: 10001; }
    `;
    document.getElementById(style.id)?.remove();
    document.head.appendChild(style);

    app.ui.settings.addSetting({
      id: SETTING_ID,
      category: ["Comfy UI Additions"],
      name: "Update Button",
      type: "boolean",
      defaultValue: true,
      tooltip: "Show or hide the Update button in the ComfyUI sidebar.",
      onChange: syncButton
    });
    syncButton(app.ui.settings.getSettingValue(SETTING_ID) !== false);
  }
});
