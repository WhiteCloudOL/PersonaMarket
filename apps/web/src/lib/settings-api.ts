import {
  getMailSettings,
  updateMailSettings,
  sendMailSettingsTest,
} from '@personamarket/api-client';
import {
  MailSettingsResponseSchema,
  MailTestResponseSchema,
  type UpdateMailSettings,
} from '@personamarket/contracts';
import { authenticatedWrite, checkedResponse, sessionRequestOptions } from './auth-api';
const options = () => ({ ...sessionRequestOptions, signal: AbortSignal.timeout(10000) });
export const settingsApi = {
  mail: async () => checkedResponse(await getMailSettings(options()), MailSettingsResponseSchema),
  updateMail: (body: UpdateMailSettings, revision: number) =>
    authenticatedWrite(
      (header) =>
        updateMailSettings({
          ...options(),
          body,
          params: { header: { ...header, 'If-Match': '"mail-' + revision + '"' } },
        }),
      MailSettingsResponseSchema,
    ),
  testMail: () =>
    authenticatedWrite(
      (header) => sendMailSettingsTest({ ...options(), body: {}, params: { header } }),
      MailTestResponseSchema,
    ),
};
