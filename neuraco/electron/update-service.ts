import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { authenticatedApiDownload, authenticatedApiRequest } from './auth-service';
import { createSandboxedEnvironment } from './sandbox-environment';
import type {
  NeuraCoUpdateManifest,
  NeuraCoUpdateChannel,
  NeuraCoUpdateRollback,
  NeuraCoUpdateState
} from './ipc-contract';

const execFileAsync = promisify(execFile);
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

const versionTuple = (value: string): [number, number, number] => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/.exec(value);
  if (!match) throw new Error('Version NeuraCo invalide.');
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (left: string, right: string): number => {
  const leftParts = versionTuple(left);
  const rightParts = versionTuple(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
};

export const validateUpdateManifest = (
  manifest: NeuraCoUpdateManifest,
  currentVersion: string,
  requestedChannel: NeuraCoUpdateChannel = 'stable'
): NeuraCoUpdateManifest => {
  if (!manifest || typeof manifest.available !== 'boolean') {
    throw new Error('Manifeste de mise à jour invalide.');
  }
  const versionComparison = compareVersions(manifest.latest_version, currentVersion);
  if (manifest.channel && manifest.channel !== requestedChannel) {
    throw new Error('Le manifeste ne correspond pas au canal de mise à jour sélectionné.');
  }
  if (!manifest.available) return manifest;
  if (versionComparison <= 0) {
    throw new Error('Le manifeste ne propose pas une version plus récente de NeuraCo.');
  }
  if (
    !manifest.download_url
    || new URL(manifest.download_url).protocol !== 'https:'
    || !/^[a-f0-9]{64}$/i.test(manifest.checksum_sha256 || '')
    || !Number.isInteger(manifest.size)
    || Number(manifest.size) < 1
    || Number(manifest.size) > MAX_INSTALLER_BYTES
    || manifest.signature_required !== true
  ) {
    throw new Error('La mise à jour proposée ne satisfait pas les exigences de sécurité.');
  }
  return manifest;
};

interface UpdateServiceOptions {
  storageDirectory: string;
  currentVersion: string;
  isBusy: () => boolean;
  saveState: () => Promise<void>;
  onState: (state: NeuraCoUpdateState) => void;
}

export class UpdateService {
  private state: NeuraCoUpdateState = {
    phase: 'idle',
    progress: 0,
    message: 'Aucune vérification en cours.'
  };

  constructor(private readonly options: UpdateServiceOptions) {}

  current(): NeuraCoUpdateState {
    return this.state;
  }

  async check(channel: NeuraCoUpdateChannel = 'stable'): Promise<NeuraCoUpdateManifest> {
    this.emit({ phase: 'checking', progress: 0, message: 'Vérification de la version…' });
    try {
      const raw = await authenticatedApiRequest<NeuraCoUpdateManifest>(
        '/neuraco/update'
        + `?current_version=${encodeURIComponent(this.options.currentVersion)}`
        + `&channel=${encodeURIComponent(channel)}`
      );
      const manifest = validateUpdateManifest(raw, this.options.currentVersion, channel);
      this.emit({
        phase: manifest.available ? 'available' : 'current',
        progress: manifest.available ? 0 : 100,
        message: manifest.available
          ? `NeuraCo ${manifest.latest_version} est disponible.`
          : 'NeuraCo est à jour.',
        manifest
      });
      return manifest;
    } catch (error) {
      this.emit({
        phase: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Vérification impossible.'
      });
      throw error;
    }
  }

  async download(): Promise<NeuraCoUpdateState> {
    const manifest = this.state.manifest?.available
      ? this.state.manifest
      : await this.check();
    if (!manifest.available || !manifest.download_url || !manifest.checksum_sha256) {
      return this.state;
    }
    await mkdir(this.options.storageDirectory, { recursive: true });
    const target = path.join(
      this.options.storageDirectory,
      `NeuraCo-${manifest.latest_version}-Setup.exe`
    );
    const temporary = `${target}.download`;
    await rm(temporary, { force: true });
    this.emit({
      phase: 'downloading',
      progress: 0,
      message: 'Téléchargement sécurisé…',
      manifest
    });
    try {
      const response = await authenticatedApiDownload(manifest.download_url);
      if (!response.ok || !response.body) {
        throw new Error(`Téléchargement refusé par le serveur (${response.status}).`);
      }
      const expectedLength = Number(response.headers.get('content-length') || manifest.size || 0);
      if (expectedLength > MAX_INSTALLER_BYTES) {
        throw new Error('Le fichier de mise à jour dépasse la taille autorisée.');
      }
      const handle = await open(temporary, 'wx');
      const hash = createHash('sha256');
      let received = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > MAX_INSTALLER_BYTES) {
            throw new Error('Le téléchargement dépasse la taille autorisée.');
          }
          hash.update(chunk.value);
          await handle.write(chunk.value);
          this.emit({
            phase: 'downloading',
            progress: expectedLength > 0
              ? Math.min(99, Math.round(received / expectedLength * 100))
              : 0,
            message: `Téléchargement sécurisé — ${Math.round(received / 1024 / 1024)} Mo`,
            manifest
          });
        }
      } finally {
        await handle.close();
      }
      if (manifest.size && received !== manifest.size) {
        throw new Error('La taille téléchargée ne correspond pas au manifeste.');
      }
      const digest = hash.digest('hex');
      if (digest.toLowerCase() !== manifest.checksum_sha256.toLowerCase()) {
        throw new Error('L’intégrité SHA-256 de la mise à jour est invalide.');
      }
      const signature = await this.verifyAuthenticode(temporary);
      if (signature.status !== 'Valid') {
        throw new Error(
          `Signature Windows invalide (${signature.status || 'inconnue'}). Installation bloquée.`
        );
      }
      await rm(target, { force: true });
      await rename(temporary, target);
      await writeFile(`${target}.verified.json`, JSON.stringify({
        version: manifest.latest_version,
        installerFile: path.basename(target),
        checksumSha256: digest.toLowerCase(),
        size: received,
        signer: signature.signer,
        verifiedAt: new Date().toISOString()
      }, null, 2), { encoding: 'utf8', mode: 0o600 });
      this.emit({
        phase: 'ready',
        progress: 100,
        message: `Mise à jour signée par ${signature.signer || 'éditeur vérifié'}.`,
        manifest,
        installerPath: target,
        signature: signature.signer
      });
      return this.state;
    } catch (error) {
      await rm(temporary, { force: true });
      this.emit({
        phase: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Téléchargement impossible.',
        manifest
      });
      throw error;
    }
  }

  async install(): Promise<NeuraCoUpdateState> {
    if (this.state.phase !== 'ready' || !this.state.installerPath) {
      throw new Error('Aucune mise à jour signée n’est prête à être installée.');
    }
    if (this.options.isBusy()) {
      this.emit({
        ...this.state,
        phase: 'blocked',
        message: 'Installation différée : une action critique est encore en cours.'
      });
      return this.state;
    }
    await this.options.saveState();
    const installerPath = this.state.installerPath;
    this.emit({
      ...this.state,
      phase: 'installing',
      message: 'Lancement de l’installateur signé…'
    });
    const child = spawn(installerPath, [], {
      detached: true,
      env: createSandboxedEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return this.state;
  }

  async getRollback(): Promise<NeuraCoUpdateRollback> {
    const candidate = await this.findRollbackCandidate();
    return candidate
      ? {
          available: true,
          version: candidate.version,
          signer: candidate.signer,
          verifiedAt: candidate.verifiedAt
        }
      : { available: false };
  }

  async rollback(): Promise<NeuraCoUpdateState> {
    if (this.options.isBusy()) {
      this.emit({
        phase: 'blocked',
        progress: 0,
        message: 'Retour différé : une action critique est encore en cours.'
      });
      return this.state;
    }
    const candidate = await this.findRollbackCandidate();
    if (!candidate) {
      throw new Error('Aucune version précédente signée et vérifiée n’est disponible.');
    }
    await this.options.saveState();
    this.emit({
      phase: 'installing',
      progress: 100,
      message: `Retour sécurisé vers NeuraCo ${candidate.version}…`,
      installerPath: candidate.installerPath,
      signature: candidate.signer
    });
    const child = spawn(candidate.installerPath, [], {
      detached: true,
      env: createSandboxedEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return this.state;
  }

  private async findRollbackCandidate(): Promise<{
    version: string;
    signer?: string;
    verifiedAt?: string;
    installerPath: string;
  } | null> {
    let entries: string[];
    try {
      entries = await readdir(this.options.storageDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const candidates: Array<{
      version: string;
      signer?: string;
      verifiedAt?: string;
      installerPath: string;
      checksumSha256: string;
      size: number;
    }> = [];
    for (const entry of entries.filter((name) => name.endsWith('.verified.json'))) {
      try {
        const sidecarPath = path.join(this.options.storageDirectory, entry);
        const metadata = JSON.parse(await readFile(sidecarPath, 'utf8')) as {
          version?: string;
          installerFile?: string;
          checksumSha256?: string;
          size?: number;
          signer?: string;
          verifiedAt?: string;
        };
        if (
          !metadata.version
          || compareVersions(metadata.version, this.options.currentVersion) >= 0
          || !/^[a-f0-9]{64}$/i.test(metadata.checksumSha256 || '')
          || !Number.isInteger(metadata.size)
          || Number(metadata.size) < 1
          || !metadata.installerFile
          || path.basename(metadata.installerFile) !== metadata.installerFile
        ) continue;
        const installerPath = path.join(this.options.storageDirectory, metadata.installerFile);
        if ((await stat(installerPath)).size !== metadata.size) continue;
        candidates.push({
          version: metadata.version,
          signer: metadata.signer,
          verifiedAt: metadata.verifiedAt,
          installerPath,
          checksumSha256: metadata.checksumSha256!.toLowerCase(),
          size: metadata.size!
        });
      } catch {
        continue;
      }
    }
    candidates.sort((left, right) => compareVersions(right.version, left.version));
    for (const candidate of candidates) {
      const contents = await readFile(candidate.installerPath);
      if (createHash('sha256').update(contents).digest('hex') !== candidate.checksumSha256) {
        continue;
      }
      const signature = await this.verifyAuthenticode(candidate.installerPath);
      if (signature.status !== 'Valid') continue;
      return {
        version: candidate.version,
        signer: signature.signer || candidate.signer,
        verifiedAt: candidate.verifiedAt,
        installerPath: candidate.installerPath
      };
    }
    return null;
  }

  private async verifyAuthenticode(
    filePath: string
  ): Promise<{ status: string; signer?: string }> {
    const script = [
      '$p = $env:NEURACO_UPDATE_PATH',
      'if ([string]::IsNullOrWhiteSpace($p)) { throw "Chemin de mise à jour absent." }',
      '$s = Get-AuthenticodeSignature -LiteralPath $p',
      '[pscustomobject]@{ Status = [string]$s.Status; Signer = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress'
    ].join('; ');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          NEURACO_UPDATE_PATH: filePath
        }
      }
    );
    const parsed = JSON.parse(stdout.trim()) as { Status?: string; Signer?: string };
    return { status: parsed.Status || 'Unknown', signer: parsed.Signer || undefined };
  }

  private emit(state: NeuraCoUpdateState): void {
    this.state = state;
    this.options.onState(state);
  }
}
