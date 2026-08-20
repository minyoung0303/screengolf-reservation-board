import { contextBridge, ipcRenderer } from 'electron';

/**
 * 카운터 PC(이 프로그램 창)에서는 PIN 없이 바로 쓸 수 있도록
 * 실행할 때 만든 1회용 토큰을 화면 쪽에 전달한다.
 * 폰/태블릿 브라우저에는 이 객체가 없으므로 PIN 화면이 뜬다.
 */
contextBridge.exposeInMainWorld('yeyakbo', {
  getInfo: () => ipcRenderer.invoke('yb:info'),
  openBackupFolder: () => ipcRenderer.invoke('yb:openBackupFolder'),
  print: () => ipcRenderer.invoke('yb:print'),
});
