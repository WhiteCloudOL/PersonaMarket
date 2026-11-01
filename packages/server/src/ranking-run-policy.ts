import { RankingRefreshJobSchema, type AdminRankingGeneration } from '@personamarket/contracts';

type Event = { id: string; topic: string; payload: unknown };
export function rankingEventMatches(
  generationId: string,
  eventId: string,
  event: Event | null | undefined,
) {
  if (!event || event.id !== eventId || event.topic !== 'rankings.refresh') return false;
  const parsed = RankingRefreshJobSchema.omit({ eventId: true }).safeParse(event.payload);
  return parsed.success && parsed.data.generationId.toLowerCase() === generationId;
}
export type RankingRetryFacts = {
  completed: boolean;
  definitionVerified: boolean;
  eventVerified: boolean;
  leaseActive: boolean;
  boards: number;
  currentEventProcessed: boolean;
  terminalVerified: boolean;
  automaticPending: boolean;
  legacyUnverifiable: boolean;
  manualRound: number;
  nextAllowedAt: string | null;
};
export function rankingRetryEligibility(
  facts: RankingRetryFacts,
  now = new Date(),
): Pick<AdminRankingGeneration['retry'], 'allowed' | 'blockedReason'> {
  const blockedReason = facts.completed
    ? 'COMPLETED'
    : !facts.definitionVerified
      ? 'DEFINITION_UNVERIFIABLE'
      : facts.boards > 0 || facts.currentEventProcessed
        ? 'RESULT_INCONSISTENT'
        : !facts.eventVerified
          ? 'CURRENT_EVENT_UNVERIFIABLE'
          : facts.leaseActive
            ? 'DISPATCH_LEASE_ACTIVE'
            : facts.legacyUnverifiable
              ? 'LEGACY_TERMINAL_UNVERIFIABLE'
              : !facts.terminalVerified
                ? facts.automaticPending
                  ? 'AUTO_RETRY_PENDING'
                  : 'CURRENT_EVENT_UNVERIFIABLE'
                : facts.manualRound >= 3
                  ? 'MANUAL_LIMIT_REACHED'
                  : facts.nextAllowedAt && Date.parse(facts.nextAllowedAt) > now.getTime()
                    ? 'COOLDOWN_ACTIVE'
                    : null;
  return { allowed: blockedReason === null, blockedReason };
}
