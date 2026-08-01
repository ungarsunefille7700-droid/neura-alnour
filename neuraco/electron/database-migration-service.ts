import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

export interface NeuraCoMigrationContext {
  readJson: <T>(relativePath: string) => Promise<T | null>;
  writeJson: (relativePath: string, value: unknown) => Promise<void>;
}

export interface NeuraCoLocalMigration {
  id: string;
  from: number;
  to: number;
  targets: string[];
  apply: (context: NeuraCoMigrationContext) => Promise<void>;
}

interface BackupEntry {
  relativePath: string;
  existed: boolean;
  backupPath?: string;
}

interface MigrationJournal {
  id: string;
  migrationId: string;
  from: number;
  to: number;
  status: 'pending' | 'committed' | 'rolled_back';
  backups: BackupEntry[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const safeRelativePath = (value: string): string => {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('Chemin de migration locale invalide.');
  }
  return normalized;
};

const writeJsonAtomic = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  await rename(temporary, target);
};

export class DatabaseMigrationService {
  private readonly metadataDirectory: string;
  private readonly backupDirectory: string;
  private readonly schemaPath: string;
  private readonly journalPath: string;
  private readonly lockPath: string;

  constructor(private readonly stateDirectory: string) {
    this.metadataDirectory = path.join(stateDirectory, 'migrations');
    this.backupDirectory = path.join(this.metadataDirectory, 'backups');
    this.schemaPath = path.join(this.metadataDirectory, 'schema.json');
    this.journalPath = path.join(this.metadataDirectory, 'journal.json');
    this.lockPath = path.join(this.metadataDirectory, 'migration.lock');
  }

  async run(migrations: NeuraCoLocalMigration[]): Promise<number> {
    await mkdir(this.metadataDirectory, { recursive: true });
    const lock = await this.acquireLock();
    try {
      await this.recoverInterruptedMigration();
      let version = await this.currentVersion();
      const ordered = migrations.slice().sort((left, right) => left.from - right.from);
      for (const migration of ordered) {
        if (migration.from < version) continue;
        if (migration.from !== version || migration.to !== version + 1) {
          throw new Error(`Chaîne de migration locale invalide à partir de la version ${version}.`);
        }
        version = await this.applyMigration(migration);
      }
      return version;
    } finally {
      await lock.close();
      await rm(this.lockPath, { force: true });
    }
  }

  private async acquireLock() {
    const createLock = async () => {
      const handle = await open(this.lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString()
      }), 'utf8');
      return handle;
    };
    try {
      return await createLock();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let ownerIsRunning = false;
      try {
        const owner = JSON.parse(await readFile(this.lockPath, 'utf8')) as { pid?: number };
        if (Number.isInteger(owner.pid) && Number(owner.pid) > 0) {
          try {
            process.kill(Number(owner.pid), 0);
            ownerIsRunning = true;
          } catch (ownerError) {
            if ((ownerError as NodeJS.ErrnoException).code !== 'ESRCH') throw ownerError;
          }
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code !== 'ENOENT') {
          const lockAge = Date.now() - (await stat(this.lockPath)).mtimeMs;
          ownerIsRunning = lockAge < 10 * 60 * 1000;
        }
      }
      if (ownerIsRunning) {
        throw new Error('Une migration locale NeuraCo est déjà en cours.');
      }
      await this.recoverInterruptedMigration();
      await rm(this.lockPath, { force: true });
      return createLock();
    }
  }

  private async currentVersion(): Promise<number> {
    try {
      const value = JSON.parse(await readFile(this.schemaPath, 'utf8')) as { version?: number };
      return Number.isInteger(value.version) && Number(value.version) >= 0
        ? Number(value.version)
        : 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw new Error('Le registre de migration locale est illisible.');
    }
  }

  private target(relativePath: string): string {
    return path.join(this.stateDirectory, ...safeRelativePath(relativePath).split('/'));
  }

  private async applyMigration(migration: NeuraCoLocalMigration): Promise<number> {
    if (!/^[a-z0-9][a-z0-9._-]{2,100}$/i.test(migration.id)) {
      throw new Error('Identifiant de migration locale invalide.');
    }
    const targets = [...new Set(migration.targets.map(safeRelativePath))];
    const backupRoot = path.join(
      this.backupDirectory,
      `${migration.to}-${migration.id}-${Date.now()}`
    );
    await mkdir(backupRoot, { recursive: true });
    const backups: BackupEntry[] = [];
    for (const relativePath of targets) {
      const target = this.target(relativePath);
      try {
        const targetStat = await stat(target);
        if (!targetStat.isFile()) {
          throw new Error(`La cible de migration ${relativePath} n’est pas un fichier.`);
        }
        const backupPath = path.join(
          backupRoot,
          createHash('sha256').update(relativePath).digest('hex')
        );
        await copyFile(target, backupPath);
        backups.push({ relativePath, existed: true, backupPath });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          backups.push({ relativePath, existed: false });
        } else {
          throw error;
        }
      }
    }
    const journal: MigrationJournal = {
      id: randomUUID(),
      migrationId: migration.id,
      from: migration.from,
      to: migration.to,
      status: 'pending',
      backups,
      startedAt: new Date().toISOString()
    };
    await writeJsonAtomic(this.journalPath, journal);

    const context: NeuraCoMigrationContext = {
      readJson: async <T>(relativePath: string): Promise<T | null> => {
        const safe = safeRelativePath(relativePath);
        if (!targets.includes(safe)) throw new Error('Lecture hors migration refusée.');
        try {
          return JSON.parse(await readFile(this.target(safe), 'utf8')) as T;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      writeJson: async (relativePath: string, value: unknown): Promise<void> => {
        const safe = safeRelativePath(relativePath);
        if (!targets.includes(safe)) throw new Error('Écriture hors migration refusée.');
        await writeJsonAtomic(this.target(safe), value);
      }
    };

    try {
      await migration.apply(context);
      await writeJsonAtomic(this.schemaPath, {
        version: migration.to,
        migrationId: migration.id,
        migratedAt: new Date().toISOString()
      });
      await writeJsonAtomic(this.journalPath, {
        ...journal,
        status: 'committed',
        finishedAt: new Date().toISOString()
      } satisfies MigrationJournal);
      return migration.to;
    } catch (error) {
      await this.restore(backups);
      await writeJsonAtomic(this.schemaPath, {
        version: migration.from,
        migrationId: migration.id,
        rolledBackAt: new Date().toISOString()
      });
      await writeJsonAtomic(this.journalPath, {
        ...journal,
        status: 'rolled_back',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Migration locale échouée.'
      } satisfies MigrationJournal);
      throw new Error(
        `Migration locale ${migration.id} annulée et restaurée : `
        + (error instanceof Error ? error.message : 'erreur inconnue')
      );
    }
  }

  private async recoverInterruptedMigration(): Promise<void> {
    try {
      const journal = JSON.parse(await readFile(this.journalPath, 'utf8')) as MigrationJournal;
      if (journal.status !== 'pending' || !Array.isArray(journal.backups)) return;
      await this.restore(journal.backups);
      await writeJsonAtomic(this.schemaPath, {
        version: journal.from,
        migrationId: journal.migrationId,
        recoveredAt: new Date().toISOString()
      });
      await writeJsonAtomic(this.journalPath, {
        ...journal,
        status: 'rolled_back',
        finishedAt: new Date().toISOString(),
        error: 'Migration interrompue restaurée au démarrage.'
      } satisfies MigrationJournal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async restore(backups: BackupEntry[]): Promise<void> {
    for (const backup of backups) {
      const target = this.target(backup.relativePath);
      if (backup.existed && backup.backupPath) {
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(backup.backupPath, target);
      } else {
        await rm(target, { force: true });
      }
    }
  }
}
