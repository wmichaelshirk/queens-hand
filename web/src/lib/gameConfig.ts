import { SCORING_SYSTEMS, GAME_NAME as STROHMANDELN_NAME, GAME_ICON as STROHMANDELN_ICON, type ScoringSystemName } from '../../../engines/strohmandeln';
import { GAME_NAME as SLOBBERHANNES_NAME, GAME_ICON as SLOBBERHANNES_ICON } from '../../../engines/slobberhannes';

export const GAME_REGISTRY: Record<string, { name: string; icon: string }> = {
  slobberhannes: { name: SLOBBERHANNES_NAME, icon: SLOBBERHANNES_ICON },
  strohmandeln:  { name: STROHMANDELN_NAME,  icon: STROHMANDELN_ICON  },
};

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
      default: 'Mayr',
      choices: (Object.keys(SCORING_SYSTEMS) as ScoringSystemName[]).map((k) => ({
        value: k,
        label: SCORING_SYSTEMS[k].name,
      })),
    },
  ],
};
