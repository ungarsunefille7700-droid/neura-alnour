import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  NeuraCoAppLockReason,
  NeuraCoAppLockSettingsUpdate,
  NeuraCoAppLockState
} from './ipc-contract';

const scrypt = promisify(scryptCallback);
const PIN_PATTERN = /^\d{4,12}$/;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;
const VALID_IDLE_MINUTES = new Set([0, 1, 5, 15, 30, 60]);

interface PinRecord {
  salt: string;
  hash: string;
}

interface AppLockDocument {
  version: 1;
  pin?: PinRecord;
  windowsHelloEnabled: boolean;
  lockOnStartup: boolean;
  idleTimeoutMinutes: number;
  maskSensitiveNotifications: boolean;
}

export interface AppLockProtector {
  available: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

interface AppLockServiceOptions {
  storePath: string;
  protector: AppLockProtector;
  onState?: (state: NeuraCoAppLockState) => void;
}

const defaultDocument = (): AppLockDocument => ({
  version: 1,
  windowsHelloEnabled: false,
  lockOnStartup: false,
  idleTimeoutMinutes: 0,
  maskSensitiveNotifications: true
});

const hashPin = async (pin: string, salt: Buffer): Promise<Buffer> => (
  scrypt(pin, salt, 64) as Promise<Buffer>
);

const normalizeDocument = (value: unknown): AppLockDocument => {
  const parsed = value as Partial<AppLockDocument> | null;
  if (!parsed || parsed.version !== 1) return defaultDocument();
  const idleTimeoutMinutes = Number(parsed.idleTimeoutMinutes);
  const pin = parsed.pin
    && typeof parsed.pin.salt === 'string'
    && typeof parsed.pin.hash === 'string'
    ? { salt: parsed.pin.salt, hash: parsed.pin.hash }
    : undefined;
  return {
    version: 1,
    pin,
    windowsHelloEnabled: parsed.windowsHelloEnabled === true,
    lockOnStartup: parsed.lockOnStartup === true,
    idleTimeoutMinutes: VALID_IDLE_MINUTES.has(idleTimeoutMinutes)
      ? idleTimeoutMinutes
      : 0,
    maskSensitiveNotifications: parsed.maskSensitiveNotifications !== false
  };
};

export class AppLockService {
  private document = defaultDocument();
  private initialized = false;
  private locked = false;
  private reason?: NeuraCoAppLockReason;
  private failedAttempts = 0;
  private retryAt?: string;
  private windowsHelloAvailability: NeuraCoAppLockState['windowsHelloAvailability'] =
    'unknown';

  constructor(private readonly options: AppLockServiceOptions) {}

  async initialize(): Promise<NeuraCoAppLockState> {
    if (this.initialized) return this.state();
    if (this.options.protector.available()) {
      try {
        const encrypted = await readFile(this.options.storePath);
        const decrypted = this.options.protector.decrypt(encrypted);
        this.document = normalizeDocument(JSON.parse(decrypted));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw new Error(
            'Les paramètres de verrouillage NeuraCo sont illisibles. '
            + 'Aucune donnée de sécurité n’a été remplacée.'
          );
        }
      }
    }
    this.initialized = true;
    if (this.document.lockOnStartup && this.hasUnlockFactor()) {
      this.locked = true;
      this.reason = 'startup';
    }
    return this.state();
  }

  state(): NeuraCoAppLockState {
    return {
      configured: this.hasUnlockFactor(),
      locked: this.locked,
      reason: this.reason,
      pinEnabled: Boolean(this.document.pin),
      windowsHelloEnabled: this.document.windowsHelloEnabled,
      windowsHelloAvailability: this.windowsHelloAvailability,
      lockOnStartup: this.document.lockOnStartup,
      idleTimeoutMinutes: this.document.idleTimeoutMinutes,
      maskSensitiveNotifications: this.document.maskSensitiveNotifications,
      storageAvailable: this.options.protector.available(),
      failedAttempts: this.failedAttempts,
      retryAt: this.retryAt
    };
  }

  setWindowsHelloAvailability(
    availability: NeuraCoAppLockState['windowsHelloAvailability']
  ): NeuraCoAppLockState {
    this.windowsHelloAvailability = availability;
    return this.emit();
  }

  async setPin(pin: string, currentPin?: string): Promise<NeuraCoAppLockState> {
    this.ensureInitialized();
    this.ensureStorage();
    if (!PIN_PATTERN.test(pin)) {
      throw new Error('Le code PIN doit contenir entre 4 et 12 chiffres.');
    }
    if (this.document.pin) {
      if (!currentPin || !(await this.verifyPin(currentPin))) {
        throw new Error('Le code PIN actuel est incorrect.');
      }
    }
    const salt = randomBytes(32);
    const hash = await hashPin(pin, salt);
    this.document.pin = {
      salt: salt.toString('base64'),
      hash: hash.toString('base64')
    };
    await this.persist();
    this.failedAttempts = 0;
    this.retryAt = undefined;
    return this.emit();
  }

  async removePin(currentPin: string): Promise<NeuraCoAppLockState> {
    this.ensureInitialized();
    if (!this.document.pin) return this.state();
    if (!(await this.verifyPin(currentPin))) {
      throw new Error('Le code PIN actuel est incorrect.');
    }
    this.document.pin = undefined;
    if (!this.hasUnlockFactor()) {
      this.document.lockOnStartup = false;
      this.document.idleTimeoutMinutes = 0;
      this.locked = false;
      this.reason = undefined;
    }
    await this.persist();
    return this.emit();
  }

  async updateSettings(
    update: NeuraCoAppLockSettingsUpdate
  ): Promise<NeuraCoAppLockState> {
    this.ensureInitialized();
    const idleTimeoutMinutes = Number(update.idleTimeoutMinutes);
    if (!VALID_IDLE_MINUTES.has(idleTimeoutMinutes)) {
      throw new Error('Délai de verrouillage invalide.');
    }
    if (
      (update.lockOnStartup || idleTimeoutMinutes > 0)
      && !this.hasUnlockFactor()
    ) {
      throw new Error('Configurez d’abord un code PIN ou Windows Hello.');
    }
    this.document.lockOnStartup = update.lockOnStartup === true;
    this.document.idleTimeoutMinutes = idleTimeoutMinutes;
    this.document.maskSensitiveNotifications =
      update.maskSensitiveNotifications === true;
    await this.persist();
    return this.emit();
  }

  async setWindowsHelloEnabled(enabled: boolean): Promise<NeuraCoAppLockState> {
    this.ensureInitialized();
    if (enabled && this.windowsHelloAvailability !== 'available') {
      throw new Error('Windows Hello n’est pas disponible sur cet appareil.');
    }
    this.document.windowsHelloEnabled = enabled;
    if (!this.hasUnlockFactor()) {
      this.document.lockOnStartup = false;
      this.document.idleTimeoutMinutes = 0;
      this.locked = false;
      this.reason = undefined;
    }
    await this.persist();
    return this.emit();
  }

  lock(reason: NeuraCoAppLockReason): NeuraCoAppLockState {
    this.ensureInitialized();
    if (!this.hasUnlockFactor()) return this.state();
    this.locked = true;
    this.reason = reason;
    return this.emit();
  }

  async unlockWithPin(pin: string): Promise<NeuraCoAppLockState> {
    this.ensureInitialized();
    if (!this.document.pin) throw new Error('Aucun code PIN n’est configuré.');
    const retryAt = this.retryAt ? Date.parse(this.retryAt) : 0;
    if (retryAt > Date.now()) {
      throw new Error('Trop de tentatives. Réessayez dans quelques secondes.');
    }
    if (!(await this.verifyPin(pin))) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= MAX_ATTEMPTS) {
        this.retryAt = new Date(Date.now() + COOLDOWN_MS).toISOString();
        this.failedAttempts = 0;
      }
      this.emit();
      throw new Error('Code PIN incorrect.');
    }
    return this.unlock();
  }

  unlockWithWindowsHello(): NeuraCoAppLockState {
    this.ensureInitialized();
    if (!this.document.windowsHelloEnabled) {
      throw new Error('Windows Hello n’est pas activé dans NeuraCo.');
    }
    return this.unlock();
  }

  shouldLockForIdle(idleSeconds: number): boolean {
    return (
      this.hasUnlockFactor()
      && !this.locked
      && this.document.idleTimeoutMinutes > 0
      && idleSeconds >= this.document.idleTimeoutMinutes * 60
    );
  }

  shouldMaskSensitiveNotifications(): boolean {
    return this.locked || this.document.maskSensitiveNotifications;
  }

  private unlock(): NeuraCoAppLockState {
    this.locked = false;
    this.reason = undefined;
    this.failedAttempts = 0;
    this.retryAt = undefined;
    return this.emit();
  }

  private hasUnlockFactor(): boolean {
    return Boolean(this.document.pin || this.document.windowsHelloEnabled);
  }

  private async verifyPin(pin: string): Promise<boolean> {
    if (!this.document.pin || !PIN_PATTERN.test(pin)) return false;
    try {
      const salt = Buffer.from(this.document.pin.salt, 'base64');
      const expected = Buffer.from(this.document.pin.hash, 'base64');
      const actual = await hashPin(pin, salt);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    this.ensureStorage();
    const target = this.options.storePath;
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    const encrypted = this.options.protector.encrypt(JSON.stringify(this.document));
    await writeFile(temporary, encrypted, { mode: 0o600 });
    await rename(temporary, target);
  }

  private ensureStorage(): void {
    if (!this.options.protector.available()) {
      throw new Error('Le chiffrement Windows n’est pas disponible.');
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Le verrouillage NeuraCo n’est pas initialisé.');
    }
  }

  private emit(): NeuraCoAppLockState {
    const state = this.state();
    this.options.onState?.(state);
    return state;
  }
}
