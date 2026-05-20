import { SCORING_SYSTEMS, GAME_NAME as STROHMANDELN_NAME, GAME_ICON as STROHMANDELN_ICON, type ScoringSystemName } from '../../../engines/strohmandeln';
import { GAME_NAME as SLOBBERHANNES_NAME, GAME_ICON as SLOBBERHANNES_ICON } from '../../../engines/slobberhannes';
import { SCORING_SYSTEMS as DREIT_SCORING_SYSTEMS, GAME_NAME as DREIT_NAME, GAME_ICON as DREIT_ICON, type ScoringSystemName as DreitScoringSystemName } from '../../../engines/dreiertarock';

export const GAME_REGISTRY: Record<string, { name: string; icon: string }> = {
  slobberhannes: { name: SLOBBERHANNES_NAME, icon: SLOBBERHANNES_ICON },
  strohmandeln:  { name: STROHMANDELN_NAME,  icon: STROHMANDELN_ICON  },
  dreiertarock:  { name: DREIT_NAME,         icon: DREIT_ICON         },
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
  dreiertarock: [
    {
      type: 'select',
      key: 'scoring',
      label: 'Scoring system',
      default: 'Mayr',
      choices: (Object.keys(DREIT_SCORING_SYSTEMS) as DreitScoringSystemName[]).map((k) => ({
        value: k,
        label: DREIT_SCORING_SYSTEMS[k].name,
      })),
    },
    {
      type: 'select',
      key: 'deckType',
      label: 'Deck',
      default: '54',
      choices: [
        { value: '54', label: '54-card (standard)' },
        { value: '42', label: '42-card' },
      ],
    },
  ],
};
