import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { MODEL_NAME, SYSTEM_INSTRUCTION } from '../constants';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from '../utils/audio';

// Tool Definitions
const tools: FunctionDeclaration[] = [
  {
    name: 'spawn_block',
    description: 'Spawn a building block at a specific location.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        color: { type: Type.STRING, description: 'Color (red, blue, yellow, white, grey)' },
        x: { type: Type.NUMBER, description: 'X position (-4 to 4)' },
        y: { type: Type.NUMBER, description: 'Y position (0 to 10)' },
        z: { type: Type.NUMBER, description: 'Z position (-4 to 4)' }
      },
      required: ['color', 'x', 'y', 'z']
    }
  },
  {
    name: 'push_blocks',
    description: 'Apply a physical force to push blocks or explode them.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING, description: 'Direction (forward, backward, left, right, explode)' },
        intensity: { type: Type.NUMBER, description: 'Force intensity (1 to 20)' }
      },
      required: ['direction', 'intensity']
    }
  },
  {
    name: 'clear_scene',
    description: 'Remove all blocks from the world.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    }
  }
];

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private session: any = null;
  private audioContext: AudioContext;
  private inputAudioContext: AudioContext;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  
  public onToolCall: (name: string, args: any) => Promise<any> = async () => ({});
  public onConnectionStateChange: (state: string) => void = () => {};
  public onLogMessage: (role: string, text: string) => void = () => {};

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  }

  async connect(stream: MediaStream) {
    this.onConnectionStateChange('CONNECTING');
    
    try {
      this.session = await this.ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            this.onConnectionStateChange('CONNECTED');
            this.startAudioInput(stream);
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onclose: () => this.onConnectionStateChange('DISCONNECTED'),
          onerror: (e) => {
            console.error(e);
            this.onConnectionStateChange('ERROR');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: tools }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          }
        }
      });
    } catch (err) {
      console.error("Connection failed", err);
      this.onConnectionStateChange('ERROR');
    }
  }

  private startAudioInput(stream: MediaStream) {
    const source = this.inputAudioContext.createMediaStreamSource(stream);
    const processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData);
      // Wait for session to be ready
      if (this.session) {
        this.session.sendRealtimeInput({ media: pcmBlob });
      }
    };
    
    source.connect(processor);
    processor.connect(this.inputAudioContext.destination);
  }

  public sendVideoFrame(base64Image: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        media: {
          mimeType: 'image/jpeg',
          data: base64Image
        }
      });
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    // Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      this.playAudio(audioData);
    }

    // Handle Tool Calls
    const toolCall = message.toolCall;
    if (toolCall) {
      for (const fc of toolCall.functionCalls) {
        this.onLogMessage('model', `Executing: ${fc.name}`);
        try {
          const result = await this.onToolCall(fc.name, fc.args);
          await this.session.sendToolResponse({
            functionResponses: {
              id: fc.id,
              name: fc.name,
              response: { result: result || "Done" }
            }
          });
        } catch (error) {
          console.error(`Error executing ${fc.name}:`, error);
        }
      }
    }
  }

  private async playAudio(base64Data: string) {
    const uint8 = base64ToUint8Array(base64Data);
    const audioBuffer = await decodeAudioData(uint8, this.audioContext, 24000, 1);
    
    this.nextStartTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start(this.nextStartTime);
    
    this.nextStartTime += audioBuffer.duration;
    
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  public async disconnect() {
    if (this.session) {
      // session.close() is not available in all versions, but we can stop sending
      this.session = null; 
    }
    this.sources.forEach(s => s.stop());
    this.sources.clear();
    this.nextStartTime = 0;
    this.onConnectionStateChange('DISCONNECTED');
  }
}
