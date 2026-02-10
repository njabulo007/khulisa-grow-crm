import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

const clearKhulisaCaches = async (): Promise<void> => {
  if (!("caches" in window)) return;
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith("khulisa-crm-cache"))
      .map((name) => caches.delete(name))
  );
};

const cleanupServiceWorkersForDev = async (): Promise<void> => {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  await clearKhulisaCaches();
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      return;
    }
    void cleanupServiceWorkersForDev().catch(() => undefined);
  });
}
