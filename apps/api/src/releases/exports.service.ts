import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  serializeMaiBot,
  serializeAstrBot,
  nativeExportWarnings,
  serializeReadableMarkdown,
  ImportParseError,
} from '@personamarket/persona-adapters';
import {
  BusinessError,
  readTransferSettings,
  assertOrdinaryRequestAllowed,
} from '@personamarket/server';
import { ExportPreviewResponseSchema, type ExportFormat } from '@personamarket/contracts';
import { PublicationsRepository } from './publications.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { MarketExportService } from './market-export.service.js';
import { MetricsService } from './metrics.service.js';
const exportDetails = {
  text: { extension: 'txt', mime: 'text/plain' },
  markdown: { extension: 'md', mime: 'text/markdown' },
  'maibot-toml': { extension: 'toml', mime: 'application/toml' },
  'astrbot-json': { extension: 'json', mime: 'application/json' },
  'market-json': { extension: 'persona.json', mime: 'application/json' },
  'market-zip': { extension: 'persona.zip', mime: 'application/zip' },
} satisfies Record<ExportFormat, { extension: string; mime: string }>;
@Injectable()
export class ExportsService {
  constructor(
    @Inject(PublicationsRepository) readonly publications: PublicationsRepository,
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(MarketExportService) readonly market: MarketExportService,
    @Inject(MetricsService) readonly metrics: MetricsService,
  ) {}
  private async policy(request: Request, format: ExportFormat) {
    const settings = await readTransferSettings(this.publications.database.db);
    if (!settings.guestExportsEnabled) await this.auth.identity(request);
    if (!settings.exportFormats.includes(format))
      throw new BusinessError('UNSUPPORTED_FORMAT', '管理员已关闭此导出格式，请选择其他格式');
  }
  async prepare(request: Request, id: string, releaseId: string, format: ExportFormat) {
    await this.auth.rate.take('persona-export', request.ip ?? 'unknown', 30, 60);
    await this.policy(request, format);
    const { data: release } = await this.publications.release(id, releaseId);
    const snapshot = release.snapshot;
    if (
      (format === 'maibot-toml' && snapshot.platform !== 'maibot') ||
      (format === 'astrbot-json' && snapshot.platform !== 'astrbot')
    )
      throw new BusinessError('UNSUPPORTED_FORMAT', '导出格式与该人设的平台不匹配');
    const content =
      snapshot.platform === 'maibot'
        ? { platform: snapshot.platform, content: snapshot.content }
        : { platform: snapshot.platform, content: snapshot.content };
    let text: string;
    if (format === 'market-json' || format === 'market-zip')
      text = await this.market.prepare(release, format === 'market-zip' ? 'zip' : 'json');
    else if (format === 'markdown') {
      try {
        text = serializeReadableMarkdown(content);
      } catch (cause) {
        if (cause instanceof ImportParseError)
          throw new BusinessError('UNSUPPORTED_FORMAT', cause.message, { cause });
        throw cause;
      }
    } else if (format === 'maibot-toml' && snapshot.platform === 'maibot')
      text = serializeMaiBot({ platform: snapshot.platform, content: snapshot.content });
    else if (format === 'astrbot-json' && snapshot.platform === 'astrbot')
      text = serializeAstrBot(
        { platform: snapshot.platform, content: snapshot.content },
        snapshot.title,
      );
    else
      text =
        snapshot.platform === 'maibot'
          ? [
              '人格设定',
              snapshot.content.personality,
              '',
              '表达风格',
              snapshot.content.replyStyle,
              '',
              '行为风格',
              snapshot.content.behaviorStyle,
            ].join('\n')
          : [
              '人格设定',
              snapshot.content.systemPrompt,
              ...(snapshot.content.dialoguePairs.length
                ? [
                    '',
                    '预设对话',
                    ...snapshot.content.dialoguePairs.flatMap((pair) => [
                      '',
                      '用户：' + pair.user,
                      'AI：' + pair.assistant,
                    ]),
                  ]
                : []),
            ].join('\n');
    const { extension, mime } = exportDetails[format];
    let name = Array.from(snapshot.title.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-'))
      .slice(0, 60)
      .join('')
      .replace(/^-+|-+$/g, '');
    if (!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))
      name = 'persona-' + (name || 'export');
    const result = ExportPreviewResponseSchema.parse({
      data: {
        format,
        filename: name + '-v' + release.version + '.' + extension,
        mime,
        warnings:
          format === 'market-zip'
            ? ['ZIP包含通用清单、README、来源许可说明与本版本图片，预览展示包内人设清单']
            : format === 'market-json'
              ? ['通用JSON保留图片引用，导入时需确认并托管源图片，文件不包含图片本体']
              : format === 'text' || format === 'markdown'
                ? []
                : nativeExportWarnings(content),
        omittedFields:
          format === 'market-json' || format === 'market-zip'
            ? ['私有授权证据与作者勾选确认', '站内账号身份、审核记录和互动统计']
            : [
                '作品 README 与图片',
                '推荐模型与作者说明',
                '发布者、来源与转载声明',
                '站内分类、标签与审核记录',
              ],
        text,
      },
    });
    await this.publications.release(id, releaseId);
    await this.policy(request, format);
    return result;
  }
  async download(
    request: Request,
    response: Response,
    id: string,
    releaseId: string,
    format: ExportFormat,
  ) {
    if (request.method === 'GET') await assertOrdinaryRequestAllowed(this.publications.database);
    const result = await this.prepare(request, id, releaseId, format);
    if (format === 'market-zip') {
      const { data: release } = await this.publications.release(id, releaseId);
      return this.market.downloadArchive(response, release, result.data.filename, async () => {
        await this.policy(request, format);
        return this.metrics.record(request, response, id, releaseId, format);
      });
    }
    if (response.destroyed) return;
    await this.policy(request, format);
    await this.metrics.record(request, response, id, releaseId, format);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', result.data.mime + '; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="persona-export.' +
        exportDetails[format].extension +
        "\"; filename*=UTF-8''" +
        encodeURIComponent(result.data.filename),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(result.data.text));
  }
}
