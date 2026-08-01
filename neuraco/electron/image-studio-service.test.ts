import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoImageStudioCreateRequest,
  NeuraCoProject
} from './ipc-contract';
import { ImageStudioService } from './image-studio-service';

const png = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
  Buffer.from('neuraco-image-test')
]);
const encoded = png.toString('base64');
type RemoteGeneratorMock = ReturnType<typeof vi.fn<(
  project: NeuraCoProject,
  request: NeuraCoImageStudioCreateRequest
) => Promise<any>>>;

describe('ImageStudioService', () => {
  let directory: string;
  let service: ImageStudioService;
  let generateRemote: RemoteGeneratorMock;
  let project: NeuraCoProject;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-image-studio-'));
    await mkdir(path.join(directory, 'project'));
    project = {
      id: 'project-image-123',
      name: 'Image project',
      rootPath: path.join(directory, 'project')
    } as NeuraCoProject;
    generateRemote = vi.fn(async () => ({
      request_id: 'request-image-123',
      project_id: project.id,
      operation: 'edit',
      outputs: [{
        id: 'remote-image-123',
        mime_type: 'image/png',
        data_base64: encoded,
        variant: 1
      }],
      provider: 'OpenRouter',
      model: 'google/gemini-2.5-flash-image',
      model_display: 'Gemini 2.5 Flash Image',
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        total_tokens: 25,
        cost_usd: 0.04,
        credits_consumed: 1.5
      },
      rights: {
        status: 'not_reported',
        message: 'Conditions non transmises.'
      },
      warnings: [],
      original_preserved: true,
      created_at: '2026-07-28T12:00:00.000Z'
    }));
    service = new ImageStudioService({
      storePath: path.join(directory, 'store', 'jobs.json'),
      assetsDirectory: path.join(directory, 'assets'),
      generateRemote
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const editRequest = (): NeuraCoImageStudioCreateRequest => ({
    requestId: 'request-image-123',
    operation: 'edit',
    prompt: 'Ajoute une lumière douce.',
    variants: 1,
    source: {
      id: 'source-image-123',
      name: 'source.png',
      mimeType: 'image/png',
      dataBase64: encoded,
      width: 64,
      height: 64,
      size: png.length
    }
  });

  it('persists provider results privately without storing pixels in history', async () => {
    const request = editRequest();
    const sourceBefore = request.source?.dataBase64;
    const job = await service.create(project, request);
    const preview = await service.preview(project.id, job.outputs[0].id);
    const store = await readFile(path.join(directory, 'store', 'jobs.json'), 'utf8');

    expect(job.provider).toBe('OpenRouter');
    expect(job.model).toBe('google/gemini-2.5-flash-image');
    expect(job.usage.creditsConsumed).toBe(1.5);
    expect(job.originalPreserved).toBe(true);
    expect(preview.dataUrl).toBe(`data:image/png;base64,${encoded}`);
    expect(store).not.toContain(encoded);
    expect(request.source?.dataBase64).toBe(sourceBefore);
    expect(generateRemote).toHaveBeenCalledTimes(1);
  });

  it('redimensions locally with exact declared dimensions and zero credits', async () => {
    const request: NeuraCoImageStudioCreateRequest = {
      ...editRequest(),
      requestId: 'request-resize-123',
      operation: 'resize',
      prompt: '1024 x 512',
      localOutput: {
        mimeType: 'image/png',
        dataBase64: encoded,
        width: 1024,
        height: 512
      }
    };
    const job = await service.create(project, request);

    expect(job.outputs[0]).toMatchObject({ width: 1024, height: 512 });
    expect(job.usage.creditsConsumed).toBe(0);
    expect(job.model).toBe('canvas-2d');
    expect(job.rights.status).toBe('source_inherited');
    expect(generateRemote).not.toHaveBeenCalled();
  });

  it('exports to a new file and refuses to overwrite an existing image', async () => {
    const job = await service.create(project, editRequest());
    const destination = path.join(directory, 'exports', 'result.png');
    await service.export(project.id, job.outputs[0].id, destination);
    expect(await readFile(destination)).toEqual(png);

    await expect(
      service.export(project.id, job.outputs[0].id, destination)
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rejects malformed source images before any provider call', async () => {
    const request = editRequest();
    request.source = {
      ...request.source!,
      dataBase64: Buffer.from('not-an-image').toString('base64'),
      size: 12
    };
    await expect(service.create(project, request)).rejects.toThrow(
      'incohérente'
    );
    expect(generateRemote).not.toHaveBeenCalled();
  });

  it('removes partial output files when one provider output is invalid', async () => {
    generateRemote.mockResolvedValueOnce({
      ...(await generateRemote(project, editRequest())),
      outputs: [
        {
          id: 'remote-image-123',
          mime_type: 'image/png',
          data_base64: encoded,
          variant: 1
        },
        {
          id: 'remote-image-456',
          mime_type: 'image/png',
          data_base64: Buffer.from('invalid').toString('base64'),
          variant: 2
        }
      ]
    });
    generateRemote.mockClear();

    await expect(service.create(project, editRequest())).rejects.toThrow(
      'incohérente'
    );
    expect(await service.list(project.id)).toEqual([]);
  });
});
