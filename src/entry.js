// Keep the two game module graphs separate: tennis never allocates the shooter's ink atlas or battle scene.
import { selectGame } from './game-route.js';
const original = selectGame(location.search) === 'inkwave';

try {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = original ? './styles/ui.css' : './styles/tennis.css';
  const styled = new Promise((resolve, reject) => {
    stylesheet.onload = resolve;
    stylesheet.onerror = () => reject(new Error('无法加载界面样式，请刷新页面。'));
  });
  document.head.appendChild(stylesheet);
  await styled;
  if (original) {
    document.title = 'INKWAVE — Turf Riot';
    await import('./main.js');
  } else {
    document.documentElement.lang = 'zh-CN';
    document.title = 'INKWAVE RALLY — 网球机器人对决';
    await import('./tennis/game.js');
  }
} catch (error) {
  console.error('[inkwave] startup failed', error);
  const box = document.getElementById('boot-error');
  box.replaceChildren(document.createTextNode(`游戏加载失败：${error.message} `));
  const reload = document.createElement('a');
  reload.href = location.href;
  reload.textContent = '重新加载';
  reload.style.color = 'inherit';
  box.appendChild(reload);
  box.style.display = 'block';
  document.getElementById('fade').style.display = 'none';
}
