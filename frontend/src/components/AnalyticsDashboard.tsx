import React from 'react';
import {
  Target,
  TrendingUp,
  Award,
  Flame,
  Trash2,
  CheckCircle,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { AnalyticsSummary } from '../types';

interface AnalyticsDashboardProps {
  summary: AnalyticsSummary;
  onDeleteShot: (shotId: number) => Promise<void>;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  summary,
  onDeleteShot,
}) => {
  const { biomechanics, insights, recent_shots } = summary;

  const metricRows = [
    {
      label: 'Set-Point Elbow Angle',
      ideal: '90° (85°–95°)',
      makeVal: biomechanics.makes.elbow_angle,
      missVal: biomechanics.misses.elbow_angle,
      unit: '°',
    },
    {
      label: 'Release Elevation Arc',
      ideal: '55° (50°–60°)',
      makeVal: biomechanics.makes.release_angle,
      missVal: biomechanics.misses.release_angle,
      unit: '°',
    },
    {
      label: 'Knee Bend Load Angle',
      ideal: '118° (110°–125°)',
      makeVal: biomechanics.makes.knee_angle,
      missVal: biomechanics.misses.knee_angle,
      unit: '°',
    },
    {
      label: 'Follow-Through Hold',
      ideal: '≥ 600 ms',
      makeVal: biomechanics.makes.follow_through_ms,
      missVal: biomechanics.misses.follow_through_ms,
      unit: ' ms',
    },
    {
      label: 'AI Biomechanical Score',
      ideal: '85+ / 100',
      makeVal: biomechanics.makes.form_score,
      missVal: biomechanics.misses.form_score,
      unit: ' pts',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>FIELD GOAL %</span>
            <Target className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{summary.fg_pct}%</div>
          <div className="text-xs text-slate-400 mt-1">
            {summary.makes} Makes • {summary.misses} Misses
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>TOTAL SHOTS TRACKED</span>
            <Flame className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{summary.total_shots}</div>
          <div className="text-xs text-emerald-400 mt-1">
            Auto-tracked + verified
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>AVG FORM SCORE</span>
            <Award className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {biomechanics.overall.form_score ?? '--'}
            <span className="text-sm font-normal text-slate-400"> / 100</span>
          </div>
          <div className="text-xs text-sky-400 mt-1">
            Makes avg: {biomechanics.makes.form_score ?? '--'}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>AVG RELEASE ARC</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {biomechanics.overall.release_angle ?? '--'}°
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Elbow Set: {biomechanics.overall.elbow_angle ?? '--'}°
          </div>
        </div>
      </div>

      {/* Python AI Coaching Insights */}
      <div className="bg-gradient-to-r from-orange-500/15 via-slate-900 to-slate-900 border border-orange-500/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-orange-400 font-bold text-xs uppercase tracking-wider mb-2">
          <Sparkles className="w-4 h-4" /> Python FastAPI Biomechanical Coaching Insights
        </div>
        <ul className="space-y-1.5">
          {insights.map((item, idx) => (
            <li key={idx} className="text-sm text-slate-200 flex items-start gap-2">
              <span className="text-orange-400 font-bold">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Make vs Miss Biomechanics Breakdown */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Makes vs. Misses Form Comparison
          </h3>
          <p className="text-xs text-slate-400">
            See exactly how your body mechanics differ when you make vs. miss shots
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
                <th className="py-2.5 pr-4">Biomechanical Metric</th>
                <th className="py-2.5 px-3">Pro Ideal</th>
                <th className="py-2.5 px-3 text-emerald-400">Your Makes Avg</th>
                <th className="py-2.5 px-3 text-rose-400">Your Misses Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {metricRows.map((row) => (
                <tr key={row.label} className="hover:bg-slate-800/40">
                  <td className="py-2.5 pr-4 font-medium text-slate-200">{row.label}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-400">{row.ideal}</td>
                  <td className="py-2.5 px-3 font-bold text-emerald-400">
                    {row.makeVal !== null ? `${row.makeVal}${row.unit}` : '--'}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-rose-400">
                    {row.missVal !== null ? `${row.missVal}${row.unit}` : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Shot Log */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
          Recent Shot Telemetry Log
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {[...recent_shots].reverse().map((shot) => (
            <div
              key={shot.id}
              className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2.5">
                {shot.made === 1 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-bold">
                    <CheckCircle className="w-3.5 h-3.5" /> MAKE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-400 font-bold">
                    <XCircle className="w-3.5 h-3.5" /> MISS
                  </span>
                )}
                <span className="font-semibold text-slate-200">{shot.court_zone}</span>
              </div>

              <div className="flex items-center gap-3 text-slate-400">
                <span>
                  Elbow: <strong className="text-slate-200">{shot.elbow_angle ?? '--'}°</strong>
                </span>
                <span>
                  Arc: <strong className="text-slate-200">{shot.release_angle ?? '--'}°</strong>
                </span>
                <span>
                  Knee: <strong className="text-slate-200">{shot.knee_angle ?? '--'}°</strong>
                </span>
                <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 font-semibold">
                  Form {shot.form_score ?? '--'}
                </span>
                <button
                  onClick={() => onDeleteShot(shot.id)}
                  title="Delete shot"
                  className="text-slate-500 hover:text-rose-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

