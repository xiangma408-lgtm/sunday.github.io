import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, SolutionData, Slide } from './types';
import { analyzePhysicsImage, generateNewtonAvatar, generateSpeech, generateDiagram } from './services/geminiService';
import SlideDeck from './components/SlideDeck';
import katex from 'katex';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0); // 0 to 1
  
  const [isEditing, setIsEditing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Cleanup effect for object URLs
  useEffect(() => {
    return () => {
      audioUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [audioUrls]);

  // 1. Handle File Upload & Initial Analysis
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setAudioUrls([]); 

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      const mimeType = file.type;

      try {
        const data = await analyzePhysicsImage(base64Data, mimeType);
        
        setAppState(AppState.GENERATING_MEDIA);
        
        // Parallel generation requests
        // Note: Avatar generation is removed as requested, keeping logic clean
        const audioPromises = data.slides.map(slide => generateSpeech(slide.speakerNotes));
        
        // Generate diagrams if visualPrompt exists
        // Now enforced for every slide
        const diagramPromises = data.slides.map(async (slide) => {
            if (slide.visualPrompt) {
                const url = await generateDiagram(slide.visualPrompt);
                return { ...slide, visualUrl: url };
            }
            return slide;
        });

        const [audios, slidesWithVisuals] = await Promise.all([
            Promise.all(audioPromises),
            Promise.all(diagramPromises)
        ]);
        
        setSolutionData({ ...data, slides: slidesWithVisuals });
        setAudioUrls(audios);
        setAppState(AppState.READY);

      } catch (err: any) {
        console.error(err);
        setErrorMsg(err.message || "An unexpected error occurred.");
        setAppState(AppState.ERROR);
      }
    };
    reader.readAsDataURL(file);
  };

  // 2. Playback Control
  const startPresentation = () => {
    setAppState(AppState.PLAYING);
    setIsAudioPlaying(true);
    setCurrentSlideIndex(0);
    setAudioProgress(0);
  };

  const nextSlide = useCallback(() => {
    setAudioProgress(0);
    if (solutionData && currentSlideIndex < solutionData.slides.length - 1) {
      setCurrentSlideIndex(prev => prev + 1);
    } else {
      // Presentation finished
      setIsAudioPlaying(false);
      
      // Stop recording if active
      if (isRecording && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
      
      // Only reset if not recording (to prevent jarring exit)
      if (!isRecording) {
         setAppState(AppState.READY);
      }
    }
  }, [currentSlideIndex, solutionData, isRecording]);

  // 3. Audio Synchronization Effect
  useEffect(() => {
    if (appState === AppState.PLAYING && audioRef.current && audioUrls[currentSlideIndex]) {
        const currentSrc = audioRef.current.src;
        if (currentSrc !== audioUrls[currentSlideIndex]) {
            audioRef.current.src = audioUrls[currentSlideIndex];
            if (isAudioPlaying && !isEditing) {
                audioRef.current.play().catch(e => console.warn("Autoplay blocked", e));
            }
        }
    }
  }, [currentSlideIndex, audioUrls, appState, isAudioPlaying, isEditing]);

  // Handle Play/Pause toggle
  useEffect(() => {
      if (!audioRef.current) return;
      
      if (isAudioPlaying && !isEditing) {
          if (audioRef.current.paused) {
             audioRef.current.play().catch(e => console.warn("Resume failed", e));
          }
      } else {
          if (!audioRef.current.paused) {
             audioRef.current.pause();
          }
      }
  }, [isAudioPlaying, isEditing]);

  const handleAudioEnded = () => {
    setTimeout(() => {
        nextSlide();
    }, 1000);
  };

  const handleTimeUpdate = () => {
      if (audioRef.current) {
          const duration = audioRef.current.duration;
          const currentTime = audioRef.current.currentTime;
          if (duration > 0) {
              setAudioProgress(currentTime / duration);
          }
      }
  };

  // 4. Update Slide Content
  const handleUpdateSlide = (updatedSlide: Slide) => {
    if (!solutionData) return;
    const newSlides = [...solutionData.slides];
    const index = newSlides.findIndex(s => s.id === updatedSlide.id);
    if (index !== -1) {
        newSlides[index] = updatedSlide;
        setSolutionData({ ...solutionData, slides: newSlides });
    }
    setIsEditing(false); // Exit edit mode
    setIsAudioPlaying(false); // User can resume when ready
  };

  // 5. Video Recording
  const handleDownloadVideo = async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser" },
            audio: true, 
            preferCurrentTab: true 
        } as any);

        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorderRef.current = recorder;
        recordedChunksRef.current = [];

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `physics-class-${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            stream.getTracks().forEach(track => track.stop());
            setAppState(AppState.READY);
        };

        recorder.start();
        setIsRecording(true);

        setAppState(AppState.PLAYING);
        setCurrentSlideIndex(0);
        setIsAudioPlaying(true);

    } catch (err) {
        console.error("Recording failed", err);
        alert("无法开始录制。请确保您授予了屏幕和音频录制权限。");
    }
  };

  // Helper to render text containing LaTeX in Subtitles
  const renderSubtitleText = (text: string) => {
    const parts = text.split(/(\$[^$]+\$)/g);
    return parts.map((part, index) => {
        if (part.startsWith('$') && part.endsWith('$')) {
            const tex = part.slice(1, -1);
            try {
                const html = katex.renderToString(tex, {
                    throwOnError: false,
                    displayMode: false,
                    output: 'html' 
                });
                return <span key={index} dangerouslySetInnerHTML={{ __html: html }} className="mx-1 inline-block align-baseline" />;
            } catch (e) {
                return <span key={index}>{part}</span>;
            }
        }
        return <span key={index}>{part}</span>;
    });
  };

  // Render Helpers
  const renderContent = () => {
    switch (appState) {
      case AppState.IDLE:
        return (
          <div className="text-center p-10 bg-white rounded-xl shadow-lg border border-stone-200 max-w-2xl mx-auto">
            <h1 className="text-5xl font-serif text-stone-800 mb-6">牛顿物理课堂</h1>
            <p className="text-lg text-stone-600 mb-8">
              上传一道物理题的图片，我将为你分析、解答并亲自讲解。
            </p>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer border-2 border-dashed border-stone-400 rounded-lg p-12 hover:bg-stone-50 transition-colors group"
            >
              <div className="text-6xl mb-4 group-hover:scale-110 transition-transform">🍎</div>
              <p className="font-bold text-stone-600">点击上传物理题目</p>
              <p className="text-sm text-stone-400 mt-2">支持 JPG, PNG 格式</p>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
        );

      case AppState.ANALYZING:
        return (
          <div className="flex flex-col items-center justify-center h-96">
            <div className="animate-spin text-6xl mb-4 text-stone-200">⚙️</div>
            <h2 className="text-2xl font-serif text-stone-200">正在分析受力情况...</h2>
            <p className="text-stone-400">正在解读题目描述</p>
          </div>
        );

      case AppState.GENERATING_MEDIA:
        return (
          <div className="flex flex-col items-center justify-center h-96">
            <div className="animate-pulse text-6xl mb-4 text-stone-200">🎨</div>
            <h2 className="text-2xl font-serif text-stone-200">正在绘制示意图...</h2>
            <p className="text-stone-400">正在生成幻灯片、示意图和语音讲解</p>
          </div>
        );

      case AppState.READY:
        return (
          <div className="text-center">
            <div className="mb-8">
                <h2 className="text-3xl font-serif text-stone-800 mb-2">课程准备就绪</h2>
                <p className="text-stone-600">"{solutionData?.title}"</p>
            </div>
            
            <div className="flex flex-col gap-4 items-center">
                <button 
                onClick={startPresentation}
                className="bg-stone-800 text-white text-xl px-8 py-4 rounded shadow-xl hover:bg-stone-700 transition-all flex items-center gap-3 font-serif"
                >
                <span>▶</span> 开始上课
                </button>

                <button 
                onClick={handleDownloadVideo}
                className="text-stone-600 underline hover:text-stone-900 text-sm"
                >
                🎥 录制并下载课程视频
                </button>
            </div>
          </div>
        );

      case AppState.PLAYING:
        if (!solutionData) return null;
        return (
          <div className="flex flex-col items-center justify-center min-h-screen w-full bg-stone-900 p-2 md:p-6">
            {/* Main Chalkboard Container - Expanded Size */}
            <div className="relative w-full max-w-[1800px] aspect-video max-h-[90vh] bg-stone-900 rounded-xl overflow-hidden shadow-2xl flex flex-col chalkboard border-[12px] border-[#5c4033] outline outline-2 outline-stone-600">
               
               {/* Controls Overlay (Top Right) */}
               <div className="absolute top-4 right-4 z-50 flex gap-2">
                     <button
                        onClick={() => setIsEditing(!isEditing)}
                        disabled={isRecording}
                        className={`text-xs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${isEditing ? 'bg-yellow-600/80 border-yellow-500 text-white' : 'bg-black/20 border-white/20 text-white/70 hover:bg-black/40'}`}
                     >
                        {isEditing ? '取消编辑' : '✏️ 修改'}
                     </button>
                     <button
                        onClick={() => setIsAudioPlaying(!isAudioPlaying)}
                        disabled={isEditing}
                        className="text-xs px-2 py-1 rounded border border-white/20 bg-black/20 text-white/70 hover:bg-black/40 backdrop-blur-sm min-w-[50px]"
                     >
                        {isAudioPlaying ? '⏸' : '▶'}
                     </button>
                     <div className="flex gap-1 ml-2">
                        <button 
                            onClick={() => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1))}
                            className="bg-black/20 hover:bg-black/40 text-white/70 px-2 py-1 rounded border border-white/20 disabled:opacity-30 backdrop-blur-sm"
                            disabled={currentSlideIndex === 0 || isRecording}
                        >
                            ←
                        </button>
                        <button 
                            onClick={() => {
                                if (currentSlideIndex < solutionData.slides.length - 1) {
                                    setCurrentSlideIndex(currentSlideIndex + 1);
                                } else {
                                    if (isRecording && mediaRecorderRef.current) {
                                        mediaRecorderRef.current.stop();
                                    } else {
                                        setAppState(AppState.READY);
                                        setIsAudioPlaying(false);
                                    }
                                }
                            }}
                            className="bg-black/20 hover:bg-black/40 text-white/70 px-2 py-1 rounded border border-white/20 backdrop-blur-sm"
                        >
                            {currentSlideIndex < solutionData.slides.length - 1 ? '→' : (isRecording ? '⏹' : 'End')}
                        </button>
                     </div>
               </div>

               {/* Recording Indicator */}
               {isRecording && (
                   <div className="absolute top-4 left-4 z-50 flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
                       <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
                       <span className="text-white text-xs font-bold tracking-widest">REC</span>
                   </div>
               )}

               {/* Slide Deck Area (Flex Grow) - No Overlap with subtitles */}
               <div className="flex-grow relative overflow-hidden min-h-0">
                    <SlideDeck 
                        slide={solutionData.slides[currentSlideIndex]} 
                        totalSlides={solutionData.slides.length} 
                        isEditing={isEditing}
                        onUpdate={handleUpdateSlide}
                        audioProgress={audioProgress}
                    />
               </div>

               {/* Subtitles Footer (Dedicated Space) */}
               <div className="w-full bg-black/40 backdrop-blur-md border-t border-white/10 py-3 px-10 min-h-[80px] flex items-center justify-center shrink-0 z-30">
                  <div className="text-yellow-100/90 font-serif text-lg md:text-xl leading-relaxed text-center drop-shadow-md w-full">
                    {renderSubtitleText(solutionData.slides[currentSlideIndex].speakerNotes)}
                  </div>
               </div>
            </div>
            
            {/* Hidden Audio Player */}
            <audio 
                ref={audioRef} 
                onEnded={handleAudioEnded}
                onTimeUpdate={handleTimeUpdate}
            />
          </div>
        );

      case AppState.ERROR:
        return (
            <div className="text-center text-red-600 p-8 bg-red-50 rounded border border-red-200">
                <h3 className="text-2xl font-bold mb-2">物理分析失败</h3>
                <p>{errorMsg}</p>
                <button 
                    onClick={() => setAppState(AppState.IDLE)}
                    className="mt-4 text-red-700 underline"
                >
                    重试
                </button>
            </div>
        );
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center ${appState === AppState.PLAYING ? 'bg-stone-900' : 'bg-stone-200'} p-4`}>
      {renderContent()}
    </div>
  );
};

export default App;