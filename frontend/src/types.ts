export interface ShotRecord {
  id: number;
  session_id: number;
  made: number;
  court_zone: string;
  elbow_angle: number | null;
  release_angle: number | null;
  knee_angle: number | null;
  follow_through_ms: number | null;
  form_score: number | null;
  created_at: string;
}

export interface SessionData {
  id: number;
  title: string;
  court_zone_default: string;
  shooting_hand: 'Right' | 'Left';
  created_at: string;
  notes: string;
  total_shots: number;
  makes: number;
  misses: number;
  fg_pct: number;
  avg_form_score: number;
  shots: ShotRecord[];
}

export interface BiomechanicsGroup {
  elbow_angle: number | null;
  release_angle: number | null;
  knee_angle: number | null;
  follow_through_ms: number | null;
  form_score: number | null;
}

export interface ZoneStat {
  zone: string;
  attempts: number;
  makes: number;
  fg_pct: number;
  avg_form: number;
}

export interface AnalyticsSummary {
  total_shots: number;
  makes: number;
  misses: number;
  fg_pct: number;
  biomechanics: {
    makes: BiomechanicsGroup;
    misses: BiomechanicsGroup;
    overall: BiomechanicsGroup;
  };
  zones: ZoneStat[];
  insights: string[];
  recent_shots: ShotRecord[];
}

export const COURT_ZONES = [
  'Corner 3 L',
  'Wing 3 L',
  'Top of Key 3',
  'Wing 3 R',
  'Corner 3 R',
  'Mid-Range L',
  'Mid-Range C',
  'Mid-Range R',
  'Free Throw',
  'Paint',
] as const;

export type CourtZone = (typeof COURT_ZONES)[number];

