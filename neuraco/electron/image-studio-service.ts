import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type {
  NeuraCoAgentImageContext,
  NeuraCoImageStudioCreateRequest,
  NeuraCoImageStudioJob,
  NeuraCoImageStudioLocalOutput,
  NeuraCoImageStudioOperation,
  NeuraCoImageStudioOutput,
  NeuraCoImageStudioPreview,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_JOBS = 100;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{8,120}$/;
const SUPPORTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

interface ImageStudioStore {
  version: 1;
  jobs: NeuraCoImageStudioJob[];
}

interface RemoteImageOutput {
  id: string;
  mime_type: NeuraCoImageStudioOutput['mimeType'];
  data_base64: string;
  variant: number;
}

export interface NeuraCoImageStudioRemoteResponse {
  request_id: string;
  project_id: string;
  operation: Exclude<NeuraCoImageStudioOperation, 'resize'>;
  outputs: RemoteImageOutput[];
  provider: string;
  model: string;
  model_display: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
    credits_consumed?: number;
  };
  rights?: {
    status?: string;
    message?: string;
  };
  warnings?: string[];
  original_preserved: boolean;
  created_at: string;
}

type RemoteGenerator = (
  project: NeuraCoProject,
  request: NeuraCoImageStudioCreateRequest
) => Promise<NeuraCoImageStudioRemoteResponse>;

interface ImageStudioServiceOptions {
  storePath: string;
  assetsDirectory: string;
  generateRemote: RemoteGenerator;
}

const extensionForMime = (mimeType: string): string => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
};

const signatureMatches = (mimeType: string, raw: Buffer): boolean => {
  if (mimeType === 'image/png') {
    return raw.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'));
  }
  if (mimeType === 'image/jpeg') {
    return raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return raw.length >= 12
      && raw.subarray(0, 4).toString('ascii') === 'RIFF'
      && raw.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return raw.subarray(0, 6).toString('ascii') === 'GIF87a'
    || raw.subarray(0, 6).toString('ascii') === 'GIF89a';
};

const decodeImage = (
  mimeType: string,
  encodedInput: string
): Buffer => {
  if (!SUPPORTED_MIME.has(mimeType)) {
    throw new Error('Format d’image NeuraCo non pris en charge.');
  }
  const encoded = String(encodedInput || '').replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Encodage d’image NeuraCo invalide.');
  }
  const raw = Buffer.from(encoded, 'base64');
  if (
    !raw.length
    || raw.length > MAX_IMAGE_BYTES
    || !signatureMatches(mimeType, raw)
  ) {
    throw new Error('Image NeuraCo vide, trop volumineuse ou incohérente.');
  }
  return raw;
};

const safeDimension = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 1 || value > 20_000) {
    throw new Error(`${label} d’image invalide.`);
  }
  return value;
};

const safeSource = (
  source: NeuraCoAgentImageContext | undefined
): NeuraCoAgentImageContext | undefined => {
  if (!source) return undefined;
  if (!SAFE_ID.test(source.id)) throw new Error('Identifiant d’image source invalide.');
  const raw = decodeImage(source.mimeType, source.dataBase64);
  if (Math.abs(raw.length - source.size) > 2) {
    throw new Error('Taille de l’image source incohérente.');
  }
  return {
    id: source.id,
    name: String(source.name || 'source').replace(/[\u0000-\u001f]/g, '').slice(0, 240),
    mimeType: source.mimeType,
    dataBase64: source.dataBase64.replace(/\s+/g, ''),
    width: safeDimension(source.width, 'Largeur'),
    height: safeDimension(source.height, 'Hauteur'),
    size: raw.length
  };
};

const safeLocalOutput = (
  output: NeuraCoImageStudioLocalOutput | undefined
): NeuraCoImageStudioLocalOutput => {
  if (!output) throw new Error('Résultat redimensionné manquant.');
  decodeImage(output.mimeType, output.dataBase64);
  return {
    mimeType: output.mimeType,
    dataBase64: output.dataBase64.replace(/\s+/g, ''),
    width: safeDimension(output.width, 'Largeur'),
    height: safeDimension(output.height, 'Hauteur')
  };
};

const cleanRequest = (
  request: NeuraCoImageStudioCreateRequest
): NeuraCoImageStudioCreateRequest => {
  if (!SAFE_ID.test(request.requestId)) {
    throw new Error('Identifiant de requête image invalide.');
  }
  if (!Number.isInteger(request.variants) || request.variants < 1 || request.variants > 4) {
    throw new Error('Le nombre de variantes doit être compris entre 1 et 4.');
  }
  const prompt = redactSecrets(String(request.prompt || '')).trim().slice(0, 4000);
  if (!prompt && request.operation !== 'remove_background' && request.operation !== 'resize') {
    throw new Error('La demande image ne peut pas être vide.');
  }
  const source = safeSource(request.source);
  if (['edit', 'remove_background', 'resize'].includes(request.operation) && !source) {
    throw new Error('Cette opération nécessite une image source.');
  }
  if (request.operation === 'resize') {
    return {
      ...request,
      prompt,
      variants: 1,
      source,
      localOutput: safeLocalOutput(request.localOutput)
    };
  }
  return {
    ...request,
    prompt,
    source,
    localOutput: undefined
  };
};

export class ImageStudioService {
  private readonly storePath: string;
  private readonly assetsDirectory: string;
  private readonly generateRemote: RemoteGenerator;

  constructor(options: ImageStudioServiceOptions) {
    this.storePath = options.storePath;
    this.assetsDirectory = options.assetsDirectory;
    this.generateRemote = options.generateRemote;
  }

  private async readStore(): Promise<ImageStudioStore> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8')) as ImageStudioStore;
      return {
        version: 1,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
      };
    } catch {
      return { version: 1, jobs: [] };
    }
  }

  private async writeStore(store: ImageStudioStore): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.storePath);
  }

  private async appendJob(job: NeuraCoImageStudioJob): Promise<void> {
    const store = await this.readStore();
    store.jobs = [job, ...store.jobs].slice(0, MAX_JOBS);
    await this.writeStore(store);
  }

  private async persistOutput(
    projectId: string,
    jobId: string,
    variant: number,
    mimeType: NeuraCoImageStudioOutput['mimeType'],
    dataBase64: string,
    dimensions?: { width: number; height: number }
  ): Promise<NeuraCoImageStudioOutput> {
    const raw = decodeImage(mimeType, dataBase64);
    const id = randomUUID();
    const directory = path.join(this.assetsDirectory, projectId, jobId);
    const filePath = path.join(
      directory,
      `variant-${variant}-${id}.${extensionForMime(mimeType)}`
    );
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, raw, { mode: 0o600, flag: 'wx' });
    return {
      id,
      variant,
      mimeType,
      filePath,
      size: raw.length,
      width: dimensions?.width,
      height: dimensions?.height
    };
  }

  async create(
    project: NeuraCoProject,
    requestInput: NeuraCoImageStudioCreateRequest
  ): Promise<NeuraCoImageStudioJob> {
    const request = cleanRequest(requestInput);
    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    let job: NeuraCoImageStudioJob;

    if (request.operation === 'resize') {
      const local = safeLocalOutput(request.localOutput);
      const output = await this.persistOutput(
        project.id,
        jobId,
        1,
        local.mimeType,
        local.dataBase64,
        { width: local.width, height: local.height }
      );
      job = {
        id: jobId,
        requestId: request.requestId,
        projectId: project.id,
        operation: 'resize',
        prompt: request.prompt,
        sourceName: request.source?.name,
        outputs: [output],
        provider: 'NeuraCo local',
        model: 'canvas-2d',
        modelDisplay: 'Redimensionnement local exact',
        usage: { creditsConsumed: 0 },
        rights: {
          status: 'source_inherited',
          message: 'Les droits du résultat restent ceux de l’image source.'
        },
        warnings: [],
        originalPreserved: true,
        createdAt
      };
    } else {
      const response = await this.generateRemote(project, request);
      if (!response.original_preserved || !response.outputs?.length) {
        throw new Error('Le serveur n’a pas confirmé la conservation de l’original.');
      }
      const outputs: NeuraCoImageStudioOutput[] = [];
      try {
        for (const remote of response.outputs) {
          outputs.push(await this.persistOutput(
            project.id,
            jobId,
            remote.variant,
            remote.mime_type,
            remote.data_base64
          ));
        }
      } catch (error) {
        await rm(path.join(this.assetsDirectory, project.id, jobId), {
          recursive: true,
          force: true
        });
        throw error;
      }
      job = {
        id: jobId,
        requestId: request.requestId,
        projectId: project.id,
        operation: request.operation,
        prompt: request.prompt,
        sourceName: request.source?.name,
        outputs,
        provider: String(response.provider || 'Non communiqué').slice(0, 120),
        model: String(response.model || 'Non communiqué').slice(0, 200),
        modelDisplay: String(response.model_display || response.model || 'Non communiqué')
          .slice(0, 200),
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens,
          costUsd: response.usage?.cost_usd,
          creditsConsumed: Number(response.usage?.credits_consumed || 0)
        },
        rights: {
          status: response.rights?.status === 'source_inherited'
            ? 'source_inherited'
            : 'not_reported',
          message: String(
            response.rights?.message
            || 'Le fournisseur n’a pas communiqué les droits dans sa réponse.'
          ).slice(0, 600)
        },
        warnings: Array.isArray(response.warnings)
          ? response.warnings.map((warning) => String(warning).slice(0, 300)).slice(0, 8)
          : [],
        originalPreserved: true,
        createdAt: response.created_at || createdAt
      };
    }

    await this.appendJob(job);
    return job;
  }

  async list(projectId: string, limit = 40): Promise<NeuraCoImageStudioJob[]> {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 40;
    const store = await this.readStore();
    return store.jobs
      .filter((job) => job.projectId === projectId)
      .slice(0, safeLimit);
  }

  private async findOutput(
    projectId: string,
    outputId: string
  ): Promise<NeuraCoImageStudioOutput> {
    if (!SAFE_ID.test(outputId)) throw new Error('Identifiant de sortie image invalide.');
    const jobs = await this.list(projectId, 100);
    const output = jobs.flatMap((job) => job.outputs)
      .find((candidate) => candidate.id === outputId);
    if (!output) throw new Error('Sortie image introuvable pour ce projet.');
    await stat(output.filePath);
    return output;
  }

  async preview(projectId: string, outputId: string): Promise<NeuraCoImageStudioPreview> {
    const output = await this.findOutput(projectId, outputId);
    const raw = await readFile(output.filePath);
    if (raw.length !== output.size || !signatureMatches(output.mimeType, raw)) {
      throw new Error('Le fichier image enregistré est incohérent.');
    }
    return {
      outputId,
      dataUrl: `data:${output.mimeType};base64,${raw.toString('base64')}`
    };
  }

  async export(
    projectId: string,
    outputId: string,
    destination: string
  ): Promise<string> {
    const output = await this.findOutput(projectId, outputId);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(output.filePath, destination, fsConstants.COPYFILE_EXCL);
    return destination;
  }
}
