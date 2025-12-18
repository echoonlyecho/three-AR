import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Mic, Activity, Box, Trash2, Zap, Play, Square, Command, Hand, Scan, Wifi, Fingerprint, Sparkles } from 'lucide-react';
import World from './components/World';
import { GeminiLiveClient } from './services/GeminiLiveClient';
import { ConnectionState, LogMessage, WorldRef } from './types';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

const VIDEO_FRAME_RATE = 30; 

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [detectedGesture, setDetectedGesture] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'trigger' | 'spatial'>('spatial'); // New mode switch
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<WorldRef>(null);
  const geminiClientRef = useRef<GeminiLiveClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const requestRef = useRef<number>();
  const lastGestureTimeRef = useRef<number>(0);

  const addLog = (role: 'user' | 'model' | 'system', text: string) => {
    setLogs(prev => [...prev.slice(-4), { id: Date.now().toString(), role, text, timestamp: Date.now() }]);
  };

  // 1. Load MediaPipe Model
  useEffect(() => {
    const loadModel = async () => {
      try {
        addLog('system', 'Loading gesture model...');
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        gestureRecognizerRef.current = recognizer;
        setModelLoaded(true);
        addLog('system', 'Gesture model ready.');
      } catch (error) {
        console.error(error);
        addLog('system', 'Failed to load gesture model.');
      }
    };
    loadModel();
  }, []);

  // 2. Initialize Gemini Client
  useEffect(() => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return;
    
    geminiClientRef.current = new GeminiLiveClient(apiKey);
    geminiClientRef.current.onConnectionStateChange = (state) => setConnectionState(state as ConnectionState);
    geminiClientRef.current.onLogMessage = (role, text) => addLog(role as any, text);
    
    geminiClientRef.current.onToolCall = async (name, args) => {
      if (!worldRef.current) return;
      switch(name) {
        case 'spawn_block': worldRef.current.spawnBlock(args.color, args.x, args.y, args.z); return "Spawned.";
        case 'push_blocks': worldRef.current.pushBlocks(args.direction, args.intensity); return "Pushed.";
        case 'clear_scene': worldRef.current.clearScene(); return "Cleared.";
        default: return "Unknown.";
      }
    };

    return () => stopSession();
  }, []);

  const startSession = async () => {
    if (!modelLoaded) {
      addLog('system', 'Please wait for model to load...');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { channelCount: 1, sampleRate: 16000 }, 
        video: { width: 640, height: 480 } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        requestRef.current = requestAnimationFrame(predictWebcam);
      }
      await geminiClientRef.current?.connect(stream);
    } catch (err) {
      console.error(err);
      addLog('system', 'Failed to start.');
    }
  };

  const stopSession = async () => {
    await geminiClientRef.current?.disconnect();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  // 3. The Core Loop: MediaPipe Detection
  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const recognizer = gestureRecognizerRef.current;
    
    if (video && canvas && recognizer) {
        if (video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            
            // Detect
            const results = recognizer.recognizeForVideo(video, Date.now());

            // Draw Landmarks
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (results.landmarks && results.landmarks.length > 0) {
                    const landmarks = results.landmarks[0];
                    const drawingUtils = new DrawingUtils(ctx);
                    drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
                    drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });

                    // --- SPATIAL TRACKING LOGIC ---
                    if (worldRef.current) {
                        // Use the wrist (index 0) or index finger tip (index 8) for cursor position
                        // x is normalized [0,1]. Note: Video is mirrored in CSS, but coordinates might need mirroring logic depending on MP version.
                        // Usually MP coordinates are normalized. If video is mirrored via CSS transform, visual alignment is tricky.
                        // Let's assume standard coords and flip X for the 3D world mapping if needed.
                        const x = landmarks[9].x; // Middle finger knuckle (center of hand)
                        const y = landmarks[9].y;
                        
                        // Check if hand is "Active" (Open Palm) vs "Inactive" (Fist/Other)
                        // A simple heuristic or use the classified gesture
                        const isHandActive = detectedGesture === 'Open_Palm';
                        
                        // Update 3D World Cursor
                        // Flip X because webcam is usually mirrored for the user
                        worldRef.current.updateHandPosition(1 - x, y, isHandActive);
                    }
                } else {
                    // No hand detected, hide cursor
                    if (worldRef.current) worldRef.current.updateHandPosition(0.5, 0.5, false);
                }
            }

            // Logic Trigger
            if (results.gestures.length > 0) {
                const category = results.gestures[0][0].categoryName;
                const score = results.gestures[0][0].score;
                
                if (score > 0.6) {
                   setDetectedGesture(category);
                   // Handle discrete triggers only if cooldown passed
                   if (Date.now() - lastGestureTimeRef.current > 1000) {
                      handleDiscreteGesture(category);
                   }
                } else {
                   setDetectedGesture(null);
                }
            } else {
                setDetectedGesture(null);
            }
        }
    }
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  const handleDiscreteGesture = (gesture: string) => {
      if (!worldRef.current) return;
      
      // We only use discrete triggers for Spawn/Explode/Clear now.
      // "Push" is handled continuously by spatial tracking (The Force).
      switch (gesture) {
          case 'Closed_Fist':
              // Explode is still a good "Event"
              addLog('system', '✊ Fist -> EXPLODE');
              worldRef.current.pushBlocks('explode', 25);
              lastGestureTimeRef.current = Date.now();
              break;
          case 'Victory':
              addLog('system', '✌️ Victory -> SPAWN');
              worldRef.current.spawnBlock('random', 0, 5, 0);
              lastGestureTimeRef.current = Date.now();
              break;
          case 'Thumb_Up':
              addLog('system', '👍 Thumb -> CLEAR');
              worldRef.current.clearScene();
              lastGestureTimeRef.current = Date.now();
              break;
          case 'Open_Palm':
              // Do nothing discrete, handled by continuous spatial loop
              break;
      }
  };

  const handleManualAction = (action: string) => {
    if (!worldRef.current) return;
    if (action === 'spawn') worldRef.current.spawnBlock('red', 0, 5, 0);
    if (action === 'push') worldRef.current.pushBlocks('explode', 20);
    if (action === 'clear') worldRef.current.clearScene();
  };

  return (
    <div className="relative w-full h-full bg-black text-white font-mono overflow-hidden">
      
      {/* 3D World */}
      <div className="absolute inset-0 z-0">
        <World ref={worldRef} />
      </div>

      {/* Header */}
      <div className="absolute top-0 left-0 w-full p-4 z-10 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-2">
           <h1 className="text-2xl font-bold tracking-tighter text-blue-500 uppercase drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]">
             Gundam Builder <span className="text-yellow-400">AR</span>
           </h1>
           <div className="flex items-center gap-2 pointer-events-auto">
              <span className={`h-3 w-3 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-gray-500'}`}></span>
              <span className="text-xs text-gray-400">{connectionState}</span>
              {!modelLoaded && <span className="text-xs text-yellow-500 animate-pulse">LOADING VISION...</span>}
           </div>
        </div>
      </div>

      {/* Hints Overlay */}
      <div className="absolute top-20 left-4 z-10 pointer-events-none text-gray-400 text-[10px] space-y-2 hidden md:block bg-black/40 p-2 rounded backdrop-blur-sm border border-white/10">
        <div className="flex items-center gap-1 uppercase font-bold text-white"><Sparkles size={12} /> Spatial Controls</div>
        <div className="flex items-center gap-2"><span className="text-xl">🖐️</span> <span>Open Hand = Move Cursor / Push</span></div>
        <div className="flex items-center gap-2"><span className="text-xl">✊</span> <span>Fist = Detonate</span></div>
        <div className="flex items-center gap-2"><span className="text-xl">✌️</span> <span>Victory = Spawn Block</span></div>
        <div className="mt-2 text-xs text-blue-300">Move your hand to control the glowing orb!</div>
      </div>

      {/* Control Panel */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-4 pointer-events-auto">
        {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
           <button 
             onClick={startSession}
             disabled={!modelLoaded}
             className={`flex items-center gap-2 px-8 py-4 ${modelLoaded ? 'bg-blue-600 hover:bg-blue-500 border-blue-400' : 'bg-gray-800 border-gray-600 cursor-not-allowed'} text-white font-bold rounded-lg transition-all shadow-lg border`}
           >
             <Play className="w-5 h-5" /> {modelLoaded ? "START AR LINK" : "SYSTEM BOOTING..."}
           </button>
        ) : (
           <button 
             onClick={stopSession}
             className="flex items-center gap-2 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all shadow-[0_0_20px_rgba(220,38,38,0.5)] border border-red-400"
           >
             <Square className="w-5 h-5 fill-current" /> ABORT
           </button>
        )}
      </div>

      {/* Camera Preview */}
      <div className="absolute top-4 right-4 z-20 w-48 rounded-lg overflow-hidden border-2 border-gray-800 bg-black/80 shadow-lg group">
        <div className="relative">
            <video 
              ref={videoRef} 
              muted 
              autoPlay 
              playsInline 
              className="w-full h-auto object-cover opacity-60"
              style={{ transform: 'scaleX(-1)' }} 
            />
            <canvas 
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }} 
            />
            
            {detectedGesture && (
                <div className="absolute top-2 left-2 bg-blue-600/80 text-white px-2 py-1 rounded text-xs font-bold animate-pulse backdrop-blur-md">
                    {detectedGesture}
                </div>
            )}
        </div>
      </div>
      
      <div className="absolute bottom-4 right-4 z-10 w-80 pointer-events-none flex flex-col gap-2 items-end">
          {logs.map((log) => (
            <div key={log.id} className={`max-w-full p-2 rounded text-xs backdrop-blur-md border border-white/10 ${log.role === 'model' ? 'bg-blue-900/40 text-blue-100' : 'bg-gray-900/40 text-gray-300'}`}>
              <div className="flex items-center gap-1 mb-1 opacity-50 text-[10px] uppercase font-bold">
                 {log.role === 'model' ? <Activity size={10} /> : null} {log.role}
              </div>
              {log.text}
            </div>
          ))}
      </div>

    </div>
  );
}

export default App;