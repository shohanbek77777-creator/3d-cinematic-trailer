import './styles/main.css';
import { App } from './app/App.js';
import { Layout } from './ui/Layout.js';
import { toast } from './ui/dom.js';

async function boot() {
  const root = document.getElementById('app');
  const layout = new Layout(root);
  const app = new App();
  window.__app = app; // handy for debugging from the console
  try {
    await app.init(layout.viewportEl);
  } catch (e) {
    console.error(e);
    root.querySelector('.vp-loading span').textContent = `Failed to start: ${e.message}`;
    if (!document.createElement('canvas').getContext('webgl2')) toast('WebGL 2 is not available in this browser.', 'error');
    return;
  }
  layout.mount(app);
}

boot();
