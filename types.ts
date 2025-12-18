export interface BlockData {
  id: string;
  position: [number, number, number];
  color: string;
  velocity: [number, number, number];
  isSleeping: boolean;
}

export interface WorldRef {
  spawnBlock: (color: string, x: number, y: number, z: number) => void;
  pushBlocks: (direction: string, intensity: number) => void;
  clearScene: () => void;
  updateHandPosition: (x: number, y: number, isActive: boolean) => void; // New method for spatial tracking
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface LogMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
}