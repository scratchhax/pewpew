import { boot } from './app';
import { sciFi } from './themes/scifi';

boot(sciFi).catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#ff5a5a;padding:2em">${String(e)}</pre>`;
});
