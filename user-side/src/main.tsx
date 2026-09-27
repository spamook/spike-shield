import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Spike Shield: wait until the visitor is admitted before the app starts. Without shield.js
// (the :4173 build) SpikeShield is undefined and the app starts at once, so both builds share
// this file. This is the second change the install prompt makes.
const shieldReady: Promise<void> =
  (window as unknown as { SpikeShield?: { ready: Promise<void> } }).SpikeShield?.ready ??
  Promise.resolve();

shieldReady.then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
