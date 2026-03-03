import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
  let isApplyingUpdate = false;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdates = () => {
        void registration.update().catch(() => {
          // Ignore transient update-check failures (offline/timeout).
        });
      };

      checkForUpdates();
      window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener("focus", checkForUpdates);
      window.addEventListener("online", checkForUpdates);
    },
    onNeedRefresh() {
      if (isApplyingUpdate) {
        return;
      }
      isApplyingUpdate = true;

      toast("New version available. Updating now...", {
        duration: 1500,
      });

      const forceReload = () => {
        window.location.reload();
      };

      const applyUpdate = async () => {
        const fallbackReloadTimer = window.setTimeout(forceReload, 5000);
        const handleControllerChange = () => {
          window.clearTimeout(fallbackReloadTimer);
          forceReload();
        };

        navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange, {
          once: true,
        });

        try {
          await updateSW(true);
        } catch {
          window.clearTimeout(fallbackReloadTimer);
          forceReload();
        }
      };

      window.setTimeout(() => {
        void applyUpdate();
      }, 600);
    },
    onOfflineReady() {
      toast.success("Offline cache is ready.");
    },
  });
}
