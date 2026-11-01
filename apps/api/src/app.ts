import {
  TransferSettingsController,
  PublicTransferSettingsController,
} from './settings/transfer-settings.controller.js';
import { TransferSettingsService } from './settings/transfer-settings.service.js';
import { TransferSettingsRepository } from './settings/transfer-settings.repository.js';
import 'reflect-metadata';
import {
  MediaSettingsController,
  PublicMediaSettingsController,
} from './settings/media-settings.controller.js';
import { RankingSettingsController } from './settings/ranking-settings.controller.js';
import { RankingSettingsService } from './settings/ranking-settings.service.js';
import { RankingSettingsRepository } from './settings/ranking-settings.repository.js';
import { MediaSettingsService } from './settings/media-settings.service.js';
import { MediaSettingsRepository } from './settings/media-settings.repository.js';
export { buildPublicSitemapEntriesQuery } from './seo/sitemap.repository.js';
export {
  buildPublicCommentQueries,
  buildOwnCommentQueries,
  buildModerationCommentQueries,
} from './comments/comment-queries.js';
import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Module,
  RequestMethod,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase, type Database } from '@personamarket/database';
import { createLogger, type ServerEnvironment } from '@personamarket/server';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { HealthController } from './health/health.controller.js';
import { ErrorFilter } from './http/error.filter.js';
import { PublicConfigController } from './public-config/public-config.controller.js';
import { PublicConfigRepository } from './public-config/public-config.repository.js';
import { PublicConfigService } from './public-config/public-config.service.js';
import { DATABASE, ENVIRONMENT } from './tokens.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthRepository } from './auth/auth.repository.js';
// 测试入口用于真实数据库事务修订边界验收，不增加HTTP业务入口。
export { AuthRepository } from './auth/auth.repository.js';
import { AuthService } from './auth/auth.service.js';
import { AuthRateLimit } from './auth/rate-limit.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { MfaService } from './auth/mfa.service.js';
import { AdminBrandController } from './auth/admin-brand.controller.js';
import { AdminBrandService } from './auth/admin-brand.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SettingsRepository } from './settings/settings.repository.js';
import { AccountSettingsController } from './settings/account-settings.controller.js';
import { AccountSettingsService } from './settings/account-settings.service.js';
import { AccountSettingsRepository } from './settings/account-settings.repository.js';
import {
  SystemSettingsController,
  PublicSystemStatusController,
} from './settings/system-settings.controller.js';
import { SystemSettingsService } from './settings/system-settings.service.js';
import { SystemSettingsRepository } from './settings/system-settings.repository.js';
import { CreationSettingsController } from './settings/creation-settings.controller.js';
import { CreationSettingsService } from './settings/creation-settings.service.js';
import { CreationSettingsRepository } from './settings/creation-settings.repository.js';
import { SecurityController, EmailChangeController } from './security/security.controller.js';
import { SecurityService } from './security/security.service.js';
import { SecurityRepository } from './security/security.repository.js';
import { PersonasController } from './personas/personas.controller.js';
import { PersonasService } from './personas/personas.service.js';
import { PersonasRepository } from './personas/personas.repository.js';
import { ImportsController } from './personas/imports.controller.js';
import { ImportsService } from './personas/imports.service.js';
import { ImportsRepository } from './personas/imports.repository.js';
import { NativeImportUploadGuard } from './personas/native-import-upload.guard.js';
import { TextImportUploadGuard } from './personas/text-import-upload.guard.js';
import { TextImportsController } from './personas/text-imports.controller.js';
import { MarketImportsController } from './personas/market-imports.controller.js';
import { MarketImportsService } from './personas/market-imports.service.js';
import { MarketImportsRepository } from './personas/market-imports.repository.js';
import {
  MarketImportUploadGuard,
  MarketImportUploadLease,
} from './personas/market-import-upload.js';
import { AssetsController } from './assets/assets.controller.js';
import { AssetsService } from './assets/assets.service.js';
import { AssetsRepository } from './assets/assets.repository.js';
import { UploadGuard } from './assets/upload.guard.js';
import { ReleasesController } from './releases/releases.controller.js';
import { ReleasesService } from './releases/releases.service.js';
import { ReleasesRepository } from './releases/releases.repository.js';
import { ModerationRepository } from './releases/moderation.repository.js';
import { PublicationsRepository } from './releases/publications.repository.js';
import { DiscoveryRepository } from './releases/discovery.repository.js';
import { ExportsController } from './releases/exports.controller.js';
import { ExportsService } from './releases/exports.service.js';
import { MarketExportService } from './releases/market-export.service.js';
import { FacetsController } from './releases/facets.controller.js';
import { FacetsRepository } from './releases/facets.repository.js';
import { MetricsController } from './releases/metrics.controller.js';
import { MetricsRepository } from './releases/metrics.repository.js';
export { MetricsRepository } from './releases/metrics.repository.js';
import { MetricsService } from './releases/metrics.service.js';
import { RankingsController } from './rankings/rankings.controller.js';
import { RankingsService } from './rankings/rankings.service.js';
import { SitemapController } from './seo/sitemap.controller.js';
import { SitemapService } from './seo/sitemap.service.js';
import { SitemapRepository } from './seo/sitemap.repository.js';
import { RankingsRepository } from './rankings/rankings.repository.js';
import { InteractionsRepository } from './interactions/interactions.repository.js';
import { InteractionsService } from './interactions/interactions.service.js';
import { InteractionsController } from './interactions/interactions.controller.js';
import { InteractionSettingsService } from './interactions/interaction-settings.service.js';
import { InteractionSettingsController } from './interactions/interaction-settings.controller.js';
import { CommentsController } from './comments/comments.controller.js';
import { CommentsAdminController } from './comments/comments-admin.controller.js';
import { CommentsService } from './comments/comments.service.js';
import { CommentsReadRepository } from './comments/comments-read.repository.js';
import { CommentsWriteRepository } from './comments/comments-write.repository.js';
import { CommentsModerationRepository } from './comments/comments-moderation.repository.js';
import { AdminUsersController } from './admin-users/admin-users.controller.js';
import { AdminDeactivationRepository } from './admin-users/admin-deactivation.repository.js';
import { AdminUsersService } from './admin-users/admin-users.service.js';
import { AdminUsersReadRepository } from './admin-users/admin-users-read.repository.js';
import { AdminUsersWriteRepository } from './admin-users/admin-users-write.repository.js';
import { AdminPersonasController } from './admin-personas/admin-personas.controller.js';
import { AdminPersonasService } from './admin-personas/admin-personas.service.js';
import { AdminPersonasRepository } from './admin-personas/admin-personas.repository.js';
import { PersonaCurationRepository } from './admin-personas/persona-curation.repository.js';
import {
  AdminCategoriesController,
  AdminTagsController,
} from './taxonomy-management/taxonomy-management.controller.js';
import { TaxonomyManagementService } from './taxonomy-management/taxonomy-management.service.js';
import { TaxonomyManagementRepository } from './taxonomy-management/taxonomy-management.repository.js';
import {
  AnnouncementsController,
  AdminAnnouncementsController,
  AnnouncementSitemapController,
} from './announcements/announcements.controller.js';
import { AnnouncementsService } from './announcements/announcements.service.js';
import { AnnouncementsRepository } from './announcements/announcements.repository.js';
import {
  PublicHomeSettingsController,
  HomeSettingsController,
} from './settings/home-settings.controller.js';
import {
  ModelSuggestionsController,
  PublicModelSuggestionsController,
} from './settings/model-suggestions.controller.js';
import {
  PublicGuidesController,
  GuideSitemapController,
  AdminGuidesController,
} from './guides/guides.controller.js';
import { GuidesService } from './guides/guides.service.js';
import { GuidesRepository } from './guides/guides.repository.js';
import {
  PublicPoliciesController,
  AdminPoliciesController,
} from './policies/policies.controller.js';
import { PoliciesService } from './policies/policies.service.js';
import { PoliciesRepository } from './policies/policies.repository.js';
import {
  ReportsController,
  OwnReportsController,
  AdminReportsController,
} from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { ReportsRepository } from './reports/reports.repository.js';
import {
  NotificationsController,
  AdminNotificationsController,
} from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { NotificationsRepository } from './notifications/notifications.repository.js';
import { AdminNoticesRepository } from './notifications/admin-notices.repository.js';
import { NotificationFailuresRepository } from './notifications/notification-failures.repository.js';
import { NotificationDeliveryRepository } from './notifications/notification-delivery.repository.js';
import {
  ProfilesController,
  ProfileModerationController,
  PublicCreatorsController,
} from './profiles/profiles.controller.js';
import { ProfilesService } from './profiles/profiles.service.js';
import { ProfilesReadRepository } from './profiles/profiles-read.repository.js';
import { ProfilesWriteRepository } from './profiles/profiles-write.repository.js';
import { ProfilesModerationRepository } from './profiles/profiles-moderation.repository.js';
import { ModelSuggestionsService } from './settings/model-suggestions.service.js';
import { ModelSuggestionsRepository } from './settings/model-suggestions.repository.js';
import { HomeSettingsService } from './settings/home-settings.service.js';
import { HomeSettingsRepository } from './settings/home-settings.repository.js';
import { AdminOverviewController } from './admin-overview/admin-overview.controller.js';
import { AdminOverviewService } from './admin-overview/admin-overview.service.js';
import { AdminOverviewRepository } from './admin-overview/admin-overview.repository.js';
import { AdminTasksController } from './admin-tasks/admin-tasks.controller.js';
import { AdminTasksService } from './admin-tasks/admin-tasks.service.js';
import { AdminTasksRepository } from './admin-tasks/admin-tasks.repository.js';
import { AdminTaskRetriesRepository } from './admin-tasks/admin-task-retries.repository.js';
import { OperationalTasksController } from './admin-tasks/operational-tasks.controller.js';
import { OperationalTasksService } from './admin-tasks/operational-tasks.service.js';
import { OperationalTasksRepository } from './admin-tasks/operational-tasks.repository.js';
import { RankingRetryController } from './rankings/ranking-retry.controller.js';
import { RankingRetryService } from './rankings/ranking-retry.service.js';
import { RankingRetryRepository } from './rankings/ranking-retry.repository.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}
  async onApplicationShutdown() {
    await this.database.close();
  }
}
@Module({})
class ApiModule {
  static register(env: ServerEnvironment): DynamicModule {
    return {
      module: ApiModule,
      controllers: [
        MediaSettingsController,
        RankingSettingsController,
        PublicMediaSettingsController,
        TransferSettingsController,
        PublicTransferSettingsController,
        PublicConfigController,
        HealthController,
        AuthController,
        AdminBrandController,
        SettingsController,
        AccountSettingsController,
        SystemSettingsController,
        PublicSystemStatusController,
        CreationSettingsController,
        SecurityController,
        EmailChangeController,
        PersonasController,
        ImportsController,
        TextImportsController,
        MarketImportsController,
        AssetsController,
        ReleasesController,
        ExportsController,
        FacetsController,
        MetricsController,
        RankingsController,
        SitemapController,
        InteractionsController,
        InteractionSettingsController,
        CommentsController,
        CommentsAdminController,
        AdminUsersController,
        AdminPersonasController,
        AdminCategoriesController,
        AnnouncementsController,
        PublicHomeSettingsController,
        HomeSettingsController,
        ModelSuggestionsController,
        PublicModelSuggestionsController,
        PublicGuidesController,
        GuideSitemapController,
        AdminGuidesController,
        PublicPoliciesController,
        AdminPoliciesController,
        ReportsController,
        OwnReportsController,
        AdminReportsController,
        NotificationsController,
        AdminNotificationsController,
        ProfilesController,
        ProfileModerationController,
        PublicCreatorsController,
        AdminAnnouncementsController,
        AnnouncementSitemapController,
        AdminTagsController,
        AdminOverviewController,
        AdminTasksController,
        OperationalTasksController,
        RankingRetryController,
      ],
      providers: [
        MediaSettingsService,
        RankingSettingsService,
        RankingSettingsRepository,
        MediaSettingsRepository,
        TransferSettingsService,
        TransferSettingsRepository,
        AdminOverviewService,
        AdminOverviewRepository,
        AdminTasksService,
        AdminTasksRepository,
        AdminTaskRetriesRepository,
        OperationalTasksService,
        OperationalTasksRepository,
        RankingRetryService,
        RankingRetryRepository,
        TaxonomyManagementService,
        TaxonomyManagementRepository,
        AnnouncementsRepository,
        HomeSettingsRepository,
        HomeSettingsService,
        ModelSuggestionsRepository,
        ModelSuggestionsService,
        GuidesRepository,
        GuidesService,
        PoliciesRepository,
        PoliciesService,
        ReportsRepository,
        ReportsService,
        NotificationsService,
        NotificationsRepository,
        AdminNoticesRepository,
        NotificationFailuresRepository,
        NotificationDeliveryRepository,
        ProfilesService,
        ProfilesReadRepository,
        ProfilesWriteRepository,
        ProfilesModerationRepository,
        AnnouncementsService,
        { provide: ENVIRONMENT, useValue: env },
        InteractionsRepository,
        InteractionsService,
        InteractionSettingsService,
        CommentsService,
        CommentsReadRepository,
        CommentsWriteRepository,
        CommentsModerationRepository,
        AdminUsersService,
        AdminUsersReadRepository,
        AdminUsersWriteRepository,
        AdminDeactivationRepository,
        AdminPersonasService,
        AdminPersonasRepository,
        PersonaCurationRepository,
        { provide: DATABASE, useFactory: () => createDatabase(env.DATABASE_URL) },
        DatabaseLifecycle,
        PublicConfigRepository,
        PublicConfigService,
        AuthRepository,
        AuthService,
        AuthRateLimit,
        AuthGuard,
        MfaService,
        AdminBrandService,
        SettingsService,
        SettingsRepository,
        AccountSettingsService,
        AccountSettingsRepository,
        SystemSettingsService,
        SystemSettingsRepository,
        CreationSettingsService,
        CreationSettingsRepository,
        SecurityService,
        SecurityRepository,
        PersonasService,
        PersonasRepository,
        ImportsService,
        ImportsRepository,
        NativeImportUploadGuard,
        TextImportUploadGuard,
        MarketImportsService,
        MarketImportsRepository,
        MarketImportUploadGuard,
        MarketImportUploadLease,
        AssetsService,
        AssetsRepository,
        UploadGuard,
        ReleasesService,
        ReleasesRepository,
        ModerationRepository,
        PublicationsRepository,
        MetricsRepository,
        MetricsService,
        RankingsService,
        RankingsRepository,
        SitemapService,
        SitemapRepository,
        DiscoveryRepository,
        ExportsService,
        MarketExportService,
        FacetsRepository,
      ],
    };
  }
}

export async function createApplication(env: ServerEnvironment) {
  const logger = createLogger('api', env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.register(env), {
    logger: false,
    bodyParser: true,
    routeConflictPolicy: { duplicate: 'error', shadow: 'error' },
    routeResolutionStrategy: 'specificity',
  });
  app.useBodyParser('json', { limit: '4mb' });
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.locals['requestId'] = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.on('finish', () =>
      logger.info({
        event: 'http.completed',
        requestId,
        method: request.method,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new ErrorFilter(logger));
  app.enableShutdownHooks();
  return app;
}
