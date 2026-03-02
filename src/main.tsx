import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";
import { notificationService } from "./services/notificationService";
import { AuthService } from "./services/authService";

createRoot(document.getElementById("root")!).render(<App />);

let currentUserId: string | null = null;
AuthService.subscribeToAuthChanges((user) => {
  currentUserId = user?.id ?? null;
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;

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
      toast("New version available. Updating now...", {
        duration: 1500,
      });
      window.setTimeout(() => {
        void updateSW(true);
      }, 800);

      if (currentUserId) {
        void (async () => {
          try {
            await notificationService.createForUser(currentUserId, {
              type: 'activity',
              title: 'Update available',
              message: 'A new version of the app is available. Refresh to apply updates.',
            });
          } catch (err) {
            // Best-effort; don't block the UX if notification write fails
            console.error('Failed to create update notification for user', err);
          }
        })();
      }
    },
    onOfflineReady() {
      toast.success("Offline cache is ready.");
    },
  });
}
