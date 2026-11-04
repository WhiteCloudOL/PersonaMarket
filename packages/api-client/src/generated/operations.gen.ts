// 此文件由 scripts/generate-api.ts 从实际 OpenAPI 生成，请勿手工修改。
import createClient, { type FetchOptions } from 'openapi-fetch';
import type * as Models from './types.gen.js';
type Parameter<D, K extends PropertyKey, N extends string> = K extends keyof D
  ? Omit<D, K> extends D
    ? { [P in N]?: D[K] }
    : { [P in N]: D[K] }
  : { [P in N]?: never };
type Params<D> = Parameter<D, 'query', 'query'> &
  Parameter<D, 'path', 'path'> &
  Parameter<D, 'headers', 'header'>;
export interface ApiPaths {
  '/api/v1/admin/settings/media': {
    get: {
      parameters: Params<Models.GetMediaSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateMediaSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateMediaSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMediaSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/media/records': {
    get: {
      parameters: Params<Models.GetMediaSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMediaSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/rankings': {
    get: {
      parameters: Params<Models.GetRankingSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateRankingSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateRankingSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateRankingSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/rankings/status': {
    get: {
      parameters: Params<Models.GetRankingRuntimeData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingRuntimeErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/rankings/records': {
    get: {
      parameters: Params<Models.GetRankingSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetRankingSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/settings/media': {
    get: {
      parameters: Params<Models.GetPublicMediaSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicMediaSettingsResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicMediaSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicMediaSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/transfer': {
    get: {
      parameters: Params<Models.GetTransferSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateTransferSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateTransferSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateTransferSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/transfer/records': {
    get: {
      parameters: Params<Models.GetTransferSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetTransferSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/settings/transfer': {
    get: {
      parameters: Params<Models.GetPublicTransferSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicTransferSettingsResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicTransferSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicTransferSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/public/config': {
    get: {
      parameters: Params<Models.GetPublicConfigData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicConfigResponses[200] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicConfigErrors[503] };
        };
      };
    };
  };
  '/health/live': {
    get: {
      parameters: Params<Models.GetLivenessData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetLivenessResponses[200] };
        };
      };
    };
  };
  '/health/ready': {
    get: {
      parameters: Params<Models.GetReadinessData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetReadinessResponses[200] };
        };
      };
    };
  };
  '/api/v1/auth/context': {
    get: {
      parameters: Params<Models.GetAuthContextData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAuthContextErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/register/code': {
    post: {
      parameters: Params<Models.RequestRegistrationCodeData>;
      requestBody: { content: { 'application/json': Models.RequestRegistrationCodeData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestRegistrationCodeErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/register': {
    post: {
      parameters: Params<Models.RegisterAccountData>;
      requestBody: { content: { 'application/json': Models.RegisterAccountData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RegisterAccountErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/login': {
    post: {
      parameters: Params<Models.LoginAccountData>;
      requestBody: { content: { 'application/json': Models.LoginAccountData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LoginAccountErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/reauthenticate': {
    post: {
      parameters: Params<Models.ReauthenticateAccountData>;
      requestBody: { content: { 'application/json': Models.ReauthenticateAccountData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReauthenticateAccountErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/verify-email': {
    post: {
      parameters: Params<Models.VerifyEmailData>;
      requestBody: { content: { 'application/json': Models.VerifyEmailData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyEmailErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/resend-verification': {
    post: {
      parameters: Params<Models.ResendVerificationData>;
      requestBody: { content: { 'application/json': Models.ResendVerificationData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResendVerificationErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/forgot-password': {
    post: {
      parameters: Params<Models.ForgotPasswordData>;
      requestBody: { content: { 'application/json': Models.ForgotPasswordData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ForgotPasswordErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/reset-password': {
    post: {
      parameters: Params<Models.ResetPasswordData>;
      requestBody: { content: { 'application/json': Models.ResetPasswordData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ResetPasswordErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/logout': {
    post: {
      parameters: Params<Models.LogoutAccountData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAccountErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/sessions': {
    get: {
      parameters: Params<Models.ListAuthSessionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAuthSessionsErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.LogoutAllSessionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LogoutAllSessionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/sessions/{id}': {
    delete: {
      parameters: Params<Models.RevokeAuthSessionData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAuthSessionErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/mfa/setup': {
    post: {
      parameters: Params<Models.SetupMfaData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetupMfaErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/mfa/confirm': {
    post: {
      parameters: Params<Models.ConfirmMfaData>;
      requestBody: { content: { 'application/json': Models.ConfirmMfaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMfaErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/mfa/verify': {
    post: {
      parameters: Params<Models.VerifyMfaData>;
      requestBody: { content: { 'application/json': Models.VerifyMfaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.VerifyMfaErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/brand': {
    get: {
      parameters: Params<Models.GetAdminBrandData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminBrandErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAdminBrandData>;
      requestBody: { content: { 'application/json': Models.UpdateAdminBrandData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminBrandErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/mail': {
    get: {
      parameters: Params<Models.GetMailSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMailSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateMailSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateMailSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateMailSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/mail/test': {
    post: {
      parameters: Params<Models.SendMailSettingsTestData>;
      requestBody: { content: { 'application/json': Models.SendMailSettingsTestData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SendMailSettingsTestErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/accounts': {
    get: {
      parameters: Params<Models.GetAccountSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAccountSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateAccountSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAccountSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/accounts/records': {
    get: {
      parameters: Params<Models.GetAccountSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAccountSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/system': {
    get: {
      parameters: Params<Models.GetSystemSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateSystemSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateSystemSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateSystemSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/system/records': {
    get: {
      parameters: Params<Models.GetSystemSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/system/runtime': {
    get: {
      parameters: Params<Models.GetSystemRuntimeData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSystemRuntimeErrors[503] };
        };
      };
    };
  };
  '/api/v1/public/system-status': {
    get: {
      parameters: Params<Models.GetPublicSystemStatusData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSystemStatusResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSystemStatusErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSystemStatusErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/creation': {
    get: {
      parameters: Params<Models.GetCreationSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreationSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateCreationSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateCreationSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCreationSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/creation/records': {
    get: {
      parameters: Params<Models.GetSubmissionSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/security/password': {
    post: {
      parameters: Params<Models.ChangeOwnPasswordData>;
      requestBody: { content: { 'application/json': Models.ChangeOwnPasswordData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeOwnPasswordErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/security/email': {
    post: {
      parameters: Params<Models.RequestOwnEmailChangeData>;
      requestBody: { content: { 'application/json': Models.RequestOwnEmailChangeData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnEmailChangeErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/security/email/confirm': {
    post: {
      parameters: Params<Models.ConfirmOwnEmailChangeCodeData>;
      requestBody: {
        content: { 'application/json': Models.ConfirmOwnEmailChangeCodeData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeCodeErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/security/deactivation': {
    get: {
      parameters: Params<Models.GetOwnDeactivationRequestData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnDeactivationRequestErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.RequestOwnDeactivationData>;
      requestBody: { content: { 'application/json': Models.RequestOwnDeactivationData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RequestOwnDeactivationErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.WithdrawOwnDeactivationData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnDeactivationErrors[503] };
        };
      };
    };
  };
  '/api/v1/auth/confirm-email-change': {
    post: {
      parameters: Params<Models.ConfirmOwnEmailChangeData>;
      requestBody: { content: { 'application/json': Models.ConfirmOwnEmailChangeData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeErrors[400] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmOwnEmailChangeErrors[429] };
        };
      };
    };
  };
  '/api/v1/site/taxonomy': {
    get: {
      parameters: Params<Models.GetPersonaTaxonomyData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPersonaTaxonomyErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas': {
    post: {
      parameters: Params<Models.CreateOwnPersonaData>;
      requestBody: { content: { 'application/json': Models.CreateOwnPersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnPersonaErrors[503] };
        };
      };
    };
    get: {
      parameters: Params<Models.ListOwnPersonasData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnPersonasErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/draft': {
    get: {
      parameters: Params<Models.GetOwnPersonaDraftData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaDraftErrors[503] };
        };
      };
    };
    put: {
      parameters: Params<Models.SaveOwnPersonaDraftData>;
      requestBody: { content: { 'application/json': Models.SaveOwnPersonaDraftData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnPersonaDraftErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-imports/preview': {
    post: {
      parameters: Params<Models.PreviewNativePersonaImportData>;
      requestBody: {
        content: { 'application/json': Models.PreviewNativePersonaImportData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-imports/preview/file': {
    post: {
      parameters: Params<Models.PreviewNativePersonaFileData>;
      requestBody: {
        content: { 'multipart/form-data': Models.PreviewNativePersonaFileData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewNativePersonaFileErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-imports/confirm': {
    post: {
      parameters: Params<Models.ConfirmNativePersonaImportData>;
      requestBody: {
        content: { 'application/json': Models.ConfirmNativePersonaImportData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmNativePersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-imports/text/source/file': {
    post: {
      parameters: Params<Models.ReadPersonaTextFileData>;
      requestBody: { content: { 'multipart/form-data': Models.ReadPersonaTextFileData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPersonaTextFileErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-imports/text/preview': {
    post: {
      parameters: Params<Models.PreviewMappedPersonaImportData>;
      requestBody: {
        content: { 'application/json': Models.PreviewMappedPersonaImportData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMappedPersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/preview': {
    post: {
      parameters: Params<Models.PreviewMarketPersonaImportData>;
      requestBody: {
        content: { 'multipart/form-data': Models.PreviewMarketPersonaImportData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewMarketPersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/{id}': {
    get: {
      parameters: Params<Models.GetMarketPersonaImportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetMarketPersonaImportErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.DiscardMarketPersonaImportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DiscardMarketPersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/{id}/images/{assetId}/import-url': {
    post: {
      parameters: Params<Models.ConfirmMarketImportImageUrlData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketImportImageUrlErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/{id}/images': {
    get: {
      parameters: Params<Models.ListMarketImportImagesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListMarketImportImagesErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/{id}/images/{assetId}': {
    get: {
      parameters: Params<Models.ReadMarketImportImageData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.ReadMarketImportImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadMarketImportImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/{id}/images/{assetId}/upload': {
    post: {
      parameters: Params<Models.UploadMarketImportImageData>;
      requestBody: {
        content: { 'multipart/form-data': Models.UploadMarketImportImageData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadMarketImportImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/market-imports/confirm': {
    post: {
      parameters: Params<Models.ConfirmMarketPersonaImportData>;
      requestBody: {
        content: { 'application/json': Models.ConfirmMarketPersonaImportData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[412] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[413] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ConfirmMarketPersonaImportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/assets': {
    get: {
      parameters: Params<Models.ListOwnAssetsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnAssetsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/assets/import-url': {
    post: {
      parameters: Params<Models.ImportOwnImageUrlData>;
      requestBody: { content: { 'application/json': Models.ImportOwnImageUrlData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ImportOwnImageUrlErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/asset-jobs/{id}': {
    get: {
      parameters: Params<Models.GetOwnImageImportJobData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnImageImportJobErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/assets/upload/{purpose}': {
    post: {
      parameters: Params<Models.UploadOwnImageData>;
      requestBody: { content: { 'multipart/form-data': Models.UploadOwnImageData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadOwnImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/assets/upload-persona-avatar': {
    post: {
      parameters: Params<Models.UploadPersonaAvatarData>;
      requestBody: { content: { 'multipart/form-data': Models.UploadPersonaAvatarData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UploadPersonaAvatarErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/assets/{id}': {
    get: {
      parameters: Params<Models.ReadOwnImageData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.ReadOwnImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[409] };
        };
        413: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[413] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadOwnImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/releases': {
    post: {
      parameters: Params<Models.CreateOwnReleaseData>;
      requestBody: { content: { 'application/json': Models.CreateOwnReleaseData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateOwnReleaseErrors[503] };
        };
      };
    };
    get: {
      parameters: Params<Models.GetOwnSubmissionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/submissions/{id}/pending-hint': {
    get: {
      parameters: Params<Models.GetOwnSubmissionPendingHintData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnSubmissionPendingHintErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/submissions/{id}/withdraw': {
    post: {
      parameters: Params<Models.WithdrawOwnSubmissionData>;
      requestBody: { content: { 'application/json': Models.WithdrawOwnSubmissionData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnSubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/restore-submission': {
    post: {
      parameters: Params<Models.RestoreOwnSubmissionDraftData>;
      requestBody: {
        content: { 'application/json': Models.RestoreOwnSubmissionDraftData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreOwnSubmissionDraftErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/moderation/submissions': {
    get: {
      parameters: Params<Models.GetSubmissionReviewQueueData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewQueueErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/moderation/submissions/{id}': {
    get: {
      parameters: Params<Models.GetSubmissionReviewDetailData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetSubmissionReviewDetailErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/moderation/submissions/{id}/review': {
    post: {
      parameters: Params<Models.ReviewSubmissionData>;
      requestBody: { content: { 'application/json': Models.ReviewSubmissionData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewSubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/visibility': {
    post: {
      parameters: Params<Models.SetOwnPersonaVisibilityData>;
      requestBody: { content: { 'application/json': Models.SetOwnPersonaVisibilityData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetOwnPersonaVisibilityErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/rollback': {
    post: {
      parameters: Params<Models.SelectOwnPublicReleaseData>;
      requestBody: { content: { 'application/json': Models.SelectOwnPublicReleaseData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SelectOwnPublicReleaseErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/personas/{id}/releases/{releaseId}/state': {
    post: {
      parameters: Params<Models.ChangeReleaseStateData>;
      requestBody: { content: { 'application/json': Models.ChangeReleaseStateData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeReleaseStateErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas': {
    get: {
      parameters: Params<Models.ListPublicPersonasData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicPersonasErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}': {
    get: {
      parameters: Params<Models.GetPublicPersonaData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/releases': {
    get: {
      parameters: Params<Models.GetPublicReleaseHistoryData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseHistoryErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/releases/{releaseId}': {
    get: {
      parameters: Params<Models.GetPublicReleaseData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicReleaseErrors[503] };
        };
      };
    };
  };
  '/api/v1/public/assets/{id}': {
    get: {
      parameters: Params<Models.ReadPublicImageData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.ReadPublicImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadPublicImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/moderation/assets/{id}': {
    get: {
      parameters: Params<Models.ReadModerationImageData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.ReadModerationImageResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadModerationImageErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/releases/{releaseId}/export-preview': {
    get: {
      parameters: Params<Models.PreviewPublicExportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[404] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.PreviewPublicExportErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/releases/{releaseId}/export': {
    get: {
      parameters: Params<Models.DownloadPublicExportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/octet-stream': Models.DownloadPublicExportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[404] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DownloadPublicExportErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/persona-filters': {
    get: {
      parameters: Params<Models.GetPublicPersonaFiltersData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaFiltersResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaFiltersErrors[429] };
        };
      };
    };
  };
  '/api/v1/public/statistics': {
    get: {
      parameters: Params<Models.GetPublicStatisticsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicStatisticsResponses[200] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicStatisticsErrors[404] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicStatisticsErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/metrics': {
    get: {
      parameters: Params<Models.GetPublicPersonaMetricsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaMetricsResponses[200] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaMetricsErrors[404] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPersonaMetricsErrors[503] };
        };
      };
    };
  };
  '/api/v1/rankings': {
    get: {
      parameters: Params<Models.ListPublicRankingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicRankingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicRankingsErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicRankingsErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicRankingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicRankingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/public/sitemap/index': {
    get: {
      parameters: Params<Models.GetPublicSitemapIndexData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapIndexResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapIndexErrors[400] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapIndexErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapIndexErrors[503] };
        };
      };
    };
  };
  '/api/v1/public/sitemap/entries': {
    get: {
      parameters: Params<Models.GetPublicSitemapEntriesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapEntriesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapEntriesErrors[400] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapEntriesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicSitemapEntriesErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/persona-interactions': {
    get: {
      parameters: Params<Models.GetOwnPersonaInteractionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnPersonaInteractionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/favorites': {
    get: {
      parameters: Params<Models.GetOwnFavoritesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnFavoritesErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/like': {
    put: {
      parameters: Params<Models.LikePersonaData>;
      requestBody: { content: { 'application/json': Models.LikePersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.LikePersonaErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.UnlikePersonaData>;
      requestBody: { content: { 'application/json': Models.UnlikePersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnlikePersonaErrors[503] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/favorite': {
    put: {
      parameters: Params<Models.FavoritePersonaData>;
      requestBody: { content: { 'application/json': Models.FavoritePersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FavoritePersonaErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.UnfavoritePersonaData>;
      requestBody: { content: { 'application/json': Models.UnfavoritePersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnfavoritePersonaErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/community': {
    get: {
      parameters: Params<Models.GetCommunitySettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommunitySettingsErrors[429] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateCommunitySettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateCommunitySettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsErrors[403] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateCommunitySettingsErrors[429] };
        };
      };
    };
  };
  '/api/v1/personas/{id}/comments': {
    get: {
      parameters: Params<Models.GetPublicCommentsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicCommentsErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.CreateCommentData>;
      requestBody: { content: { 'application/json': Models.CreateCommentData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateCommentErrors[503] };
        };
      };
    };
  };
  '/api/v1/comments/{id}/replies': {
    get: {
      parameters: Params<Models.GetCommentRepliesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCommentRepliesErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/comments': {
    get: {
      parameters: Params<Models.GetOwnCommentsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/comments/{id}': {
    get: {
      parameters: Params<Models.GetOwnCommentData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnCommentErrors[503] };
        };
      };
    };
  };
  '/api/v1/comments/{id}': {
    patch: {
      parameters: Params<Models.EditCommentData>;
      requestBody: { content: { 'application/json': Models.EditCommentData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.EditCommentErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.DeleteCommentData>;
      requestBody: { content: { 'application/json': Models.DeleteCommentData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[412] };
        };
        422: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[422] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.DeleteCommentErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/comments': {
    get: {
      parameters: Params<Models.GetModerationCommentsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/comments/{id}': {
    get: {
      parameters: Params<Models.GetModerationCommentData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModerationCommentErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/comments/bulk-review': {
    post: {
      parameters: Params<Models.ReviewCommentsBatchData>;
      requestBody: { content: { 'application/json': Models.ReviewCommentsBatchData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentsBatchErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/comments/{id}/review': {
    post: {
      parameters: Params<Models.ReviewCommentData>;
      requestBody: { content: { 'application/json': Models.ReviewCommentData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewCommentErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/comments/{id}/visibility': {
    put: {
      parameters: Params<Models.SetCommentVisibilityData>;
      requestBody: { content: { 'application/json': Models.SetCommentVisibilityData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetCommentVisibilityErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/deactivation-requests/{requestId}/review': {
    post: {
      parameters: Params<Models.ReviewDeactivationRequestData>;
      requestBody: {
        content: { 'application/json': Models.ReviewDeactivationRequestData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewDeactivationRequestErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users': {
    get: {
      parameters: Params<Models.GetAdminUsersData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUsersErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}': {
    get: {
      parameters: Params<Models.GetAdminUserData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/public-personas': {
    get: {
      parameters: Params<Models.GetAdminUserPublicPersonasData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserPublicPersonasErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/review-records': {
    get: {
      parameters: Params<Models.GetAdminUserReviewRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminUserReviewRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/role': {
    put: {
      parameters: Params<Models.SetAdminUserRoleData>;
      requestBody: { content: { 'application/json': Models.SetAdminUserRoleData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserRoleErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/status': {
    put: {
      parameters: Params<Models.SetAdminUserStatusData>;
      requestBody: { content: { 'application/json': Models.SetAdminUserStatusData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetAdminUserStatusErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/users/{id}/sessions': {
    put: {
      parameters: Params<Models.RevokeAdminUserSessionsData>;
      requestBody: { content: { 'application/json': Models.RevokeAdminUserSessionsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RevokeAdminUserSessionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas/bulk': {
    post: {
      parameters: Params<Models.BulkManagePersonasData>;
      requestBody: { content: { 'application/json': Models.BulkManagePersonasData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.BulkManagePersonasErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas/{id}/records': {
    get: {
      parameters: Params<Models.GetAdminPersonaRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas/{id}/curation': {
    put: {
      parameters: Params<Models.SetPersonaCurationData>;
      requestBody: { content: { 'application/json': Models.SetPersonaCurationData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetPersonaCurationErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas/{id}/moderation': {
    post: {
      parameters: Params<Models.ModeratePersonaData>;
      requestBody: { content: { 'application/json': Models.ModeratePersonaData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ModeratePersonaErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas': {
    get: {
      parameters: Params<Models.GetAdminPersonasData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonasErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/personas/{id}': {
    get: {
      parameters: Params<Models.GetAdminPersonaData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPersonaErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/categories': {
    get: {
      parameters: Params<Models.ListAdminCategoriesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminCategoriesErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.CreateAdminCategoryData>;
      requestBody: { content: { 'application/json': Models.CreateAdminCategoryData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminCategoryErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/categories/{id}': {
    get: {
      parameters: Params<Models.GetAdminCategoryData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAdminCategoryData>;
      requestBody: { content: { 'application/json': Models.UpdateAdminCategoryData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminCategoryErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.ArchiveAdminCategoryData>;
      requestBody: { content: { 'application/json': Models.ArchiveAdminCategoryData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminCategoryErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/categories/{id}/records': {
    get: {
      parameters: Params<Models.GetAdminCategoryRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminCategoryRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/categories/{id}/restore': {
    post: {
      parameters: Params<Models.RestoreAdminCategoryData>;
      requestBody: { content: { 'application/json': Models.RestoreAdminCategoryData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminCategoryErrors[503] };
        };
      };
    };
  };
  '/api/v1/announcements': {
    get: {
      parameters: Params<Models.ListPublicAnnouncementsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicAnnouncementsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicAnnouncementsErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicAnnouncementsErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicAnnouncementsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListPublicAnnouncementsErrors[503] };
        };
      };
    };
  };
  '/api/v1/announcements/{id}': {
    get: {
      parameters: Params<Models.GetPublicAnnouncementData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicAnnouncementResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicAnnouncementErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicAnnouncementErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicAnnouncementErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicAnnouncementErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/home': {
    get: {
      parameters: Params<Models.GetPublicHomeSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicHomeSettingsResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicHomeSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicHomeSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/home': {
    get: {
      parameters: Params<Models.GetHomeSettingsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateHomeSettingsData>;
      requestBody: { content: { 'application/json': Models.UpdateHomeSettingsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateHomeSettingsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/home/records': {
    get: {
      parameters: Params<Models.GetHomeSettingsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetHomeSettingsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/model-suggestions': {
    get: {
      parameters: Params<Models.GetModelSuggestionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateModelSuggestionsData>;
      requestBody: { content: { 'application/json': Models.UpdateModelSuggestionsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateModelSuggestionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/model-suggestions/records': {
    get: {
      parameters: Params<Models.GetModelSuggestionsRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetModelSuggestionsRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/model-suggestions': {
    get: {
      parameters: Params<Models.GetPublicModelSuggestionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicModelSuggestionsResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicModelSuggestionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicModelSuggestionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/guides': {
    get: {
      parameters: Params<Models.GetPublicGuidesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuidesResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuidesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuidesErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/guides/{slug}': {
    get: {
      parameters: Params<Models.GetPublicGuideData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuideResponses[200] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuideErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuideErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicGuideErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/guide-sitemap': {
    get: {
      parameters: Params<Models.GetGuideSitemapData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideSitemapResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideSitemapErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideSitemapErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/guides': {
    get: {
      parameters: Params<Models.ListAdminGuidesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminGuidesErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/guides/{slug}': {
    get: {
      parameters: Params<Models.GetAdminGuideData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminGuideErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAdminGuideData>;
      requestBody: { content: { 'application/json': Models.UpdateAdminGuideData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminGuideErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/guides/{slug}/records': {
    get: {
      parameters: Params<Models.GetGuideRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetGuideRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/guides/{slug}/actions/{action}': {
    post: {
      parameters: Params<Models.ChangeAdminGuideStateData>;
      requestBody: { content: { 'application/json': Models.ChangeAdminGuideStateData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminGuideStateErrors[503] };
        };
      };
    };
  };
  '/api/v1/policies': {
    get: {
      parameters: Params<Models.GetPublicPoliciesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPoliciesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPoliciesErrors[400] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPoliciesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPoliciesErrors[503] };
        };
      };
    };
  };
  '/api/v1/policies/{slug}': {
    get: {
      parameters: Params<Models.GetPublicPolicyData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPolicyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPolicyErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPolicyErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPolicyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPublicPolicyErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies': {
    get: {
      parameters: Params<Models.ListAdminPoliciesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminPoliciesErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}': {
    get: {
      parameters: Params<Models.GetAdminPolicyData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminPolicyErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdatePolicyDraftData>;
      requestBody: { content: { 'application/json': Models.UpdatePolicyDraftData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdatePolicyDraftErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/submissions': {
    post: {
      parameters: Params<Models.SubmitPolicyData>;
      requestBody: { content: { 'application/json': Models.SubmitPolicyData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitPolicyErrors[503] };
        };
      };
    };
    get: {
      parameters: Params<Models.GetPolicySubmissionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/submissions/{id}': {
    get: {
      parameters: Params<Models.GetPolicySubmissionData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicySubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/submissions/{id}/withdraw': {
    post: {
      parameters: Params<Models.WithdrawPolicySubmissionData>;
      requestBody: { content: { 'application/json': Models.WithdrawPolicySubmissionData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawPolicySubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/submissions/{id}/review': {
    post: {
      parameters: Params<Models.ReviewPolicySubmissionData>;
      requestBody: { content: { 'application/json': Models.ReviewPolicySubmissionData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewPolicySubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/actions/unpublish': {
    post: {
      parameters: Params<Models.UnpublishPolicyData>;
      requestBody: { content: { 'application/json': Models.UnpublishPolicyData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UnpublishPolicyErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/actions/activate': {
    post: {
      parameters: Params<Models.ActivatePolicyData>;
      requestBody: { content: { 'application/json': Models.ActivatePolicyData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ActivatePolicyErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/records': {
    get: {
      parameters: Params<Models.GetPolicyRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/settings/policies/{slug}/records/{id}': {
    get: {
      parameters: Params<Models.GetPolicyRecordData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetPolicyRecordErrors[503] };
        };
      };
    };
  };
  '/api/v1/reports': {
    post: {
      parameters: Params<Models.CreateReportData>;
      requestBody: { content: { 'application/json': Models.CreateReportData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateReportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/reports/{id}/avatar': {
    get: {
      parameters: Params<Models.GetOwnReportAvatarData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.GetOwnReportAvatarResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportAvatarErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/reports': {
    get: {
      parameters: Params<Models.ListOwnReportsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnReportsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/reports/{id}': {
    get: {
      parameters: Params<Models.GetOwnReportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/reports/{id}/records': {
    get: {
      parameters: Params<Models.GetOwnReportRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnReportRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/reports/{id}/avatar': {
    get: {
      parameters: Params<Models.GetAdminReportAvatarData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.GetAdminReportAvatarResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportAvatarErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/reports': {
    get: {
      parameters: Params<Models.ListAdminReportsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminReportsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/reports/{id}': {
    get: {
      parameters: Params<Models.GetAdminReportData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/reports/{id}/records': {
    get: {
      parameters: Params<Models.GetAdminReportRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminReportRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/reports/{id}/actions': {
    post: {
      parameters: Params<Models.ProcessReportData>;
      requestBody: { content: { 'application/json': Models.ProcessReportData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ProcessReportErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/notifications': {
    get: {
      parameters: Params<Models.ListNotificationsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/notifications/count': {
    get: {
      parameters: Params<Models.GetNotificationCountData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationCountErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/notifications/preferences': {
    get: {
      parameters: Params<Models.GetNotificationPreferencesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationPreferencesErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateNotificationPreferencesData>;
      requestBody: {
        content: { 'application/json': Models.UpdateNotificationPreferencesData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateNotificationPreferencesErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/notifications/read-all': {
    patch: {
      parameters: Params<Models.ReadAllNotificationsData>;
      requestBody: { content: { 'application/json': Models.ReadAllNotificationsData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadAllNotificationsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/notifications/{id}/read': {
    patch: {
      parameters: Params<Models.ReadNotificationData>;
      requestBody: { content: { 'application/json': Models.ReadNotificationData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReadNotificationErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/deliveries/{id}/retry-receipt': {
    get: {
      parameters: Params<Models.GetNotificationRetryReceiptData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationRetryReceiptErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/deliveries/{id}': {
    get: {
      parameters: Params<Models.GetNotificationDeliveryData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetNotificationDeliveryErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/failures/list': {
    get: {
      parameters: Params<Models.ListNotificationFailuresData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListNotificationFailuresErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/failures/{id}/retry': {
    post: {
      parameters: Params<Models.RetryNotificationFailureData>;
      requestBody: { content: { 'application/json': Models.RetryNotificationFailureData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryNotificationFailureErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/recipients/lookup': {
    get: {
      parameters: Params<Models.FindNotificationRecipientData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.FindNotificationRecipientErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications': {
    get: {
      parameters: Params<Models.ListAdminNoticesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminNoticesErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.CreateAdminNoticeData>;
      requestBody: { content: { 'application/json': Models.CreateAdminNoticeData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminNoticeErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/{id}': {
    get: {
      parameters: Params<Models.GetAdminNoticeData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminNoticeErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/notifications/{id}/retry': {
    post: {
      parameters: Params<Models.RetryAdminNoticeData>;
      requestBody: { content: { 'application/json': Models.RetryAdminNoticeData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminNoticeErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/profile': {
    get: {
      parameters: Params<Models.GetOwnProfileData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileErrors[503] };
        };
      };
    };
    put: {
      parameters: Params<Models.SaveOwnProfileData>;
      requestBody: { content: { 'application/json': Models.SaveOwnProfileData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SaveOwnProfileErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/profile/records': {
    get: {
      parameters: Params<Models.ListOwnProfileRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/profile/submissions': {
    get: {
      parameters: Params<Models.ListOwnProfileSubmissionsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListOwnProfileSubmissionsErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.SubmitOwnProfileData>;
      requestBody: { content: { 'application/json': Models.SubmitOwnProfileData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SubmitOwnProfileErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/profile/submissions/{id}': {
    get: {
      parameters: Params<Models.GetOwnProfileSubmissionData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOwnProfileSubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/me/profile/submissions/{id}/withdraw': {
    post: {
      parameters: Params<Models.WithdrawOwnProfileSubmissionData>;
      requestBody: {
        content: { 'application/json': Models.WithdrawOwnProfileSubmissionData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.WithdrawOwnProfileSubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/{userId}/records': {
    get: {
      parameters: Params<Models.ListModerationProfileRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListModerationProfileRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/submissions': {
    get: {
      parameters: Params<Models.ListProfileModerationData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListProfileModerationErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/submissions/{id}': {
    get: {
      parameters: Params<Models.GetProfileModerationData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileModerationErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/submissions/{id}/review': {
    post: {
      parameters: Params<Models.ReviewProfileSubmissionData>;
      requestBody: { content: { 'application/json': Models.ReviewProfileSubmissionData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ReviewProfileSubmissionErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/{userId}/visibility': {
    post: {
      parameters: Params<Models.SetProfileVisibilityData>;
      requestBody: { content: { 'application/json': Models.SetProfileVisibilityData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.SetProfileVisibilityErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/profiles/submissions/{id}/avatar': {
    get: {
      parameters: Params<Models.GetProfileSubmissionAvatarData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.GetProfileSubmissionAvatarResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetProfileSubmissionAvatarErrors[503] };
        };
      };
    };
  };
  '/api/v1/users/{username}/personas': {
    get: {
      parameters: Params<Models.ListCreatorPersonasData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListCreatorPersonasResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListCreatorPersonasErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListCreatorPersonasErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListCreatorPersonasErrors[429] };
        };
      };
    };
  };
  '/api/v1/users/{username}': {
    get: {
      parameters: Params<Models.GetCreatorData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorErrors[429] };
        };
      };
    };
  };
  '/api/v1/users/{username}/avatar/{id}': {
    get: {
      parameters: Params<Models.GetCreatorAvatarData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'image/webp': Models.GetCreatorAvatarResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorAvatarErrors[400] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorAvatarErrors[404] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetCreatorAvatarErrors[429] };
        };
      };
    };
  };
  '/api/v1/admin/announcements': {
    get: {
      parameters: Params<Models.ListAdminAnnouncementsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminAnnouncementsErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.CreateAdminAnnouncementData>;
      requestBody: { content: { 'application/json': Models.CreateAdminAnnouncementData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminAnnouncementErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/announcements/{id}': {
    get: {
      parameters: Params<Models.GetAdminAnnouncementData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAdminAnnouncementData>;
      requestBody: { content: { 'application/json': Models.UpdateAdminAnnouncementData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminAnnouncementErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/announcements/{id}/records': {
    get: {
      parameters: Params<Models.GetAdminAnnouncementRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminAnnouncementRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/announcements/{id}/{action}': {
    post: {
      parameters: Params<Models.ChangeAdminAnnouncementStateData>;
      requestBody: {
        content: { 'application/json': Models.ChangeAdminAnnouncementStateData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ChangeAdminAnnouncementStateErrors[503] };
        };
      };
    };
  };
  '/api/v1/site/announcement-sitemap': {
    get: {
      parameters: Params<Models.GetAnnouncementSitemapData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAnnouncementSitemapResponses[200] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAnnouncementSitemapErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAnnouncementSitemapErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tags': {
    get: {
      parameters: Params<Models.ListAdminTagsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTagsErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.CreateAdminTagData>;
      requestBody: { content: { 'application/json': Models.CreateAdminTagData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.CreateAdminTagErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tags/{id}': {
    get: {
      parameters: Params<Models.GetAdminTagData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagErrors[503] };
        };
      };
    };
    patch: {
      parameters: Params<Models.UpdateAdminTagData>;
      requestBody: { content: { 'application/json': Models.UpdateAdminTagData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.UpdateAdminTagErrors[503] };
        };
      };
    };
    delete: {
      parameters: Params<Models.ArchiveAdminTagData>;
      requestBody: { content: { 'application/json': Models.ArchiveAdminTagData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ArchiveAdminTagErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tags/{id}/records': {
    get: {
      parameters: Params<Models.GetAdminTagRecordsData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTagRecordsErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tags/{id}/restore': {
    post: {
      parameters: Params<Models.RestoreAdminTagData>;
      requestBody: { content: { 'application/json': Models.RestoreAdminTagData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RestoreAdminTagErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/overview': {
    get: {
      parameters: Params<Models.GetAdminOverviewData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewResponses[200] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewErrors[403] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminOverviewErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tasks/{source}/{id}': {
    get: {
      parameters: Params<Models.GetAdminTaskFailureData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminTaskFailureErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tasks/{source}/{id}/retries': {
    get: {
      parameters: Params<Models.ListAdminTaskRetriesData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskRetriesErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tasks/{source}/{id}/retry': {
    post: {
      parameters: Params<Models.RetryAdminTaskData>;
      requestBody: { content: { 'application/json': Models.RetryAdminTaskData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminTaskErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/tasks': {
    get: {
      parameters: Params<Models.ListAdminTaskFailuresData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.ListAdminTaskFailuresErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/operations/{kind}/{id}': {
    get: {
      parameters: Params<Models.GetOperationalTaskData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskErrors[503] };
        };
      };
    };
    post: {
      parameters: Params<Models.HandleOperationalTaskData>;
      requestBody: { content: { 'application/json': Models.HandleOperationalTaskData['body'] } };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.HandleOperationalTaskErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/operations/{kind}/{id}/receipt': {
    get: {
      parameters: Params<Models.GetOperationalTaskReceiptData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[409] };
        };
        412: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[412] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetOperationalTaskReceiptErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/rankings/generations/{id}': {
    get: {
      parameters: Params<Models.GetAdminRankingGenerationData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingGenerationErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/rankings/generations/{id}/retry-receipt': {
    get: {
      parameters: Params<Models.GetAdminRankingRetryReceiptData>;
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.GetAdminRankingRetryReceiptErrors[503] };
        };
      };
    };
  };
  '/api/v1/admin/rankings/generations/{id}/retry': {
    post: {
      parameters: Params<Models.RetryAdminRankingGenerationData>;
      requestBody: {
        content: { 'application/json': Models.RetryAdminRankingGenerationData['body'] };
      };
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationResponses[200] };
        };
        400: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[400] };
        };
        401: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[401] };
        };
        403: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[403] };
        };
        404: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[404] };
        };
        409: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[409] };
        };
        429: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[429] };
        };
        503: {
          headers: Record<string, unknown>;
          content: { 'application/json': Models.RetryAdminRankingGenerationErrors[503] };
        };
      };
    };
  };
}
export function getMediaSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/media']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/media', options);
}
export function updateMediaSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/media']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/media', options);
}
export function getMediaSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/media/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/media/records', options);
}
export function getRankingSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/rankings']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/rankings', options);
}
export function updateRankingSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/rankings']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/rankings', options);
}
export function getRankingRuntime({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/rankings/status']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/rankings/status', options);
}
export function getRankingSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/rankings/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/rankings/records',
    options,
  );
}
export function getPublicMediaSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/settings/media']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/settings/media', options);
}
export function getTransferSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/transfer']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/transfer', options);
}
export function updateTransferSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/transfer']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/transfer', options);
}
export function getTransferSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/transfer/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/transfer/records',
    options,
  );
}
export function getPublicTransferSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/settings/transfer']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/settings/transfer', options);
}
export function getPublicConfig({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/config']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/config', options);
}
export function getLiveness({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/health/live']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/health/live', options);
}
export function getReadiness({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/health/ready']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/health/ready', options);
}
export function getAuthContext({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/context']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/auth/context', options);
}
export function requestRegistrationCode({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/register/code']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/register/code', options);
}
export function registerAccount({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/register']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/register', options);
}
export function loginAccount({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/login']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/login', options);
}
export function reauthenticateAccount({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/reauthenticate']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/reauthenticate', options);
}
export function verifyEmail({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/verify-email']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/verify-email', options);
}
export function resendVerification({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/resend-verification']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/resend-verification', options);
}
export function forgotPassword({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/forgot-password']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/forgot-password', options);
}
export function resetPassword({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/reset-password']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/reset-password', options);
}
export function logoutAccount({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/logout']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/logout', options);
}
export function listAuthSessions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/sessions']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/auth/sessions', options);
}
export function logoutAllSessions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/sessions']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/auth/sessions', options);
}
export function revokeAuthSession({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/sessions/{id}']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/auth/sessions/{id}', options);
}
export function setupMfa({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/mfa/setup']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/mfa/setup', options);
}
export function confirmMfa({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/mfa/confirm']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/mfa/confirm', options);
}
export function verifyMfa({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/mfa/verify']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/mfa/verify', options);
}
export function getAdminBrand({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/brand']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/brand', options);
}
export function updateAdminBrand({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/brand']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/brand', options);
}
export function getMailSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/mail']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/mail', options);
}
export function updateMailSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/mail']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/mail', options);
}
export function sendMailSettingsTest({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/mail/test']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/settings/mail/test', options);
}
export function getAccountSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/accounts']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/accounts', options);
}
export function updateAccountSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/accounts']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/accounts', options);
}
export function getAccountSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/accounts/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/accounts/records',
    options,
  );
}
export function getSystemSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/system']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/system', options);
}
export function updateSystemSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/system']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/system', options);
}
export function getSystemSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/system/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/system/records', options);
}
export function getSystemRuntime({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/system/runtime']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/system/runtime', options);
}
export function getPublicSystemStatus({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/system-status']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/system-status', options);
}
export function getCreationSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/creation']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/creation', options);
}
export function updateCreationSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/creation']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/creation', options);
}
export function getSubmissionSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/creation/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/creation/records',
    options,
  );
}
export function changeOwnPassword({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/password']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/security/password', options);
}
export function requestOwnEmailChange({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/email']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/security/email', options);
}
export function confirmOwnEmailChangeCode({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/email/confirm']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/security/email/confirm', options);
}
export function getOwnDeactivationRequest({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/deactivation']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/security/deactivation', options);
}
export function requestOwnDeactivation({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/deactivation']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/security/deactivation', options);
}
export function withdrawOwnDeactivation({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/security/deactivation']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/me/security/deactivation', options);
}
export function confirmOwnEmailChange({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/auth/confirm-email-change']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/auth/confirm-email-change', options);
}
export function getPersonaTaxonomy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/taxonomy']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/taxonomy', options);
}
export function createOwnPersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/personas', options);
}
export function listOwnPersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/personas', options);
}
export function getOwnPersonaDraft({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/draft']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/personas/{id}/draft', options);
}
export function saveOwnPersonaDraft({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/draft']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/me/personas/{id}/draft', options);
}
export function previewNativePersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-imports/preview']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/persona-imports/preview', options);
}
export function previewNativePersonaFile({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-imports/preview/file']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/persona-imports/preview/file',
    options,
  );
}
export function confirmNativePersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-imports/confirm']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/persona-imports/confirm', options);
}
export function readPersonaTextFile({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-imports/text/source/file']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/persona-imports/text/source/file',
    options,
  );
}
export function previewMappedPersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-imports/text/preview']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/persona-imports/text/preview',
    options,
  );
}
export function previewMarketPersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/preview']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/market-imports/preview', options);
}
export function getMarketPersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/market-imports/{id}', options);
}
export function discardMarketPersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/me/market-imports/{id}', options);
}
export function confirmMarketImportImageUrl({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}/images/{assetId}/import-url']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/market-imports/{id}/images/{assetId}/import-url',
    options,
  );
}
export function listMarketImportImages({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}/images']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/market-imports/{id}/images', options);
}
export function readMarketImportImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}/images/{assetId}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/me/market-imports/{id}/images/{assetId}',
    options,
  );
}
export function uploadMarketImportImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/{id}/images/{assetId}/upload']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/market-imports/{id}/images/{assetId}/upload',
    options,
  );
}
export function confirmMarketPersonaImport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/market-imports/confirm']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/market-imports/confirm', options);
}
export function listOwnAssets({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/assets']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/assets', options);
}
export function importOwnImageUrl({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/assets/import-url']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/assets/import-url', options);
}
export function getOwnImageImportJob({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/asset-jobs/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/asset-jobs/{id}', options);
}
export function uploadOwnImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/assets/upload/{purpose}']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/assets/upload/{purpose}', options);
}
export function uploadPersonaAvatar({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/assets/upload-persona-avatar']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/assets/upload-persona-avatar',
    options,
  );
}
export function readOwnImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/assets/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/assets/{id}', options);
}
export function createOwnRelease({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/releases']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/personas/{id}/releases', options);
}
export function getOwnSubmissions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/releases']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/personas/{id}/releases', options);
}
export function getOwnSubmissionPendingHint({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/submissions/{id}/pending-hint']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/me/submissions/{id}/pending-hint',
    options,
  );
}
export function withdrawOwnSubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/submissions/{id}/withdraw']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/submissions/{id}/withdraw', options);
}
export function restoreOwnSubmissionDraft({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/restore-submission']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/personas/{id}/restore-submission',
    options,
  );
}
export function getSubmissionReviewQueue({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/moderation/submissions']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/moderation/submissions', options);
}
export function getSubmissionReviewDetail({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/moderation/submissions/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/moderation/submissions/{id}',
    options,
  );
}
export function reviewSubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/moderation/submissions/{id}/review']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/moderation/submissions/{id}/review',
    options,
  );
}
export function setOwnPersonaVisibility({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/visibility']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/personas/{id}/visibility', options);
}
export function selectOwnPublicRelease({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/rollback']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/personas/{id}/rollback', options);
}
export function changeReleaseState({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/personas/{id}/releases/{releaseId}/state']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/personas/{id}/releases/{releaseId}/state',
    options,
  );
}
export function listPublicPersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/personas', options);
}
export function getPublicPersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/personas/{id}', options);
}
export function getPublicReleaseHistory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/releases']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/personas/{id}/releases', options);
}
export function getPublicRelease({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/releases/{releaseId}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/personas/{id}/releases/{releaseId}',
    options,
  );
}
export function readPublicImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/assets/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/assets/{id}', options);
}
export function readModerationImage({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/moderation/assets/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/moderation/assets/{id}', options);
}
export function previewPublicExport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/releases/{releaseId}/export-preview']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/personas/{id}/releases/{releaseId}/export-preview',
    options,
  );
}
export function downloadPublicExport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/releases/{releaseId}/export']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/personas/{id}/releases/{releaseId}/export',
    options,
  );
}
export function getPublicPersonaFilters({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/persona-filters']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/persona-filters', options);
}
export function getPublicStatistics({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/statistics']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/statistics', options);
}
export function getPublicPersonaMetrics({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/metrics']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/personas/{id}/metrics', options);
}
export function listPublicRankings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/rankings']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/rankings', options);
}
export function getPublicSitemapIndex({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/sitemap/index']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/sitemap/index', options);
}
export function getPublicSitemapEntries({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/public/sitemap/entries']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/public/sitemap/entries', options);
}
export function getOwnPersonaInteractions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/persona-interactions']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/persona-interactions', options);
}
export function getOwnFavorites({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/favorites']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/favorites', options);
}
export function likePersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/like']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/personas/{id}/like', options);
}
export function unlikePersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/like']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/personas/{id}/like', options);
}
export function favoritePersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/favorite']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/personas/{id}/favorite', options);
}
export function unfavoritePersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/favorite']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/personas/{id}/favorite', options);
}
export function getCommunitySettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/community']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/community', options);
}
export function updateCommunitySettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/community']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/community', options);
}
export function getPublicComments({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/comments']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/personas/{id}/comments', options);
}
export function createComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/personas/{id}/comments']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/personas/{id}/comments', options);
}
export function getCommentReplies({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/comments/{id}/replies']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/comments/{id}/replies', options);
}
export function getOwnComments({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/comments']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/comments', options);
}
export function getOwnComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/comments/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/comments/{id}', options);
}
export function editComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/comments/{id}']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/comments/{id}', options);
}
export function deleteComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/comments/{id}']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/comments/{id}', options);
}
export function getModerationComments({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/comments']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/comments', options);
}
export function getModerationComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/comments/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/comments/{id}', options);
}
export function reviewCommentsBatch({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/comments/bulk-review']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/comments/bulk-review', options);
}
export function reviewComment({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/comments/{id}/review']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/comments/{id}/review', options);
}
export function setCommentVisibility({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/comments/{id}/visibility']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/admin/comments/{id}/visibility', options);
}
export function reviewDeactivationRequest({
  baseUrl = '',
  ...options
}: FetchOptions<
  ApiPaths['/api/v1/admin/users/{id}/deactivation-requests/{requestId}/review']['post']
> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/users/{id}/deactivation-requests/{requestId}/review',
    options,
  );
}
export function getAdminUsers({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/users', options);
}
export function getAdminUser({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/users/{id}', options);
}
export function getAdminUserPublicPersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}/public-personas']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/users/{id}/public-personas',
    options,
  );
}
export function getAdminUserReviewRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}/review-records']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/users/{id}/review-records',
    options,
  );
}
export function setAdminUserRole({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}/role']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/admin/users/{id}/role', options);
}
export function setAdminUserStatus({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}/status']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/admin/users/{id}/status', options);
}
export function revokeAdminUserSessions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/users/{id}/sessions']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/admin/users/{id}/sessions', options);
}
export function bulkManagePersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas/bulk']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/personas/bulk', options);
}
export function getAdminPersonaRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas/{id}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/personas/{id}/records', options);
}
export function setPersonaCuration({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas/{id}/curation']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/admin/personas/{id}/curation', options);
}
export function moderatePersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas/{id}/moderation']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/personas/{id}/moderation',
    options,
  );
}
export function getAdminPersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/personas', options);
}
export function getAdminPersona({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/personas/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/personas/{id}', options);
}
export function listAdminCategories({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/categories', options);
}
export function createAdminCategory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/categories', options);
}
export function getAdminCategory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/categories/{id}', options);
}
export function updateAdminCategory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories/{id}']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/categories/{id}', options);
}
export function archiveAdminCategory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories/{id}']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/admin/categories/{id}', options);
}
export function getAdminCategoryRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories/{id}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/categories/{id}/records', options);
}
export function restoreAdminCategory({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/categories/{id}/restore']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/categories/{id}/restore', options);
}
export function listPublicAnnouncements({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/announcements']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/announcements', options);
}
export function getPublicAnnouncement({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/announcements/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/announcements/{id}', options);
}
export function getPublicHomeSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/home']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/home', options);
}
export function getHomeSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/home']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/home', options);
}
export function updateHomeSettings({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/home']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/settings/home', options);
}
export function getHomeSettingsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/home/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/home/records', options);
}
export function getModelSuggestions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/model-suggestions']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/model-suggestions',
    options,
  );
}
export function updateModelSuggestions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/model-suggestions']['patch']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).PATCH(
    '/api/v1/admin/settings/model-suggestions',
    options,
  );
}
export function getModelSuggestionsRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/model-suggestions/records']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/model-suggestions/records',
    options,
  );
}
export function getPublicModelSuggestions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/model-suggestions']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/model-suggestions', options);
}
export function getPublicGuides({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/guides']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/guides', options);
}
export function getPublicGuide({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/guides/{slug}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/guides/{slug}', options);
}
export function getGuideSitemap({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/guide-sitemap']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/guide-sitemap', options);
}
export function listAdminGuides({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/guides']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/guides', options);
}
export function getAdminGuide({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/guides/{slug}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/guides/{slug}', options);
}
export function updateAdminGuide({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/guides/{slug}']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/guides/{slug}', options);
}
export function getGuideRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/guides/{slug}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/guides/{slug}/records', options);
}
export function changeAdminGuideState({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/guides/{slug}/actions/{action}']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/guides/{slug}/actions/{action}',
    options,
  );
}
export function getPublicPolicies({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/policies']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/policies', options);
}
export function getPublicPolicy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/policies/{slug}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/policies/{slug}', options);
}
export function listAdminPolicies({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/policies', options);
}
export function getAdminPolicy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/settings/policies/{slug}', options);
}
export function updatePolicyDraft({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}']['patch']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).PATCH(
    '/api/v1/admin/settings/policies/{slug}',
    options,
  );
}
export function submitPolicy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/submissions']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/settings/policies/{slug}/submissions',
    options,
  );
}
export function getPolicySubmissions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/submissions']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/policies/{slug}/submissions',
    options,
  );
}
export function getPolicySubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/submissions/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/policies/{slug}/submissions/{id}',
    options,
  );
}
export function withdrawPolicySubmission({
  baseUrl = '',
  ...options
}: FetchOptions<
  ApiPaths['/api/v1/admin/settings/policies/{slug}/submissions/{id}/withdraw']['post']
> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/settings/policies/{slug}/submissions/{id}/withdraw',
    options,
  );
}
export function reviewPolicySubmission({
  baseUrl = '',
  ...options
}: FetchOptions<
  ApiPaths['/api/v1/admin/settings/policies/{slug}/submissions/{id}/review']['post']
> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/settings/policies/{slug}/submissions/{id}/review',
    options,
  );
}
export function unpublishPolicy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/actions/unpublish']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/settings/policies/{slug}/actions/unpublish',
    options,
  );
}
export function activatePolicy({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/actions/activate']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/settings/policies/{slug}/actions/activate',
    options,
  );
}
export function getPolicyRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/records']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/policies/{slug}/records',
    options,
  );
}
export function getPolicyRecord({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/settings/policies/{slug}/records/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/settings/policies/{slug}/records/{id}',
    options,
  );
}
export function createReport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/reports']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/reports', options);
}
export function getOwnReportAvatar({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/reports/{id}/avatar']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/reports/{id}/avatar', options);
}
export function listOwnReports({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/reports']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/reports', options);
}
export function getOwnReport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/reports/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/reports/{id}', options);
}
export function getOwnReportRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/reports/{id}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/reports/{id}/records', options);
}
export function getAdminReportAvatar({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/reports/{id}/avatar']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/reports/{id}/avatar', options);
}
export function listAdminReports({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/reports']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/reports', options);
}
export function getAdminReport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/reports/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/reports/{id}', options);
}
export function getAdminReportRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/reports/{id}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/reports/{id}/records', options);
}
export function processReport({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/reports/{id}/actions']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/reports/{id}/actions', options);
}
export function listNotifications({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/notifications', options);
}
export function getNotificationCount({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications/count']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/notifications/count', options);
}
export function getNotificationPreferences({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications/preferences']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/notifications/preferences', options);
}
export function updateNotificationPreferences({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications/preferences']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/me/notifications/preferences', options);
}
export function readAllNotifications({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications/read-all']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/me/notifications/read-all', options);
}
export function readNotification({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/notifications/{id}/read']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/me/notifications/{id}/read', options);
}
export function getNotificationRetryReceipt({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/deliveries/{id}/retry-receipt']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/notifications/deliveries/{id}/retry-receipt',
    options,
  );
}
export function getNotificationDelivery({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/deliveries/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/notifications/deliveries/{id}',
    options,
  );
}
export function listNotificationFailures({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/failures/list']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/notifications/failures/list',
    options,
  );
}
export function retryNotificationFailure({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/failures/{id}/retry']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/notifications/failures/{id}/retry',
    options,
  );
}
export function findNotificationRecipient({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/recipients/lookup']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/notifications/recipients/lookup',
    options,
  );
}
export function listAdminNotices({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/notifications', options);
}
export function createAdminNotice({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/notifications', options);
}
export function getAdminNotice({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/notifications/{id}', options);
}
export function retryAdminNotice({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/notifications/{id}/retry']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/notifications/{id}/retry',
    options,
  );
}
export function getOwnProfile({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/profile', options);
}
export function saveOwnProfile({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile']['put']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PUT('/api/v1/me/profile', options);
}
export function listOwnProfileRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile/records']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/profile/records', options);
}
export function listOwnProfileSubmissions({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile/submissions']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/profile/submissions', options);
}
export function submitOwnProfile({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile/submissions']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/me/profile/submissions', options);
}
export function getOwnProfileSubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile/submissions/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/me/profile/submissions/{id}', options);
}
export function withdrawOwnProfileSubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/me/profile/submissions/{id}/withdraw']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/me/profile/submissions/{id}/withdraw',
    options,
  );
}
export function listModerationProfileRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/{userId}/records']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/profiles/{userId}/records',
    options,
  );
}
export function listProfileModeration({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/submissions']['get']> & {
  baseUrl?: string;
} = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/profiles/submissions', options);
}
export function getProfileModeration({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/submissions/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/profiles/submissions/{id}',
    options,
  );
}
export function reviewProfileSubmission({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/submissions/{id}/review']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/profiles/submissions/{id}/review',
    options,
  );
}
export function setProfileVisibility({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/{userId}/visibility']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/profiles/{userId}/visibility',
    options,
  );
}
export function getProfileSubmissionAvatar({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/profiles/submissions/{id}/avatar']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/profiles/submissions/{id}/avatar',
    options,
  );
}
export function listCreatorPersonas({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/users/{username}/personas']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/users/{username}/personas', options);
}
export function getCreator({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/users/{username}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/users/{username}', options);
}
export function getCreatorAvatar({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/users/{username}/avatar/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/users/{username}/avatar/{id}', options);
}
export function listAdminAnnouncements({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/announcements', options);
}
export function createAdminAnnouncement({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/announcements', options);
}
export function getAdminAnnouncement({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/announcements/{id}', options);
}
export function updateAdminAnnouncement({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements/{id}']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/announcements/{id}', options);
}
export function getAdminAnnouncementRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements/{id}/records']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/announcements/{id}/records',
    options,
  );
}
export function changeAdminAnnouncementState({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/announcements/{id}/{action}']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/announcements/{id}/{action}',
    options,
  );
}
export function getAnnouncementSitemap({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/site/announcement-sitemap']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/site/announcement-sitemap', options);
}
export function listAdminTags({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/tags', options);
}
export function createAdminTag({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/tags', options);
}
export function getAdminTag({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/tags/{id}', options);
}
export function updateAdminTag({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags/{id}']['patch']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).PATCH('/api/v1/admin/tags/{id}', options);
}
export function archiveAdminTag({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags/{id}']['delete']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).DELETE('/api/v1/admin/tags/{id}', options);
}
export function getAdminTagRecords({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags/{id}/records']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/tags/{id}/records', options);
}
export function restoreAdminTag({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tags/{id}/restore']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/tags/{id}/restore', options);
}
export function getAdminOverview({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/overview']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/overview', options);
}
export function getAdminTaskFailure({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tasks/{source}/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/tasks/{source}/{id}', options);
}
export function listAdminTaskRetries({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tasks/{source}/{id}/retries']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/tasks/{source}/{id}/retries',
    options,
  );
}
export function retryAdminTask({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tasks/{source}/{id}/retry']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/tasks/{source}/{id}/retry',
    options,
  );
}
export function listAdminTaskFailures({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/tasks']['get']> & { baseUrl?: string } = {}) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/tasks', options);
}
export function getOperationalTask({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/operations/{kind}/{id}']['get']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).GET('/api/v1/admin/operations/{kind}/{id}', options);
}
export function handleOperationalTask({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/operations/{kind}/{id}']['post']> & { baseUrl?: string }) {
  return createClient<ApiPaths>({ baseUrl }).POST('/api/v1/admin/operations/{kind}/{id}', options);
}
export function getOperationalTaskReceipt({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/operations/{kind}/{id}/receipt']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/operations/{kind}/{id}/receipt',
    options,
  );
}
export function getAdminRankingGeneration({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/rankings/generations/{id}']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/rankings/generations/{id}',
    options,
  );
}
export function getAdminRankingRetryReceipt({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/rankings/generations/{id}/retry-receipt']['get']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).GET(
    '/api/v1/admin/rankings/generations/{id}/retry-receipt',
    options,
  );
}
export function retryAdminRankingGeneration({
  baseUrl = '',
  ...options
}: FetchOptions<ApiPaths['/api/v1/admin/rankings/generations/{id}/retry']['post']> & {
  baseUrl?: string;
}) {
  return createClient<ApiPaths>({ baseUrl }).POST(
    '/api/v1/admin/rankings/generations/{id}/retry',
    options,
  );
}
