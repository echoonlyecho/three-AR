import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Mic, Activity, Box, Trash2, Zap, Play, Square, Command, Hand, Scan, Wifi, Fingerprint, Sparkles, Target, Crosshair } from 'lucide-react';
import World from './components/World';
import { GeminiLiveClient } from './services/GeminiLiveClient';
import { ConnectionState, LogMessage, WorldRef } from './types';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [detectedGesture, setDetectedGesture] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<WorldRef>(null);
  const geminiClientRef = useRef<GeminiLiveClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  // Fix: useRef requires an initial value in this environment
  const requestRef = useRef<number | undefined>(undefined);
  const lastGestureTimeRef = useRef<number>(0);

  const addLog = (role: 'user' | 'model' | 'system', text: string) => {
    setLogs(prev => [...prev.slice(-3), { id: Date.now().toString(), role, text, timestamp: Date.now() }]);
  };

  useEffect(() => {
    const loadModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        gestureRecognizerRef.current = recognizer;
        setModelLoaded(true);
        addLog('system', 'Neural Link Established.');
      } catch (error) {
        addLog('system', 'Vision System Failure.');
      }
    };
    loadModel();
  }, []);

  useEffect(() => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return;
    geminiClientRef.current = new GeminiLiveClient(apiKey);
    geminiClientRef.current.onConnectionStateChange = (state) => setConnectionState(state as ConnectionState);
    geminiClientRef.current.onLogMessage = (role, text) => addLog(role as any, text);
    geminiClientRef.current.onToolCall = async (name, args) => {
      if (!worldRef.current) return;
      switch(name) {
        case 'spawn_block': worldRef.current.spawnBlock(args.color || 'random', args.x || 0, args.y || 5, args.z || 0); return "Spawned.";
        case 'push_blocks': worldRef.current.pushBlocks(args.direction, args.intensity); return "Pushed.";
        case 'clear_scene': worldRef.current.clearScene(); return "Cleared.";
        default: return "Unknown.";
      }
    };
    // Fix: useEffect cleanup cannot return a Promise
    return () => { stopSession(); };
  }, []);

  const startSession = async () => {
    if (!modelLoaded) return;
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
      addLog('system', 'Link Interrupted.');
    }
  };

  const stopSession = async () => {
    await geminiClientRef.current?.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const recognizer = gestureRecognizerRef.current;
    
    if (video && canvas && recognizer && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        const results = recognizer.recognizeForVideo(video, Date.now());

        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (results.landmarks && results.landmarks.length > 0) {
                const landmarks = results.landmarks[0];
                new DrawingUtils(ctx).drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
                new DrawingUtils(ctx).drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });

                if (worldRef.current) {
                    const x = landmarks[9].x; 
                    const y = landmarks[9].y;
                    const isHandActive = results.gestures[0]?.[0]?.categoryName === 'Open_Palm';
                    worldRef.current.updateHandPosition(1 - x, y, isHandActive);
                }
            } else if (worldRef.current) {
                worldRef.current.updateHandPosition(0.5, 0.5, false);
            }
        }

        if (results.gestures.length > 0) {
            const category = results.gestures[0][0].categoryName;
            const score = results.gestures[0][0].score;
            setConfidence(score);
            if (score > 0.7) {
               setDetectedGesture(category);
               if (Date.now() - lastGestureTimeRef.current > 1200) {
                  handleDiscreteGesture(category);
               }
            } else {
               setDetectedGesture(null);
            }
        } else {
            setDetectedGesture(null);
            setConfidence(0);
        }
    }
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  const handleDiscreteGesture = (gesture: string) => {
      if (!worldRef.current) return;
      lastGestureTimeRef.current = Date.now();
      switch (gesture) {
          case 'Closed_Fist': worldRef.current.pushBlocks('explode', 25); break;
          case 'Victory': worldRef.current.spawnBlock('random', 0, 8, 0); break;
          case 'Thumb_Up': worldRef.current.clearScene(); break;
      }
  };

  return (
    <div className="relative w-full h-full bg-[#050505] text-white font-mono overflow-hidden">
      <World ref={worldRef} />

      {/* Sci-fi Overlay HUD */}
      <div className="absolute inset-0 pointer-events-none border-[20px] border-white/5">
          <div className="absolute top-0 left-0 w-20 h-20 border-t-2 border-l-2 border-blue-500/50"></div>
          <div className="absolute top-0 right-0 w-20 h-20 border-t-2 border-r-2 border-blue-500/50"></div>
          <div className="absolute bottom-0 left-0 w-20 h-20 border-b-2 border-l-2 border-blue-500/50"></div>
          <div className="absolute bottom-0 right-0 w-20 h-20 border-b-2 border-r-2 border-blue-500/50"></div>
          
          <div className="absolute top-1/2 left-4 -translate-y-1/2 flex flex-col gap-1 items-center opacity-20">
              <div className="w-1 h-32 bg-blue-500/50 rounded-full"></div>
              <span className="text-[8px]">ALT</span>
          </div>
      </div>

      <div className="absolute top-6 left-6 z-10 pointer-events-none">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-sm">
                 <Target className="w-6 h-6 text-white animate-pulse" />
              </div>
              <div>
                 <h1 className="text-xl font-black tracking-widest text-white uppercase italic">
                   G-CORE <span className="text-blue-500 text-sm not-italic ml-2">v2.0</span>
                 </h1>
                 <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-400' : 'bg-red-500 animate-ping'}`}></div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-tighter">{connectionState}</span>
                 </div>
              </div>
           </div>
      </div>

      <div className="absolute top-24 left-6 z-10 pointer-events-none bg-black/60 p-4 border-l-2 border-blue-500 backdrop-blur-md">
        <div className="text-[10px] uppercase font-bold text-blue-400 mb-2 flex items-center gap-2">
            <Sparkles size={12} /> OS Status: Nominal
        </div>
        <div className="space-y-1 text-[11px] text-gray-300">
          <div className="flex justify-between gap-8"><span>🖐️ Palm</span><span className="text-blue-400">Force Field</span></div>
          <div className="flex justify-between gap-8"><span>✊ Fist</span><span className="text-red-400">Detonate</span></div>
          <div className="flex justify-between gap-8"><span>✌️ Victory</span><span className="text-yellow-400">Deploy Unit</span></div>
        </div>
        
        {/* Confidence Bar */}
        <div className="mt-4 pt-2 border-t border-white/10">
            <div className="flex justify-between text-[8px] mb-1"><span>LINK SYNC</span><span>{Math.round(confidence * 100)}%</span></div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${confidence * 100}%` }}></div>
            </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-6 pointer-events-auto">
        <button 
          onClick={connectionState === ConnectionState.CONNECTED ? stopSession : startSession}
          disabled={!modelLoaded}
          className={`group relative flex items-center gap-3 px-10 py-4 font-black rounded-sm overflow-hidden transition-all ${connectionState === ConnectionState.CONNECTED ? 'bg-red-600 border-red-400' : 'bg-blue-600 border-blue-400'} border-2`}
        >
          <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform"></div>
          {connectionState === ConnectionState.CONNECTED ? <Square size={20} className="fill-white" /> : <Play size={20} className="fill-white" />}
          <span className="relative uppercase tracking-widest">{connectionState === ConnectionState.CONNECTED ? "Deactivate" : "Initialize"}</span>
        </button>
      </div>

      <div className="absolute top-6 right-6 z-20 w-48 group">
        <div className="relative rounded border-2 border-white/20 overflow-hidden bg-black shadow-2xl">
            <video ref={videoRef} muted autoPlay playsInline className="w-full h-32 object-cover grayscale brightness-125 contrast-150" style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-80" style={{ transform: 'scaleX(-1)' }} />
            
            <div className="absolute inset-0 bg-blue-500/10 pointer-events-none"></div>
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/80 px-1 py-0.5 rounded text-[8px] font-bold">
                <div className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></div> REC
            </div>
            
            {detectedGesture && (
                <div className="absolute bottom-2 right-2 bg-blue-500 text-[10px] font-black px-2 py-0.5 skew-x-[-12deg]">
                    {detectedGesture}
                </div>
            )}
        </div>
      </div>
      
      <div className="absolute bottom-6 right-6 z-10 w-64 pointer-events-none flex flex-col gap-2">
          {logs.map((log) => (
            <div key={log.id} className={`p-3 text-[10px] border-r-4 ${log.role === 'model' ? 'bg-blue-900/40 border-blue-500 text-blue-100' : 'bg-gray-900/40 border-gray-500 text-gray-300'}`}>
              <div className="opacity-40 mb-1 uppercase tracking-tighter">{log.role}</div>
              {log.text}
            </div>
          ))}
      </div>
    </div>
  );
}

export default App;