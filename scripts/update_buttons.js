import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let running = false;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function restartAndReload(bootId) {
    let requestError = null;
    try {
      const reboot = await api.fetchApi("/v2/manager/reboot", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000)
      });
      if (!reboot.ok) requestError = `Risposta HTTP ${reboot.status}: ${await reboot.text()}`;
    } catch (error) {
      // HTTP failures can be produced by the server/proxy during a successful restart.
      // Decide from the new boot ID, not from the restart request response.
      requestError = error.message || String(error);
    }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await delay(1500);
      try {
        const status = await api.fetchApi("/manga-rework/update-status", {
          cache: "no-store", signal: AbortSignal.timeout(4000)
        });
        if (status.ok && (await status.json()).boot_id !== bootId) {
          window.location.reload();
          return true;
        }
      } catch { /* Server may still be restarting. */ }
    }
    throw new Error("Il riavvio non è stato confermato entro due minuti. Controlla il servizio ComfyUI."
      + (requestError ? ` Dettaglio richiesta: ${requestError}` : ""));
}

async function updateAndRestart() {
  if (running) return true;
  running = true;
  const toast = app.extensionManager.toast;
  let progress = toast.loading("Aggiornamento delle estensioni in corso");
  try {
    const response = await api.fetchApi("/manga-rework/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
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
    if (result.errors?.length) {
      console.error("[Comfy UI Additions] Alcune estensioni non sono state aggiornate:", result.errors);
    }
    toast.dismiss(progress);
    if (result.changed !== true) {
      toast.info("Tutte le estensioni sono già aggiornate. Nessun riavvio necessario.");
      return true;
    }
    progress = toast.loading("Riavvio di ComfyUI in corso");
    await restartAndReload(result.boot_id);
  } catch (error) {
    toast.error("Comfy UI Additions", { description: error.message || String(error), duration: 15000 });
  } finally {
    toast.dismiss(progress);
    running = false;
  }
  return true;
}

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
    toast.error("Comfy UI Additions", { description: error.message || String(error), duration: 15000 });
  } finally {
    toast.dismiss(progress);
    running = false;
  }
  return true;
}

app.registerExtension({
  name: "comfy-manga-rework.update-restart",
  setup() {
    // Templates is rendered after extension tabs by ComfyUI 1.57.
    // Order only our two buttons after all standard items in the top group.
    const style = document.createElement("style");
    style.id = "manga-rework-sidebar-action-order";
    style.textContent = `
      [data-testid="sidebar-top-group"] > [data-testid="manga_rework_update_restart-tab-button"] { order: 10000; }
      [data-testid="sidebar-top-group"] > [data-testid="manga_rework_restart-tab-button"] { order: 10001; }
    `;
    document.getElementById(style.id)?.remove();
    document.head.appendChild(style);
    app.extensionManager.registerSidebarTab({
      id: "manga_rework_update_restart", type: "custom",
      title: "Update Extensions", label: "Update",
      tooltip: "Aggiorna le estensioni elencate in extensions.txt e riavvia ComfyUI se almeno una cambia",
      icon: "pi pi-refresh", render() {},
      onToggle: updateAndRestart
    });
    app.extensionManager.registerSidebarTab({
      id: "manga_rework_restart", type: "custom",
      title: "Restart ComfyUI", label: "Restart",
      tooltip: "Riavvia ComfyUI senza aggiornare le estensioni",
      icon: "icon-[lucide--play]", render() {},
      onToggle: restartOnly
    });
  }
});
