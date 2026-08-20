import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import { setDesktopToken } from '../server/auth';
import { backupNow, lanUrls, resolveBackupDir } from '../server/backup';
import { closeDatabase, deleteExpiredSessions, openDatabase, purgeOldReservations } from '../server/db';
import { createRoutes } from '../server/api';
import { startServer, type ServerHandle } from '../server/server';

// YB_FORCE_PROD=1 은 패키징 없이 배포 동작(내장 화면 파일 사용)을 확인할 때 쓴다.
const DEV = !app.isPackaged && process.env.YB_FORCE_PROD !== '1';
const BASE_PORT = Number(process.env.YB_PORT ?? 5180);

let mainWindow: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let actualPort = BASE_PORT;

const desktopToken = crypto.randomBytes(24).toString('base64url');

if (process.platform === 'win32') app.setAppUserModelId('com.anbambi.yeyakbo');

// 프로그램을 두 번 실행하면 데이터가 두 갈래로 갈릴 수 있으므로 하나만 뜨게 한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();

  // YB_DATA_DIR 은 시범운영·문제 진단용으로 데이터 위치를 따로 지정할 때 쓴다.
  const userDataDir = process.env.YB_DATA_DIR
    ? path.resolve(process.env.YB_DATA_DIR)
    : app.getPath('userData');

  try {
    openDatabase(path.join(userDataDir, 'data.db'));
    deleteExpiredSessions(30);
    purgeOldReservations();
    // 켤 때마다 자동 백업. PC 가 고장 나도 이 파일 하나로 복구된다.
    backupNow(userDataDir);
  } catch (error) {
    dialog.showErrorBox(
      '데이터 파일을 열 수 없어요',
      `${String(error)}\n\n경로: ${userDataDir}\n\n프로그램을 다시 실행해보고, 계속 같은 문제가 나면 알려주세요.`,
    );
    app.quit();
    return;
  }

  setDesktopToken(desktopToken);

  try {
    server = await listenWithFallback(userDataDir);
  } catch (error) {
    dialog.showErrorBox(
      '서버를 시작할 수 없어요',
      `${String(error)}\n\n다른 프로그램이 ${BASE_PORT} 번 포트를 쓰고 있을 수 있어요.`,
    );
    app.quit();
    return;
  }

  ipcMain.handle('yb:info', () => ({
    token: desktopToken,
    isDesktop: true,
    version: app.getVersion(),
    port: actualPort,
    userDataDir,
    backupDir: resolveBackupDir(userDataDir),
    lanUrls: lanUrls(actualPort),
  }));

  ipcMain.handle('yb:openBackupFolder', () => {
    const dir = resolveBackupDir(userDataDir);
    return shell.openPath(dir);
  });

  ipcMain.handle('yb:print', () => {
    mainWindow?.webContents.print({ silent: false, printBackground: true });
    return true;
  });

  createWindow();
  buildMenu(userDataDir);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

async function listenWithFallback(userDataDir: string): Promise<ServerHandle> {
  const routes = createRoutes({
    userDataDir,
    version: app.getVersion(),
    getPort: () => actualPort,
  });
  const staticDir = DEV ? null : path.join(__dirname, '..', 'renderer');

  let lastError: unknown = null;
  for (let port = BASE_PORT; port < BASE_PORT + 12; port += 1) {
    try {
      const handle = await startServer({ port, routes, staticDir });
      actualPort = handle.port;
      console.log(`[예약보드] 서버 시작: http://localhost:${actualPort}`);
      return handle;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('사용 가능한 포트를 찾지 못했습니다.');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: '예약보드',
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (DEV) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  const url = DEV ? 'http://localhost:5173' : `http://127.0.0.1:${actualPort}`;
  void mainWindow.loadURL(url);

  // 외부 링크는 기본 브라우저로 보낸다.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(userDataDir: string): void {
  const menu = Menu.buildFromTemplate([
    {
      label: '파일',
      submenu: [
        {
          label: '지금 백업하기',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            try {
              const result = backupNow(userDataDir);
              void dialog.showMessageBox({
                type: 'info',
                title: '백업 완료',
                message: '예약 데이터를 백업했어요.',
                detail: result.file,
                buttons: ['확인', '폴더 열기'],
              }).then((r) => {
                if (r.response === 1) void shell.openPath(result.dir);
              });
            } catch (error) {
              dialog.showErrorBox('백업 실패', String(error));
            }
          },
        },
        {
          label: '백업 폴더 열기',
          click: () => void shell.openPath(resolveBackupDir(userDataDir)),
        },
        { type: 'separator' },
        { label: '인쇄', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print({ silent: false, printBackground: true }) },
        { type: 'separator' },
        { label: '종료', role: 'quit' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '새로고침', role: 'reload' },
        { label: '확대', role: 'zoomIn' },
        { label: '축소', role: 'zoomOut' },
        { label: '기본 크기', role: 'resetZoom' },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen' },
        ...(DEV ? [{ label: '개발자 도구', role: 'toggleDevTools' as const }] : []),
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '폰·태블릿 접속 주소',
          click: () => {
            const urls = lanUrls(actualPort);
            void dialog.showMessageBox({
              type: 'info',
              title: '폰·태블릿 접속 주소',
              message:
                urls.length > 0
                  ? '폰·태블릿에는 설치할 것이 없어요. 같은 와이파이에서 아래 주소를 브라우저로 열면 됩니다.'
                  : '네트워크에 연결되어 있지 않아요.',
              detail: [
                ...urls,
                '',
                '접속하면 PIN을 물어봅니다.',
                '화면 오른쪽 위 "폰 연결" 버튼을 누르면 QR 코드가 크게 나와서,',
                '폰 카메라로 찍어 바로 열 수 있어요.',
              ].join('\n'),
            });
          },
        },
        {
          label: '프로그램 정보',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '예약보드',
              message: `예약보드 ${app.getVersion()}`,
              detail: [
                '타석 예약 관리 프로그램 (직원용)',
                `데이터 위치: ${path.join(userDataDir, 'data.db')}`,
                `백업 폴더: ${resolveBackupDir(userDataDir)}`,
              ].join('\n'),
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.on('window-all-closed', () => {
  void shutdown();
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server?.close();
  } catch {
    /* 무시 */
  }
  try {
    closeDatabase();
  } catch {
    /* 무시 */
  }
  app.quit();
}

app.on('before-quit', () => {
  try {
    closeDatabase();
  } catch {
    /* 무시 */
  }
});
