import { boot } from './app';
import { resolveTheme } from './themes/registry';

resolveTheme().then((theme) => boot(theme)).catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#ff5a5a;padding:2em">${String(e)}</pre>`;
});
