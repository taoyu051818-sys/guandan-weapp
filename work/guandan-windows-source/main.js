import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 768,
    title: "掼蛋大师 - Guandan Master",
    icon: path.join(__dirname, 'public', 'vite.svg'), // 假如有图标的话
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 加载打包后的静态文件
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));

  // 隐藏菜单栏
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});