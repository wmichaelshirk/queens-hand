import { SCORING_SYSTEMS, type ScoringSystemName } from '../../../engines/strohmandeln';

export type SelectOption = { value: string; label: string };

export type GameOptionSpec = {
  type: 'select';
  key: string;
  label: string;
  default: string;
  choices: SelectOption[];
};

export const GAME_OPTIONS: Record<string, GameOptionSpec[]> = {
  slobberhannes: [],
  strohmandeln: [
    {
      type: 'select',
      key: 'scoring',
      label: 'Scoring system',
      default: 'Beck',
      choices: (Object.keys(SCORING_SYSTEMS) as ScoringSystemName[]).map((k) => ({
        value: k,
        label: SCORING_SYSTEMS[k].name,
      })),
    },
  ],
};
