import { api } from "../../scripts/api.js";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function restartAndReload(bootId) {
  let requestError = null;
  try {
    const reboot = await api.fetchApi("/v2/manager/reboot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10000)
    });
    if (!reboot.ok) requestError = `Risposta HTTP ${reboot.status}: ${await reboot.text()}`;
  } catch (error) {
    // A proxy/HTTP failure can occur even when the server successfully restarts.
    requestError = error.message || String(error);
  }

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await delay(1500);
    try {
      const response = await api.fetchApi("/manga-rework/update-status", {
        cache: "no-store",
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok && (await response.json()).boot_id !== bootId) {
        window.location.reload();
        return true;
      }
    } catch { /* The server may still be restarting. */ }
  }

  throw new Error("Il riavvio non è stato confermato entro due minuti. Controlla il servizio ComfyUI."
    + (requestError ? ` Dettaglio richiesta: ${requestError}` : ""));
}
