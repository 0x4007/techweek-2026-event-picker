export type AgendaMealWindowPreference = {
  id: string;
  label: string;
  start: string;
  end: string;
  preferredMinutes: number;
  minimumMinutes: number;
};

export type AgendaSleepPreference = {
  targetMinutes: number;
  minimumMinutes: number;
  preferredLatestBedtime: string;
  maximumNightlyVarianceMinutes: number;
  windDownAfterLastEventMinutes: number;
  minimumWindDownAfterLastEventMinutes: number;
  nextMorningPrepMinutes: number;
};

export type AgendaMorningPreference = {
  enabled: boolean;
  getReadyMinutes: number;
  breakfastMinutes: number;
};

export type AgendaPriorityClass = "sleep" | "work_events" | "travel" | "food";

export type AgendaBlockPriorityPreference = {
  id: AgendaPriorityClass;
  label: string;
  rank: number;
  hard: boolean;
};

export type AgendaSignalPreference = {
  label: string;
  pattern: string;
  score: number;
};

export type AgendaPlanningPreferences = {
  excludeUnpinnedEventsBefore: string;
  offHoursHardBefore: string;
  offHoursHardPenalty: number;
  offHoursSoftBefore: string;
  offHoursSoftPenalty: number;
  discoveredMinimumWorkFit: number;
  discoveredLowFitPenalty: number;
  blockPriorities: AgendaBlockPriorityPreference[];
  workFitPositiveSignals: AgendaSignalPreference[];
  workFitNegativeSignals: AgendaSignalPreference[];
};

export type AgendaUserPreferences = {
  version: number;
  profileId: string;
  profileLabel: string;
  firstClassBlockTypes: Array<"event" | "travel" | "eating" | "sleeping">;
  logistics: {
    meals: {
      dailyFoodRequired: boolean;
      maximumDailyShiftMinutes: number;
      windows: AgendaMealWindowPreference[];
    };
    morning: AgendaMorningPreference;
    sleep: AgendaSleepPreference;
  };
  planning: AgendaPlanningPreferences;
};

export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends Array<infer Item> ? Array<DeepPartial<Item>>
    : T[Key] extends object ? DeepPartial<T[Key]>
    : T[Key];
};

export type AgendaUserPreferencesInput = DeepPartial<AgendaUserPreferences>;

export const DEFAULT_AGENDA_USER_PREFERENCES: AgendaUserPreferences = {
  version: 1,
  profileId: "techweek-default",
  profileLabel: "Tech Week default agenda preferences",
  firstClassBlockTypes: ["event", "travel", "eating", "sleeping"],
  logistics: {
    meals: {
      dailyFoodRequired: true,
      maximumDailyShiftMinutes: 30,
      windows: [
        {
          id: "LUNCH",
          label: "Lunch / reset",
          start: "11:30",
          end: "15:00",
          preferredMinutes: 60,
          minimumMinutes: 30,
        },
        {
          id: "DINNER",
          label: "Dinner / reset",
          start: "17:00",
          end: "22:00",
          preferredMinutes: 60,
          minimumMinutes: 30,
        },
      ],
    },
    morning: {
      enabled: true,
      getReadyMinutes: 60,
      breakfastMinutes: 60,
    },
    sleep: {
      targetMinutes: 8 * 60,
      minimumMinutes: 5.5 * 60,
      preferredLatestBedtime: "03:30",
      maximumNightlyVarianceMinutes: 30,
      windDownAfterLastEventMinutes: 90,
      minimumWindDownAfterLastEventMinutes: 45,
      nextMorningPrepMinutes: 75,
    },
  },
  planning: {
    excludeUnpinnedEventsBefore: "07:00",
    offHoursHardBefore: "08:00",
    offHoursHardPenalty: -850,
    offHoursSoftBefore: "10:00",
    offHoursSoftPenalty: -120,
    discoveredMinimumWorkFit: 20,
    discoveredLowFitPenalty: -750,
    blockPriorities: [
      { id: "sleep", label: "Sleep", rank: 1, hard: true },
      { id: "work_events", label: "Work events", rank: 2, hard: false },
      { id: "travel", label: "Travel feasibility", rank: 3, hard: false },
      { id: "food", label: "Food", rank: 4, hard: false },
    ],
    workFitPositiveSignals: [
      {
        label: "Engineering leadership",
        pattern: "engineering|cto|vp engineering|head of engineering|tech leader",
        score: 22,
      },
      {
        label: "Developer platforms",
        pattern: "developer|devex|platform|infrastructure|infra",
        score: 22,
      },
      {
        label: "Open source and GitHub",
        pattern: "open[ -]?source|maintainer|github|codebase",
        score: 22,
      },
      { label: "AI agents and coding", pattern: "\\bai\\b|agent|mcp|llm|coding", score: 22 },
      {
        label: "Founder/operator fit",
        pattern: "enterprise|b2b|founder|operator|startup",
        score: 22,
      },
      {
        label: "Workflow infrastructure",
        pattern: "api|workflow|automation|data|security",
        score: 22,
      },
    ],
    workFitNegativeSignals: [
      {
        label: "Personal celebrations",
        pattern: "birthday|graduation|housewarming|wedding",
        score: -45,
      },
      {
        label: "Fitness and wellness",
        pattern: "\\byoga\\b|wellness|fitness|run club",
        score: -45,
      },
      {
        label: "Low-fit consumer categories",
        pattern: "fashion|beauty|dating|consumer social",
        score: -45,
      },
    ],
  },
};

export function mergeAgendaUserPreferences(input?: unknown): AgendaUserPreferences {
  const base = structuredClone(DEFAULT_AGENDA_USER_PREFERENCES);
  const root = recordValue(input);
  if (!root) return base;

  const logistics = recordValue(root.logistics);
  const meals = recordValue(logistics?.meals);
  const morning = recordValue(logistics?.morning);
  const sleep = recordValue(logistics?.sleep);
  const planning = recordValue(root.planning);

  return {
    version: positiveNumber(root.version, base.version),
    profileId: stringValue(root.profileId, base.profileId),
    profileLabel: stringValue(root.profileLabel, base.profileLabel),
    firstClassBlockTypes: blockTypeValues(root.firstClassBlockTypes) ?? base.firstClassBlockTypes,
    logistics: {
      meals: {
        dailyFoodRequired: booleanValue(
          meals?.dailyFoodRequired,
          base.logistics.meals.dailyFoodRequired,
        ),
        maximumDailyShiftMinutes: positiveNumber(
          meals?.maximumDailyShiftMinutes,
          base.logistics.meals.maximumDailyShiftMinutes,
        ),
        windows: mealWindowValues(meals?.windows, base.logistics.meals.windows),
      },
      morning: {
        enabled: booleanValue(morning?.enabled, base.logistics.morning.enabled),
        getReadyMinutes: positiveNumber(
          morning?.getReadyMinutes,
          base.logistics.morning.getReadyMinutes,
        ),
        breakfastMinutes: positiveNumber(
          morning?.breakfastMinutes,
          base.logistics.morning.breakfastMinutes,
        ),
      },
      sleep: {
        targetMinutes: positiveNumber(sleep?.targetMinutes, base.logistics.sleep.targetMinutes),
        minimumMinutes: positiveNumber(sleep?.minimumMinutes, base.logistics.sleep.minimumMinutes),
        preferredLatestBedtime: timeValue(
          sleep?.preferredLatestBedtime,
          base.logistics.sleep.preferredLatestBedtime,
        ),
        maximumNightlyVarianceMinutes: positiveNumber(
          sleep?.maximumNightlyVarianceMinutes,
          base.logistics.sleep.maximumNightlyVarianceMinutes,
        ),
        windDownAfterLastEventMinutes: positiveNumber(
          sleep?.windDownAfterLastEventMinutes,
          base.logistics.sleep.windDownAfterLastEventMinutes,
        ),
        minimumWindDownAfterLastEventMinutes: positiveNumber(
          sleep?.minimumWindDownAfterLastEventMinutes,
          base.logistics.sleep.minimumWindDownAfterLastEventMinutes,
        ),
        nextMorningPrepMinutes: positiveNumber(
          sleep?.nextMorningPrepMinutes,
          base.logistics.sleep.nextMorningPrepMinutes,
        ),
      },
    },
    planning: {
      excludeUnpinnedEventsBefore: timeValue(
        planning?.excludeUnpinnedEventsBefore,
        base.planning.excludeUnpinnedEventsBefore,
      ),
      offHoursHardBefore: timeValue(planning?.offHoursHardBefore, base.planning.offHoursHardBefore),
      offHoursHardPenalty: numberValue(
        planning?.offHoursHardPenalty,
        base.planning.offHoursHardPenalty,
      ),
      offHoursSoftBefore: timeValue(planning?.offHoursSoftBefore, base.planning.offHoursSoftBefore),
      offHoursSoftPenalty: numberValue(
        planning?.offHoursSoftPenalty,
        base.planning.offHoursSoftPenalty,
      ),
      discoveredMinimumWorkFit: numberValue(
        planning?.discoveredMinimumWorkFit,
        base.planning.discoveredMinimumWorkFit,
      ),
      discoveredLowFitPenalty: numberValue(
        planning?.discoveredLowFitPenalty,
        base.planning.discoveredLowFitPenalty,
      ),
      blockPriorities: priorityValues(
        planning?.blockPriorities,
        base.planning.blockPriorities,
      ),
      workFitPositiveSignals: signalValues(
        planning?.workFitPositiveSignals,
        base.planning.workFitPositiveSignals,
      ),
      workFitNegativeSignals: signalValues(
        planning?.workFitNegativeSignals,
        base.planning.workFitNegativeSignals,
      ),
    },
  };
}

function mealWindowValues(
  value: unknown,
  fallback: AgendaMealWindowPreference[],
): AgendaMealWindowPreference[] {
  const items = arrayValue(value);
  if (!items) return fallback;
  const windows = items.map((item, index) => {
    const record = recordValue(item);
    const base = fallback[index] ?? fallback[fallback.length - 1];
    return {
      id: stringValue(record?.id, base.id),
      label: stringValue(record?.label, base.label),
      start: timeValue(record?.start, base.start),
      end: timeValue(record?.end, base.end),
      preferredMinutes: positiveNumber(record?.preferredMinutes, base.preferredMinutes),
      minimumMinutes: positiveNumber(record?.minimumMinutes, base.minimumMinutes),
    };
  }).filter((window) => window.id && window.label);
  return windows.length > 0 ? windows : fallback;
}

function signalValues(
  value: unknown,
  fallback: AgendaSignalPreference[],
): AgendaSignalPreference[] {
  const items = arrayValue(value);
  if (!items) return fallback;
  const signals = items.map((item, index) => {
    const record = recordValue(item);
    const base = fallback[index] ?? fallback[fallback.length - 1];
    return {
      label: stringValue(record?.label, base.label),
      pattern: stringValue(record?.pattern, base.pattern),
      score: numberValue(record?.score, base.score),
    };
  }).filter((signal) => signal.label && signal.pattern);
  return signals.length > 0 ? signals : fallback;
}

function priorityValues(
  value: unknown,
  fallback: AgendaBlockPriorityPreference[],
): AgendaBlockPriorityPreference[] {
  const items = arrayValue(value);
  if (!items) return fallback;
  const allowed = new Set<AgendaPriorityClass>(["sleep", "work_events", "travel", "food"]);
  const priorities = items.map((item, index) => {
    const record = recordValue(item);
    const base = fallback[index] ?? fallback[fallback.length - 1];
    const id = stringValue(record?.id, base.id);
    return {
      id: allowed.has(id as AgendaPriorityClass) ? id as AgendaPriorityClass : base.id,
      label: stringValue(record?.label, base.label),
      rank: positiveNumber(record?.rank, base.rank),
      hard: booleanValue(record?.hard, base.hard),
    };
  }).filter((priority) => priority.id && priority.label);
  return priorities.length > 0 ? priorities.sort((a, b) => a.rank - b.rank) : fallback;
}

function blockTypeValues(
  value: unknown,
): Array<"event" | "travel" | "eating" | "sleeping"> | null {
  const items = arrayValue(value);
  if (!items) return null;
  const allowed = new Set(["event", "travel", "eating", "sleeping"]);
  const values = items.map(String).filter((item) => allowed.has(item)) as Array<
    "event" | "travel" | "eating" | "sleeping"
  >;
  return values.length > 0 ? [...new Set(values)] : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function timeValue(value: unknown, fallback: string): string {
  const text = stringValue(value, fallback);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = numberValue(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
