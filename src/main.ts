import './styles.css';
import { store } from './state';
import { sampleHouse } from './templates';
import { App } from './ui/app';

async function start() {
  const restored = await store.restore();
  if (!restored) store.load(sampleHouse());
  const app = new App(document.getElementById('app')!);
  (window as any).hds = { store, app };
  if (!restored) setTimeout(() => app.helpModal(), 600);

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
