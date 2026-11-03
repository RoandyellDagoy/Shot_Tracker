# 🏀 HoopsVision AI — Live Basketball Shot & Biomechanics Tracker

A high-performance **Hybrid AI Basketball Shot & Form Tracker** built with:
- **Frontend (Client-Side Edge AI):** React 18 + TypeScript + Vite + Tailwind CSS + **Google MediaPipe Pose (`@mediapipe/tasks-vision`)** running at **60 FPS in the browser** via WebGL/WASM for zero-latency skeleton tracking.
- **Backend (Analytics & Storage API):** **Python FastAPI** + SQLite for session persistence, Make vs. Miss biomechanical comparison, form scoring, and automated coaching insights.

---

## ✨ Key Features

1. **60 FPS Live Camera & Pose Skeleton Overlay**
   - Tracks 3D body landmarks in real time directly in your browser (zero video upload lag or GPU server costs).
   - Computes live **Set-Point Elbow Angle**, **Release Elevation Arc**, and **Knee Bend Angle**.
2. **Automatic Shot Release State Machine**
   - Automatically detects your shooting motion (`READY` → `LOADING` → `RELEASED`) and captures your exact biomechanical angles at your set point and release.
   - Includes a built-in **AI Pose Simulator** and **Video Clip Upload** mode so you can test or analyze recorded workouts anytime.
3. **Hands-Free & Court-Side Make / Miss Logging**
   - **Voice Commands:** Toggle Voice Mode and say *"Make"*, *"Swish"*, or *"Miss"*, *"Brick"* from the court.
   - **Keyboard / Touch:** Press `M` for Make, `X` for Miss, or tap the large court-side buttons.
4. **Interactive Half-Court Shot Chart**
   - Click any of the 10 court zones to tag where you are shooting from and view live zone FG% heatmaps.
5. **Python FastAPI Biomechanics Analytics Engine**
   - Compares your average **Elbow Angle**, **Release Arc**, **Knee Bend**, and **Follow-Through Hold** on **Made Shots vs. Missed Shots** and generates actionable coaching insights.

---

## 🚀 Running Locally

### 1. Start the Python FastAPI Backend (Port 8000)
```powershell
cd backend
.\.venv\Scripts\uvicorn main:app --reload --port 8000
```

### 2. Start the React + MediaPipe Frontend (Port 5173)
```powershell
cd frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

