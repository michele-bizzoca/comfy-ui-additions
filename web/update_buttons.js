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
  let progress = toast.loading("Comfy Manga Rework: aggiornamento in corso");
  try {
    const response = await api.fetchApi("/manga-rework/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Pull non riuscito");
    console.info("[Comfy Manga Rework]", result.output);
    toast.dismiss(progress);
    if (result.changed !== true) {
      toast.info("Comfy Manga Rework è già aggiornato. Nessun riavvio necessario.");
      return true;
    }
    progress = toast.loading("Riavvio di ComfyUI in corso");
    await restartAndReload(result.boot_id);
  } catch (error) {
    toast.error("Comfy Manga Rework", { description: error.message || String(error), duration: 15000 });
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
    toast.error("Comfy Manga Rework", { description: error.message || String(error), duration: 15000 });
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
      title: "Update Manga Rework", label: "Update",
      tooltip: "Aggiorna Comfy Manga Rework e riavvia ComfyUI",
      icon: "pi pi-refresh", render() {},
      onToggle: updateAndRestart
    });
    app.extensionManager.registerSidebarTab({
      id: "manga_rework_restart", type: "custom",
      title: "Restart ComfyUI", label: "Restart",
      tooltip: "Riavvia ComfyUI senza aggiornare l’estensione",
      icon: "icon-[lucide--play]", render() {},
      onToggle: restartOnly
    });
  }
});
