/** Refresh the browser once when the ComfyUI *server process* changes. */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const SETTING_ID = "ComfyUIAdditions.AutoReload.Enabled";
const ENDPOINT = "/comfy-ui-additions/auto-reload/instance";

app.registerExtension({
    name: "comfy-ui-additions.auto-reload",

    async setup() {
        app.ui.settings.addSetting({
            id: SETTING_ID,
            category: ["Comfy UI Additions"],
            name: "Auto Reload",
            type: "boolean",
            defaultValue: true,
            tooltip: "Reload this browser tab when the ComfyUI backend process restarts. Unsaved UI changes may be lost.",
        });

        let knownInstance = null;
        let checking = false;
        let reloadPending = false;

        async function checkInstance() {
            if (checking || reloadPending) return;
            checking = true;
            try {
                const response = await api.fetchApi(ENDPOINT, { cache: "no-store" });
                if (!response.ok) return;
                const { instance_id: instanceId } = await response.json();
                if (typeof instanceId !== "string" || !instanceId) return;

                if (knownInstance !== null && instanceId !== knownInstance) {
                    // Do not discard the old identity when disabled, so that
                    // turning the setting back on is meaningful on next reconnect.
                    if (app.ui.settings.getSettingValue(SETTING_ID)) {
                        reloadPending = true;
                        window.location.reload();
                        return;
                    }
                }
                knownInstance = instanceId;
            } catch (error) {
                // A connection failure during server startup is expected.
                console.debug("[comfy-auto-reload] Server not ready yet:", error);
            } finally {
                checking = false;
            }
        }

        // First successful request establishes a baseline (no initial refresh).
        await checkInstance();
        // A websocket reconnect can occur without a process restart.
        // Compare process identities to prevent reloads for network glitches.
        api.addEventListener("reconnected", checkInstance);
    },
});
