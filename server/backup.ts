import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkpoint, getDbPath, getSettings, logChange } from './db';

const KEEP = 30;

export function defaultBackupDir(userDataDir: string): string {
  return path.join(userDataDir, 'backups');
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function resolveBackupDir(userDataDir: string): string {
  const configured = getSettings().backupDir.trim();
  return configured || defaultBackupDir(userDataDir);
}

/**
 * DB 파일을 그대로 복사한다. WAL 을 먼저 본 파일에 반영해야 최신 예약까지 백업된다.
 * 백업 폴더를 OneDrive 안으로 지정하면 자동으로 클라우드에도 올라간다.
 */
export function backupNow(userDataDir: string): { file: string; dir: string } {
  const dir = resolveBackupDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  checkpoint();
  const target = path.join(dir, `예약보드-${stamp()}.db`);
  fs.copyFileSync(getDbPath(), target);
  prune(dir);
  logChange('backup', null, 'system', { file: target });
  return { file: target, dir };
}

function prune(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, old.f));
    } catch {
      /* 삭제 실패는 무시 */
    }
  }
}

export function listBackups(userDataDir: string): { name: string; size: number; at: string }[] {
  const dir = resolveBackupDir(userDataDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, at: new Date(st.mtimeMs).toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** 가상 네트워크 어댑터(WSL, VMware, Hyper-V 등)는 폰에서 접속할 수 없으므로 제외한다. */
const VIRTUAL_ADAPTER = /vethernet|vmware|virtualbox|hyper-?v|wsl|tap-|loopback|bluetooth|zerotier|tailscale|radmin|npcap/i;

/** 공유기가 주는 사설망 주소를 앞쪽에 둔다. 192.168 이 가장 흔하다. */
function rank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

/** 같은 와이파이에 있는 폰/태블릿이 접속할 주소 목록 */
export function lanUrls(port: number): string[] {
  const found: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // 자동 할당 주소는 접속에 쓸 수 없다
      found.push(net.address);
    }
  }
  return found
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((address) => `http://${address}:${port}`);
}
