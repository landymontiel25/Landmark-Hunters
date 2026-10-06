// The Firestore documents the dashboard reads, as written by the main app's
// nightly job (api/_lib/dashboardDocs.js, api/_lib/maprNightly.js).
// Numbers in 0-1 are shares; null means "not measurable yet".

export interface MaprMetric {
  id: string;
  date: string;
  match_rate: number | null;
  skip_rate: number | null;
  repeat_rate: number | null;
  novelty_percentage: number | null;
  stagnation_users: number;
  ncf_model_health: number | null;
  a_b_control_rate: number | null;
  a_b_treatment_rate: number | null;
  a_b_control_n: number;
  a_b_treatment_n: number;
  a_b_p_value: number | null;
  a_b_days: number;
  avgRating?: number | null;
  totals?: { shown: number; users: number; sets: number };
  latency?: { p50Ms: number | null; p99Ms: number | null };
  alerts?: string[];
  distance?: { within1_5km: number | null; within3km: number | null; p50: number | null };
  experiments?: Record<string, { started: string | null; days: number; decision: string; arms: Record<string, { shown: number; clicked: number; ctr: number | null; users: number }>; ctr: { lift: number | null; pValue: number | null; ci: [number, number] | null; significant: boolean } }>;
}

export interface GrowthMetric {
  id: string;
  date: string;
  active_users: number;
  new_users: number;
  landmarks_visited: number;
  total_landmarks_visited_cumulative: number;
  repeat_landmark_visits: number;
}

export interface EngagementMetric {
  id: string;
  date: string;
  avg_dwell_time_s: number | null;
  tap_to_visit_rate: number | null;
  skip_rate: number | null;
  rating_distribution: Record<string, number>;
  avg_rating: number | null;
  ratings: number;
}

export interface RetentionCohort {
  id: string;
  cohort_date: string;
  day_0: number;
  day_7: number | null;
  day_30: number | null;
  day_90: number | null;
  retention_7_day: number | null;
  retention_30_day: number | null;
  churn_rate: number | null;
}

export interface AccuracyRow {
  match_rate: number | null;
  skip_rate: number | null;
  repeat_rate: number | null;
  sample_size: number;
}
export interface AccuracyDoc {
  id: string;
  date: string;
  window_days: number;
  categories?: Record<string, AccuracyRow>;
  cities?: Record<string, AccuracyRow>;
}

export interface TasteScore {
  id: string;
  date: string;
  avg_taste_score: number | null;
  users_with_taste_score: number;
}

export type MissStatus = 'pending' | 'resolved' | 'duplicate';
export interface BigMiss {
  id: string;
  landmark_id: string;
  landmark_name: string;
  region: string | null;
  expected_rating: number | null;
  actual_rating: number | null;
  skip_count: number;
  hate_count: number;
  reported_at?: { toMillis?: () => number } | null;
  reviewed?: boolean;
  status?: MissStatus;
  resolution?: string;
}

export interface MaprNCFModel {
  last_trained: number | null;
  last_run: number | null;
  last_action: string | null;
  last_inference_latency_ms: number | null;
  training_loss: number | null;
  validation_accuracy: number | null;
  test_accuracy: number | null;
  model_version: string | null;
  active: boolean;
  active_users: number | null;
  active_threshold: number | null;
}

export interface MaprSimilarity {
  last_computed: number | null;
  compute_ms: number | null;
  model_size_bytes: number;
  regions: number;
  top_landmark: { region: string; id: string; neighbors: number } | null;
}

export interface AppMetricCard {
  id: string;
  label: string;
  value: string | number | null;
  unit?: string;
  status: 'met' | 'missed' | 'unknown' | 'info';
  goal?: string;
  note?: string;
  n?: number;
}
export interface AppMetrics {
  generatedAt: number;
  date: string;
  metrics: AppMetricCard[];
  truncated: string[];
  study?: { series?: { date: string; mapr: number | null; baseline: number | null; users: number }[] };
}
