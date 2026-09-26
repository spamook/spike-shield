import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Spike Shield: wait until the visitor is admitted before the app starts. If shield.js failed to
// load, SpikeShield is undefined and the app starts normally.
const shieldReady: Promise<void> =
  (window as unknown as { SpikeShield?: { ready: Promise<void> } }).SpikeShield?.ready ??
  Promise.resolve();

shieldReady.then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
