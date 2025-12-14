export interface Slide {
  id: number;
  title: string;
  content: string[];
  visualPrompt?: string; // Description for generating a diagram
  visualUrl?: string;    // The actual generated image URL
  speakerNotes: string;
}

export interface SolutionData {
  title: string;
  slides: Slide[];
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  GENERATING_MEDIA = 'GENERATING_MEDIA',
  READY = 'READY',
  PLAYING = 'PLAYING',
  ERROR = 'ERROR'
}

export interface NewtonProfile {
  imageUrl: string;
  voiceName: string;
}