import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  Mic,
  MicOff,
  Play,
  Upload,
  Activity,
  Sparkles,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { FilesetResolver, PoseLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface CapturedBiomechanics {
  elbow_angle: number;
  release_angle: number;
  knee_angle: number;
  follow_through_ms: number;
}

interface LiveCameraTrackerProps {
  shootingHand: 'Right' | 'Left';
  onChangeHand: (hand: 'Right' | 'Left') => void;
  selectedZone: string;
  onLogShot: (made: boolean, bio: CapturedBiomechanics) => Promise<void>;
  sessionStats: {
    total: number;
    makes: number;
    misses: number;
    fg_pct: number;
  };
}

type ShotPhase = 'READY' | 'LOADING' | 'RELEASED';
type FeedMode = 'idle' | 'camera' | 'simulator' | 'video';

function calcAngle2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) angle = 360.0 - angle;
  return Math.round(angle * 10) / 10;
}

export const LiveCameraTracker: React.FC<LiveCameraTrackerProps> = ({
  shootingHand,
  onChangeHand,
  selectedZone,
  onLogShot,
  sessionStats,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [feedMode, setFeedMode] = useState<FeedMode>('idle');
  const [cameraActive, setCameraActive] = useState(false);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [voiceActive, setVoiceActive] = useState(false);
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true);

  // Live instantaneous metrics (null until camera or simulator detects pose)
  const [liveAngles, setLiveAngles] = useState<{
    elbow: number | null;
    release: number | null;
    knee: number | null;
  }>({
    elbow: null,
    release: null,
    knee: null,
  });
  const [shotPhase, setShotPhase] = useState<ShotPhase>('READY');

  // Pending detected shot awaiting Make/Miss (or logged immediately)
  const [lastCapturedBio, setLastCapturedBio] = useState<CapturedBiomechanics>({
    elbow_angle: 90.0,
    release_angle: 55.0,
    knee_angle: 118.0,
    follow_through_ms: 600,
  });
  const [pendingShotAlert, setPendingShotAlert] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Internal state refs for 60fps loop
  const phaseRef = useRef<ShotPhase>('READY');
  const loadMetricsRef = useRef({ minElbow: 90, minKnee: 120, releaseStartTs: 0, maxReleaseAngle: 52 });
  const lastShotTsRef = useRef<number>(0);
  const simStartRef = useRef<number>(performance.now());

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 2800);
  }, []);

  // Initialize MediaPipe PoseLandmarker in browser
  useEffect(() => {
    let cancelled = false;
    async function initMediaPipe() {
      try {
        setModelStatus('loading');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (!cancelled) {
          landmarkerRef.current = poseLandmarker;
          setModelStatus('ready');
        }
      } catch (err) {
        console.error('MediaPipe load fallback:', err);
        if (!cancelled) setModelStatus('error');
      }
    }
    initMediaPipe();
    return () => {
      cancelled = true;
    };
  }, []);

  // Trigger Make or Miss log
  const handleRecordOutcome = useCallback(
    async (made: boolean, customBio?: CapturedBiomechanics) => {
      const bio = customBio || lastCapturedBio;
      setPendingShotAlert(false);
      await onLogShot(made, bio);
      showToast(
        `${made ? '✅ SWISH / MAKE' : '❌ MISS'} logged at ${selectedZone} (Elbow ${bio.elbow_angle}°, Arc ${bio.release_angle}°)`
      );
    },
    [lastCapturedBio, onLogShot, selectedZone, showToast]
  );

  // Keyboard shortcuts (M = Make, X = Miss, Space = Trigger Simulated Shot)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        handleRecordOutcome(true);
      } else if (e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleRecordOutcome(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRecordOutcome]);

  // Hands-free Web Speech API Voice Recognition ("make", "swish", "miss", "brick")
  useEffect(() => {
    if (!voiceActive) return;
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showToast('Voice recognition is not supported in this browser.');
      setVoiceActive(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRecognition as any)();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript
        .trim()
        .toLowerCase();
      if (
        transcript.includes('make') ||
        transcript.includes('made') ||
        transcript.includes('swish') ||
        transcript.includes('good')
      ) {
        handleRecordOutcome(true);
      } else if (
        transcript.includes('miss') ||
        transcript.includes('brick') ||
        transcript.includes('short') ||
        transcript.includes('off')
      ) {
        handleRecordOutcome(false);
      }
    };

    recognition.start();
    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore stop errors
      }
    };
  }, [voiceActive, handleRecordOutcome, showToast]);

  // Process landmarks from either live webcam or simulator
  const evaluatePoseBiomechanics = useCallback(
    (
      shoulder: { x: number; y: number },
      elbow: { x: number; y: number },
      wrist: { x: number; y: number },
      hip: { x: number; y: number },
      knee: { x: number; y: number },
      ankle: { x: number; y: number },
      nowMs: number
    ) => {
      const elbowAngle = calcAngle2D(shoulder, elbow, wrist);
      const kneeAngle = calcAngle2D(hip, knee, ankle);
      // Release elevation angle relative to horizontal shoulder plane
      const dy = shoulder.y - wrist.y; // positive when wrist is higher than shoulder
      const dx = Math.abs(wrist.x - shoulder.x) + 0.001;
      const rawElevation = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
      const releaseAngle = Math.max(15, Math.min(82, Math.round((rawElevation * 0.75 + 22) * 10) / 10));

      setLiveAngles({
        elbow: elbowAngle,
        release: releaseAngle,
        knee: kneeAngle,
      });

      if (!autoDetectEnabled) return;

      // State Machine for Automatic Shot Attempt Detection
      // 1. LOADING: Elbow bends (<115°) and wrist near/above chest level
      if (phaseRef.current === 'READY') {
        if (elbowAngle >= 65 && elbowAngle <= 112 && wrist.y < hip.y) {
          phaseRef.current = 'LOADING';
          setShotPhase('LOADING');
          loadMetricsRef.current = {
            minElbow: elbowAngle,
            minKnee: kneeAngle,
            releaseStartTs: nowMs,
            maxReleaseAngle: releaseAngle,
          };
        }
      } else if (phaseRef.current === 'LOADING') {
        // Track deepest dip/set point angles
        if (elbowAngle >= 68 && elbowAngle < loadMetricsRef.current.minElbow) {
          loadMetricsRef.current.minElbow = elbowAngle;
        }
        if (kneeAngle >= 95 && kneeAngle < loadMetricsRef.current.minKnee) {
          loadMetricsRef.current.minKnee = kneeAngle;
        }
        if (releaseAngle > loadMetricsRef.current.maxReleaseAngle) {
          loadMetricsRef.current.maxReleaseAngle = releaseAngle;
        }

        // Transition to RELEASED when arm extends (>142°) & wrist is well above shoulder
        if (
          elbowAngle > 142 &&
          wrist.y < shoulder.y - 0.05 &&
          nowMs - lastShotTsRef.current > 1800
        ) {
          phaseRef.current = 'RELEASED';
          setShotPhase('RELEASED');
          lastShotTsRef.current = nowMs;

          const captured: CapturedBiomechanics = {
            elbow_angle: Math.round(loadMetricsRef.current.minElbow * 10) / 10,
            release_angle: Math.round(Math.max(releaseAngle, loadMetricsRef.current.maxReleaseAngle) * 10) / 10,
            knee_angle: Math.round(loadMetricsRef.current.minKnee * 10) / 10,
            follow_through_ms: Math.min(850, Math.max(380, Math.round(nowMs - loadMetricsRef.current.releaseStartTs))),
          };
          setLastCapturedBio(captured);
          setPendingShotAlert(true);
        } else if (wrist.y > hip.y) {
          // Cancelled / dribbled
          phaseRef.current = 'READY';
          setShotPhase('READY');
        }
      } else if (phaseRef.current === 'RELEASED') {
        // Return to READY once arm comes back down or after 1.3s
        if (elbowAngle < 120 || nowMs - lastShotTsRef.current > 1300) {
          phaseRef.current = 'READY';
          setShotPhase('READY');
        }
      }
    },
    [autoDetectEnabled]
  );

  // Draw full 33-landmark pose skeleton + highlighted biomechanical HUD on canvas
  const drawBiomechanicsHUD = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      joints: {
        head: { x: number; y: number };
        shoulder: { x: number; y: number };
        elbow: { x: number; y: number };
        wrist: { x: number; y: number };
        hip: { x: number; y: number };
        knee: { x: number; y: number };
        ankle: { x: number; y: number };
      },
      allLandmarks?: NormalizedLandmark[]
    ) => {
      const toPx = (pt: { x: number; y: number }) => ({
        x: pt.x * width,
        y: pt.y * height,
      });

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. If we have the full 33 MediaPipe landmarks from live camera/video, draw the ENTIRE body skeleton!
      if (allLandmarks && allLandmarks.length >= 33) {
        const FULL_BODY_CONNECTIONS: [number, number][] = [
          // Face / Head
          [0, 1], [1, 2], [2, 3], [3, 7],
          [0, 4], [4, 5], [5, 6], [6, 8],
          [9, 10],
          // Shoulders & Torso Box
          [11, 12], [11, 23], [12, 24], [23, 24],
          // Left Arm & Hand
          [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
          // Right Arm & Hand
          [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
          // Left Leg & Foot
          [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
          // Right Leg & Foot
          [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
        ];

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = 3;
        for (const [i, j] of FULL_BODY_CONNECTIONS) {
          const a = allLandmarks[i];
          const b = allLandmarks[j];
          if (a && b && (a.visibility ?? 1) > 0.35 && (b.visibility ?? 1) > 0.35) {
            ctx.beginPath();
            ctx.moveTo(a.x * width, a.y * height);
            ctx.lineTo(b.x * width, b.y * height);
            ctx.stroke();
          }
        }

        // Draw all 33 body landmark nodes
        allLandmarks.forEach((pt, idx) => {
          if ((pt.visibility ?? 1) > 0.35) {
            ctx.fillStyle = idx <= 10 ? '#94a3b8' : '#38bdf8';
            ctx.beginPath();
            ctx.arc(pt.x * width, pt.y * height, idx <= 10 ? 3 : 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      } else {
        // Simulator fallback skeleton
        const h = toPx(joints.head);
        const s = toPx(joints.shoulder);
        const hp = toPx(joints.hip);
        const k = toPx(joints.knee);
        const a = toPx(joints.ankle);

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.lineTo(k.x, k.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();

        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. Highlight Primary Biomechanical Shooting Chain (Shoulder -> Elbow -> Wrist & Hip -> Knee -> Ankle)
      const s = toPx(joints.shoulder);
      const e = toPx(joints.elbow);
      const w = toPx(joints.wrist);
      const hp = toPx(joints.hip);
      const k = toPx(joints.knee);
      const a = toPx(joints.ankle);

      // Highlighted Shooting Arm
      ctx.strokeStyle = phaseRef.current === 'RELEASED' ? '#10b981' : '#f97316';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.lineTo(w.x, w.y);
      ctx.stroke();

      // Highlighted Key Joints
      [s, e, w, hp, k, a].forEach((pt, idx) => {
        ctx.fillStyle = idx === 1 || idx === 2 ? '#f97316' : '#0ea5e9';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Floating Angle Callouts on joints
      const elbowDeg = calcAngle2D(joints.shoulder, joints.elbow, joints.wrist);
      const kneeDeg = calcAngle2D(joints.hip, joints.knee, joints.ankle);

      const drawCallout = (
        x: number,
        y: number,
        label: string,
        color: string
      ) => {
        ctx.font = 'bold 12px Inter, sans-serif';
        const metrics = ctx.measureText(label);
        const padX = 7;
        const boxW = metrics.width + padX * 2;
        const boxH = 22;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x + 12, y - 12, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(label, x + 12 + padX, y + 3);
      };

      drawCallout(e.x, e.y, `Elbow ${elbowDeg}°`, '#f97316');
      drawCallout(k.x, k.y, `Knee ${kneeDeg}°`, '#38bdf8');
      ctx.restore();
    },
    []
  );

  // Main 60FPS render loop for Camera, Uploaded Video, or AI Simulator
  useEffect(() => {
    let active = true;

    const renderLoop = (nowMs: number) => {
      if (!active) return;
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          if ((feedMode === 'camera' || feedMode === 'video') && video && video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, width, height);

            if (landmarkerRef.current) {
              try {
                const result = landmarkerRef.current.detectForVideo(video, nowMs);
                if (result.landmarks && result.landmarks.length > 0) {
                  const lm: NormalizedLandmark[] = result.landmarks[0];
                  const isRight = shootingHand === 'Right';
                  const shoulder = lm[isRight ? 12 : 11];
                  const elbow = lm[isRight ? 14 : 13];
                  const wrist = lm[isRight ? 16 : 15];
                  const hip = lm[isRight ? 24 : 23];
                  const knee = lm[isRight ? 26 : 25];
                  const ankle = lm[isRight ? 28 : 27];
                  const head = lm[0];

                  if (shoulder && elbow && wrist && hip && knee && ankle) {
                    evaluatePoseBiomechanics(
                      shoulder,
                      elbow,
                      wrist,
                      hip,
                      knee,
                      ankle,
                      nowMs
                    );
                    drawBiomechanicsHUD(
                      ctx,
                      width,
                      height,
                      {
                        head,
                        shoulder,
                        elbow,
                        wrist,
                        hip,
                        knee,
                        ankle,
                      },
                      lm
                    );
                  }
                }
              } catch {
                // ignore frame timestamp collisions
              }
            }
          } else if (feedMode === 'simulator') {
            // Draw dark court arena grid background
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, '#0f172a');
            grad.addColorStop(1, '#020617');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            // Subtle grid lines
            ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
            ctx.lineWidth = 1;
            for (let gx = 0; gx < width; gx += 40) {
              ctx.beginPath();
              ctx.moveTo(gx, 0);
              ctx.lineTo(gx, height);
              ctx.stroke();
            }
            for (let gy = 0; gy < height; gy += 40) {
              ctx.beginPath();
              ctx.moveTo(0, gy);
              ctx.lineTo(width, gy);
              ctx.stroke();
            }

            // Draw simulated hoop on right side
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(width * 0.85, height * 0.18);
            ctx.lineTo(width * 0.85, height * 0.34);
            ctx.stroke();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(width * 0.79, height * 0.28);
            ctx.lineTo(width * 0.85, height * 0.28);
            ctx.stroke();

            // 4.5-second cyclical shooting biomechanics simulation
            const cycleSec = ((nowMs - simStartRef.current) / 1000) % 4.5;
            // t=0..1.4: READY, t=1.4..2.6: LOADING (dip + 90deg set), t=2.6..3.6: RELEASE (high follow-through), t=3.6..4.5: reset
            let dipFactor = 0; // 0 = standing, 1 = loaded set point, 2 = full extension
            if (cycleSec >= 1.2 && cycleSec < 2.5) {
              dipFactor = Math.sin(((cycleSec - 1.2) / 1.3) * (Math.PI / 2));
            } else if (cycleSec >= 2.5 && cycleSec < 3.7) {
              dipFactor = 1 + Math.sin(((cycleSec - 2.5) / 1.2) * (Math.PI / 2));
            }

            const baseHipY = 0.62 + (dipFactor < 1 ? dipFactor * 0.05 : (2 - dipFactor) * 0.05 - 0.04);
            const shoulder = { x: 0.34, y: baseHipY - 0.22 };
            const head = { x: 0.34, y: shoulder.y - 0.09 };
            const hip = { x: 0.33, y: baseHipY };
            const knee = {
              x: 0.36 + (dipFactor <= 1 ? dipFactor * 0.04 : (2 - dipFactor) * 0.04),
              y: baseHipY + 0.16,
            };
            const ankle = { x: 0.33, y: 0.91 };

            // Arm kinematics through READY -> 90° SET -> EXTENSION
            let elbow = { x: 0.39, y: shoulder.y + 0.08 };
            let wrist = { x: 0.43, y: shoulder.y + 0.02 };

            if (dipFactor <= 1) {
              // Loading into ~90° L-shape set point
              elbow = {
                x: 0.34 + 0.08 * dipFactor + 0.04 * (1 - dipFactor),
                y: shoulder.y + 0.08 * (1 - dipFactor) - 0.01 * dipFactor,
              };
              wrist = {
                x: elbow.x + 0.01 * (1 - dipFactor),
                y: elbow.y - 0.12 * dipFactor + 0.04 * (1 - dipFactor),
              };
            } else {
              // Extending upward toward hoop
              const ext = dipFactor - 1; // 0..1
              elbow = {
                x: 0.42 + ext * 0.04,
                y: shoulder.y - 0.01 - ext * 0.11,
              };
              wrist = {
                x: elbow.x + ext * 0.06,
                y: elbow.y - 0.12 - ext * 0.06,
              };

              // Animated basketball arc toward hoop
              const ballProgress = Math.min(1, ext * 1.15);
              const startX = wrist.x * width;
              const startY = wrist.y * height;
              const endX = width * 0.81;
              const endY = height * 0.28;
              const bx = startX + (endX - startX) * ballProgress;
              const by =
                startY +
                (endY - startY) * ballProgress -
                Math.sin(ballProgress * Math.PI) * (height * 0.26);

              // Draw dotted trajectory arc
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = 'rgba(249, 115, 22, 0.5)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.quadraticCurveTo(
                (startX + endX) / 2,
                Math.min(startY, endY) - height * 0.28,
                endX,
                endY
              );
              ctx.stroke();

              // Basketball
              ctx.fillStyle = '#f97316';
              ctx.beginPath();
              ctx.arc(bx, by, 11, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }

            evaluatePoseBiomechanics(
              shoulder,
              elbow,
              wrist,
              hip,
              knee,
              ankle,
              nowMs
            );
            drawBiomechanicsHUD(ctx, width, height, {
              head,
              shoulder,
              elbow,
              wrist,
              hip,
              knee,
              ankle,
            });
          } else {
            // Standby / Idle Mode (No active feed yet)
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, '#0f172a');
            grad.addColorStop(1, '#020617');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '600 16px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(
              'Camera Standby — Click "Start Live Camera" or "Upload Clip" above to begin tracking',
              width / 2,
              height / 2
            );
            ctx.font = '400 13px Inter, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(
              '(Or click "AI Pose Simulator" to test automatic shot detection without a camera)',
              width / 2,
              height / 2 + 26
            );
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [feedMode, shootingHand, evaluatePoseBiomechanics, drawBiomechanicsHUD]);

  // Start / Stop Live Camera
  const toggleCamera = async () => {
    if (cameraActive) {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      setCameraActive(false);
      setFeedMode('idle');
      setLiveAngles({ elbow: null, release: null, knee: null });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        setFeedMode('camera');
        showToast('🎥 Live Camera Active — Step back so your upper body & knees are visible');
      }
    } catch (err) {
      console.error('Camera access error:', err);
      showToast('Could not access camera. Check browser camera permissions.');
      setFeedMode('idle');
    }
  };

  // Upload Video file for Pose Analysis
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    if (cameraActive && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    videoRef.current.loop = true;
    videoRef.current.play();
    setFeedMode('video');
    showToast(`📼 Analyzing uploaded clip: ${file.name}`);
  };

  return (
    <div className="space-y-4">
      {/* Top Camera Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={toggleCamera}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
              cameraActive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25'
                : 'bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/25'
            }`}
          >
            {cameraActive ? (
              <>
                <CameraOff className="w-4 h-4" /> Stop Live Camera
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" /> Start Live Camera
              </>
            )}
          </button>

          <button
            onClick={() => {
              if (cameraActive) toggleCamera();
              else if (feedMode === 'simulator') {
                setFeedMode('idle');
                setPendingShotAlert(false);
                setLiveAngles({ elbow: null, release: null, knee: null });
              } else {
                setFeedMode('simulator');
              }
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
              feedMode === 'simulator'
                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> {feedMode === 'simulator' ? 'Stop Simulator' : 'AI Pose Simulator'}
          </button>

          <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer transition">
            <Upload className="w-3.5 h-3.5" /> Upload Clip
            <input
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Right Controls: Voice, Handedness, Model Badge */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceActive((v) => !v)}
            title="Say 'Make'/'Swish' or 'Miss' hands-free while shooting"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              voiceActive
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {voiceActive ? (
              <>
                <Mic className="w-3.5 h-3.5 animate-pulse text-emerald-400" /> Voice On ("Make"/"Miss")
              </>
            ) : (
              <>
                <MicOff className="w-3.5 h-3.5" /> Voice Commands
              </>
            )}
          </button>

          <button
            onClick={() => onChangeHand(shootingHand === 'Right' ? 'Left' : 'Right')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            Hand: <span className="text-orange-400 font-bold">{shootingHand}</span>
          </button>

          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 ${
              modelStatus === 'ready'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-current animate-ping" />
            {modelStatus === 'ready' ? 'MediaPipe 60FPS Ready' : 'Loading Vision AI...'}
          </span>
        </div>
      </div>

      {/* Video + Biomechanical Skeleton Overlay Canvas */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas
          ref={canvasRef}
          width={800}
          height={460}
          className="w-full h-auto block"
        />

        {/* Top-Left Live HUD: Shot Counter & Zone */}
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
          <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl px-3.5 py-2 flex items-center gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Session Shots
              </div>
              <div className="text-2xl font-extrabold text-white">
                {sessionStats.makes}/{sessionStats.total}{' '}
                <span className="text-sm font-semibold text-orange-400">
                  ({sessionStats.fg_pct}%)
                </span>
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Motion State
              </div>
              <div
                className={`text-xs font-bold uppercase tracking-wide ${
                  shotPhase === 'RELEASED'
                    ? 'text-emerald-400'
                    : shotPhase === 'LOADING'
                    ? 'text-amber-400'
                    : 'text-sky-400'
                }`}
              >
                ● {shotPhase}
              </div>
            </div>
          </div>
        </div>

        {/* Top-Right Live Angles Telemetry */}
        <div className="absolute top-3 right-3 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl px-3.5 py-2 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Elbow</div>
            <div className="text-sm font-bold text-orange-400">
              {liveAngles.elbow !== null ? `${liveAngles.elbow}°` : '--'}
            </div>
            <div className="text-[9px] text-slate-500">Target 90°</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Release</div>
            <div className="text-sm font-bold text-emerald-400">
              {liveAngles.release !== null ? `${liveAngles.release}°` : '--'}
            </div>
            <div className="text-[9px] text-slate-500">Target 55°</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Knee</div>
            <div className="text-sm font-bold text-sky-400">
              {liveAngles.knee !== null ? `${liveAngles.knee}°` : '--'}
            </div>
            <div className="text-[9px] text-slate-500">Target 118°</div>
          </div>
        </div>

        {/* Toast Notification */}
        {statusToast && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-orange-500/50 text-white px-4 py-2 rounded-full text-xs font-semibold shadow-xl flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-orange-400" />
            {statusToast}
          </div>
        )}

        {/* Auto-Detected Shot Banner */}
        {pendingShotAlert && (
          <div className="absolute bottom-3 left-3 right-3 bg-slate-900/95 backdrop-blur-md border border-orange-500/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-orange-400" />
              <div>
                <div className="text-xs font-bold text-white">
                  Shot Release Detected! ({selectedZone})
                </div>
                <div className="text-[11px] text-slate-300">
                  Captured Set Elbow:{' '}
                  <span className="text-orange-400 font-semibold">
                    {lastCapturedBio.elbow_angle}°
                  </span>{' '}
                  • Release Arc:{' '}
                  <span className="text-emerald-400 font-semibold">
                    {lastCapturedBio.release_angle}°
                  </span>{' '}
                  • Knee Load:{' '}
                  <span className="text-sky-400 font-semibold">
                    {lastCapturedBio.knee_angle}°
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRecordOutcome(true)}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Log Make (M)
              </button>
              <button
                onClick={() => handleRecordOutcome(false)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Log Miss (X)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Big Court-Side Make / Miss Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleRecordOutcome(true)}
          className="flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-base shadow-lg shadow-emerald-900/30 active:scale-[0.99] transition"
        >
          <CheckCircle2 className="w-6 h-6" />
          <span>MADE SHOT (Press M)</span>
        </button>

        <button
          onClick={() => handleRecordOutcome(false)}
          className="flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-base shadow-lg shadow-rose-900/30 active:scale-[0.99] transition"
        >
          <XCircle className="w-6 h-6" />
          <span>MISSED SHOT (Press X)</span>
        </button>
      </div>
    </div>
  );
};

