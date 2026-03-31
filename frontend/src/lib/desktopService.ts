export const DEFAULT_LOCAL_SERVICE_URL = 'http://127.0.0.1:8040';
const DESKTOP_SERVICE_SNAPSHOT_KEY = 'kecyai.desktop.service.snapshot';
const DESKTOP_SERVICE_EVENT = 'kecyai:desktop-service-status';

export type DesktopServiceState = 'STOPPED' | 'STARTING' | 'READY' | 'WORKING' | 'STOPPING' | 'ERROR';

export type DesktopServiceSnapshot = {
  state: DesktopServiceState;
  serviceUrl: string;
  healthy: boolean;
  message: string;
  logsPath: string;
  updatedAt: number;
};

type RawLauncherStatus = {
  state?: string;
  service_url?: string;
  healthy?: boolean;
  message?: string;
  logs_path?: string;
};

const DEFAULT_SNAPSHOT: DesktopServiceSnapshot = {
  state: 'STOPPED',
  serviceUrl: '',
  healthy: false,
  message: 'KECYAI local service is not running.',
  logsPath: '',
  updatedAt: 0,
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

export function isTauriRuntime(): boolean {
  if (!canUseWindow()) return false;
  const hasInternals = Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const protocol = window.location?.protocol ?? '';
  const hostname = window.location?.hostname ?? '';
  return hasInternals || protocol === 'tauri:' || hostname === 'tauri.localhost';
}

export function getTauriInvoke():
  | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
  | null {
  if (!canUseWindow()) return null;
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === 'function' ? internals.invoke : null;
}

function normalizeState(state: string | undefined): DesktopServiceState {
  switch ((state || '').trim().toUpperCase()) {
    case 'STARTING':
      return 'STARTING';
    case 'READY':
      return 'READY';
    case 'WORKING':
      return 'WORKING';
    case 'STOPPING':
      return 'STOPPING';
    case 'ERROR':
      return 'ERROR';
    default:
      return 'STOPPED';
  }
}

function normalizeSnapshot(raw: RawLauncherStatus): DesktopServiceSnapshot {
  return {
    state: normalizeState(raw.state),
    serviceUrl: stripTrailingSlash(String(raw.service_url || '').trim()),
    healthy: Boolean(raw.healthy),
    message: String(raw.message || DEFAULT_SNAPSHOT.message),
    logsPath: String(raw.logs_path || ''),
    updatedAt: Date.now(),
  };
}

export function readCachedDesktopServiceSnapshot(): DesktopServiceSnapshot {
  if (!canUseWindow()) return DEFAULT_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(DESKTOP_SERVICE_SNAPSHOT_KEY);
    if (!raw) return DEFAULT_SNAPSHOT;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SNAPSHOT,
      ...parsed,
      state: normalizeState(parsed?.state),
      serviceUrl: stripTrailingSlash(String(parsed?.serviceUrl || '')),
      healthy: Boolean(parsed?.healthy),
      message: String(parsed?.message || DEFAULT_SNAPSHOT.message),
      logsPath: String(parsed?.logsPath || ''),
      updatedAt: Number(parsed?.updatedAt || 0),
    };
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

export function writeDesktopServiceSnapshot(snapshot: DesktopServiceSnapshot): DesktopServiceSnapshot {
  if (!canUseWindow()) return snapshot;
  try {
    window.localStorage.setItem(DESKTOP_SERVICE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(DESKTOP_SERVICE_EVENT, { detail: snapshot }));
  } catch {
    // Ignore storage failures; the in-memory caller still has the snapshot.
  }
  return snapshot;
}

export function getCachedDesktopServiceUrl(): string {
  return readCachedDesktopServiceSnapshot().serviceUrl || DEFAULT_LOCAL_SERVICE_URL;
}

export async function syncDesktopServiceSnapshot(): Promise<DesktopServiceSnapshot> {
  if (!isTauriRuntime()) return readCachedDesktopServiceSnapshot();
  const invoke = getTauriInvoke();
  if (!invoke) return readCachedDesktopServiceSnapshot();
  const raw = (await invoke('launcher_status')) as RawLauncherStatus;
  return writeDesktopServiceSnapshot(normalizeSnapshot(raw));
}

export function subscribeDesktopServiceSnapshot(
  callback: (snapshot: DesktopServiceSnapshot) => void,
): () => void {
  if (!canUseWindow()) return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<DesktopServiceSnapshot>).detail;
    callback(detail || readCachedDesktopServiceSnapshot());
  };
  window.addEventListener(DESKTOP_SERVICE_EVENT, handler);
  return () => window.removeEventListener(DESKTOP_SERVICE_EVENT, handler);
}
