import React from 'react';
import { COURT_ZONES, ZoneStat } from '../types';

interface CourtMapProps {
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  zoneStats: ZoneStat[];
}

export const CourtMap: React.FC<CourtMapProps> = ({
  selectedZone,
  onSelectZone,
  zoneStats,
}) => {
  const getZoneStat = (zoneName: string) =>
    zoneStats.find((z) => z.zone === zoneName);

  const getHeatColor = (zoneName: string) => {
    const stat = getZoneStat(zoneName);
    const isSelected = selectedZone === zoneName;
    if (!stat || stat.attempts === 0) {
      return isSelected ? 'rgba(249, 115, 22, 0.45)' : 'rgba(30, 41, 59, 0.75)';
    }
    if (stat.fg_pct >= 60) {
      return isSelected ? 'rgba(16, 185, 129, 0.65)' : 'rgba(16, 185, 129, 0.35)';
    }
    if (stat.fg_pct >= 40) {
      return isSelected ? 'rgba(245, 158, 11, 0.65)' : 'rgba(245, 158, 11, 0.35)';
    }
    return isSelected ? 'rgba(239, 68, 68, 0.65)' : 'rgba(239, 68, 68, 0.35)';
  };

  const hotspots: { zone: string; x: number; y: number; short: string }[] = [
    { zone: 'Corner 3 L', x: 38, y: 78, short: 'C3-L' },
    { zone: 'Corner 3 R', x: 362, y: 78, short: 'C3-R' },
    { zone: 'Wing 3 L', x: 75, y: 215, short: 'W3-L' },
    { zone: 'Wing 3 R', x: 325, y: 215, short: 'W3-R' },
    { zone: 'Top of Key 3', x: 200, y: 265, short: 'TOP 3' },
    { zone: 'Mid-Range L', x: 105, y: 120, short: 'MID-L' },
    { zone: 'Mid-Range R', x: 295, y: 120, short: 'MID-R' },
    { zone: 'Mid-Range C', x: 200, y: 195, short: 'MID-C' },
    { zone: 'Free Throw', x: 200, y: 142, short: 'FT' },
    { zone: 'Paint', x: 200, y: 78, short: 'PAINT' },
  ];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Interactive Court Zone Map
          </h3>
          <p className="text-xs text-slate-400">
            Click a zone to set active shooting spot • Active:{' '}
            <span className="text-orange-400 font-semibold">{selectedZone}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500/70" /> ≥60%
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500/70 ml-1" /> 40-59%
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500/70 ml-1" /> &lt;40%
        </div>
      </div>

      <div className="relative w-full max-w-[420px] mx-auto">
        <svg
          viewBox="0 0 400 310"
          className="w-full h-auto rounded-xl border border-slate-800 bg-slate-950 shadow-inner"
        >
          {/* Outer Court Lines */}
          <rect
            x="10"
            y="10"
            width="380"
            height="290"
            fill="none"
            stroke="#334155"
            strokeWidth="2"
          />
          {/* Paint / Key */}
          <rect
            x="140"
            y="10"
            width="120"
            height="140"
            fill="rgba(15, 23, 42, 0.6)"
            stroke="#475569"
            strokeWidth="2"
          />
          {/* Free Throw Circle */}
          <circle
            cx="200"
            cy="150"
            r="45"
            fill="none"
            stroke="#475569"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          {/* Restricted Area + Hoop */}
          <path
            d="M 175 35 A 25 25 0 0 0 225 35"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
          />
          <line x1="180" y1="28" x2="220" y2="28" stroke="#94a3b8" strokeWidth="3" />
          <circle cx="200" cy="36" r="7" fill="none" stroke="#f97316" strokeWidth="2.5" />

          {/* 3-Point Line */}
          <line x1="40" y1="10" x2="40" y2="105" stroke="#475569" strokeWidth="2" />
          <line x1="360" y1="10" x2="360" y2="105" stroke="#475569" strokeWidth="2" />
          <path
            d="M 40 105 A 170 170 0 0 0 360 105"
            fill="none"
            stroke="#475569"
            strokeWidth="2"
          />

          {/* Interactive Zone Nodes */}
          {hotspots.map((spot) => {
            const stat = getZoneStat(spot.zone);
            const active = selectedZone === spot.zone;
            return (
              <g
                key={spot.zone}
                onClick={() => onSelectZone(spot.zone)}
                className="cursor-pointer transition-transform"
              >
                <circle
                  cx={spot.x}
                  cy={spot.y}
                  r={active ? 27 : 24}
                  fill={getHeatColor(spot.zone)}
                  stroke={active ? '#f97316' : '#64748b'}
                  strokeWidth={active ? 2.5 : 1.5}
                />
                <text
                  x={spot.x}
                  y={spot.y - 4}
                  textAnchor="middle"
                  className="fill-white font-bold text-[9px] select-none pointer-events-none"
                >
                  {spot.short}
                </text>
                <text
                  x={spot.x}
                  y={spot.y + 8}
                  textAnchor="middle"
                  className="fill-slate-200 text-[8.5px] font-medium select-none pointer-events-none"
                >
                  {stat && stat.attempts > 0
                    ? `${stat.makes}/${stat.attempts} (${Math.round(stat.fg_pct)}%)`
                    : '0/0'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Quick Pill Bar */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {COURT_ZONES.map((z) => (
          <button
            key={z}
            onClick={() => onSelectZone(z)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              selectedZone === z
                ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {z}
          </button>
        ))}
      </div>
    </div>
  );
};

