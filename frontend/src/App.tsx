import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  PlusCircle,
  Video,
  CheckCircle2,
  Server,
} from 'lucide-react';
import { AnalyticsSummary, SessionData } from './types';
import { LiveCameraTracker, CapturedBiomechanics } from './components/LiveCameraTracker';
import { CourtMap } from './components/CourtMap';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';

const EMPTY_SUMMARY: AnalyticsSummary = {
  total_shots: 0,
  makes: 0,
  misses: 0,
  fg_pct: 0,
  biomechanics: {
    makes: {
      elbow_angle: null,
      release_angle: null,
      knee_angle: null,
      follow_through_ms: null,
      form_score: null,
    },
    misses: {
      elbow_angle: null,
      release_angle: null,
      knee_angle: null,
      follow_through_ms: null,
      form_score: null,
    },
    overall: {
      elbow_angle: null,
      release_angle: null,
      knee_angle: null,
      follow_through_ms: null,
      form_score: null,
    },
  },
  zones: [],
  insights: ['Start shooting in front of the live AI camera to generate form insights.'],
  recent_shots: [],
};

export function App() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [selectedZone, setSelectedZone] = useState<string>('Top of Key 3');
  const [shootingHand, setShootingHand] = useState<'Right' | 'Left'>('Right');
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [newSessionTitle, setNewSessionTitle] = useState<string>('');
  const [showNewSessionModal, setShowNewSessionModal] = useState<boolean>(false);

  const fetchAllData = useCallback(async (sessionId?: number | null) => {
    try {
      const sessRes = await fetch('/api/sessions');
      if (!sessRes.ok) throw new Error('Backend unreachable');
      const sessData: SessionData[] = await sessRes.json();
      setSessions(sessData);
      setBackendConnected(true);

      const targetId =
        sessionId !== undefined
          ? sessionId
          : activeSessionId ?? (sessData.length > 0 ? sessData[0].id : null);

      if (activeSessionId === null && targetId !== null) {
        setActiveSessionId(targetId);
      }

      const sumUrl = targetId
        ? `/api/analytics/summary?session_id=${targetId}`
        : '/api/analytics/summary';
      const sumRes = await fetch(sumUrl);
      if (sumRes.ok) {
        const sumData: AnalyticsSummary = await sumRes.json();
        setSummary(sumData);
      }
    } catch (err) {
      console.error('Error connecting to FastAPI backend:', err);
      setBackendConnected(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleSelectSession = async (id: number | null) => {
    setActiveSessionId(id);
    await fetchAllData(id);
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const title =
      newSessionTitle.trim() ||
      `Court Workout — ${new Date().toLocaleDateString()}`;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          court_zone_default: selectedZone,
          shooting_hand: shootingHand,
          notes: '',
        }),
      });
      if (res.ok) {
        const created: SessionData = await res.json();
        setNewSessionTitle('');
        setShowNewSessionModal(false);
        setActiveSessionId(created.id);
        await fetchAllData(created.id);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleLogShot = async (made: boolean, bio: CapturedBiomechanics) => {
    let targetSessionId = activeSessionId;
    if (!targetSessionId && sessions.length > 0) {
      targetSessionId = sessions[0].id;
    }
    if (!targetSessionId) return;

    try {
      await fetch(`/api/sessions/${targetSessionId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          made,
          court_zone: selectedZone,
          elbow_angle: bio.elbow_angle,
          release_angle: bio.release_angle,
          knee_angle: bio.knee_angle,
          follow_through_ms: bio.follow_through_ms,
        }),
      });
      await fetchAllData(targetSessionId);
    } catch (err) {
      console.error('Failed to log shot:', err);
    }
  };

  const handleDeleteShot = async (shotId: number) => {
    try {
      await fetch(`/api/shots/${shotId}`, { method: 'DELETE' });
      await fetchAllData(activeSessionId);
    } catch (err) {
      console.error('Failed to delete shot:', err);
    }
  };

  const handleResetAll = async () => {
    try {
      await fetch('/api/reset', { method: 'POST' });
      setActiveSessionId(null);
      await fetchAllData(null);
    } catch (err) {
      console.error('Failed to reset data:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-white">
                  HoopsVision <span className="text-orange-500">AI</span>
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 font-semibold">
                  Hybrid MediaPipe + FastAPI
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Real-Time 60FPS Pose Biomechanics, Auto Shot Counter & Game Analytics
              </p>
            </div>
          </div>

          {/* Session Switcher & Backend Status */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Python API:</span>
              <span
                className={`font-semibold ${
                  backendConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {backendConnected ? 'Connected' : 'Connecting...'}
              </span>
            </div>

            <select
              value={activeSessionId ?? 'all'}
              onChange={(e) =>
                handleSelectSession(
                  e.target.value === 'all' ? null : Number(e.target.value)
                )
              }
              className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-orange-500"
            >
              <option value="all">📊 All Sessions Combined</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  🏀 {s.title} ({s.makes}/{s.total_shots} • {s.fg_pct}%)
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowNewSessionModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold transition shadow-sm shadow-orange-500/20"
            >
              <PlusCircle className="w-3.5 h-3.5" /> New Session
            </button>

            <button
              onClick={handleResetAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/80 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition"
              title="Reset all shots and sessions to 0"
            >
              Reset Data
            </button>
          </div>
        </div>
      </header>

      {/* New Session Modal */}
      {showNewSessionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSession}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md space-y-4 shadow-2xl"
          >
            <h2 className="text-base font-bold text-white">Start New Shooting Session</h2>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Session Name
              </label>
              <input
                type="text"
                placeholder="e.g., Evening 3PT Catch & Shoot"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-orange-500"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewSessionModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-xs font-bold hover:bg-orange-400 flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Create Session
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Content Split View: Left = Live Vision + Court Map, Right = Python Analytics */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left Column: Live Camera Vision + Court Selector (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-400">
            <Video className="w-4 h-4" /> Live AI Camera & Pose Skeleton Feed
          </div>

          <LiveCameraTracker
            shootingHand={shootingHand}
            onChangeHand={setShootingHand}
            selectedZone={selectedZone}
            onLogShot={handleLogShot}
            sessionStats={{
              total: summary.total_shots,
              makes: summary.makes,
              misses: summary.misses,
              fg_pct: summary.fg_pct,
            }}
          />

          <CourtMap
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            zoneStats={summary.zones}
          />
        </div>

        {/* Right Column: Analytics Dashboard & Make/Miss Biomechanics (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-400">
            <BarChart3 className="w-4 h-4" /> Shooting Analytics & Form Telemetry
          </div>

          <AnalyticsDashboard
            summary={summary}
            onDeleteShot={handleDeleteShot}
          />
        </div>
      </main>
    </div>
  );
}
export default App;

