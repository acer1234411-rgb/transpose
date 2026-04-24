/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactPlayer from 'react-player';
import { SoundTouch, SimpleFilter, getWebAudioNode } from 'soundtouchjs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Play,
  Search,
  Music,
  Settings2,
  ChevronRight,
  ArrowRightLeft,
  Volume2,
  ListMusic,
  Tv,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Info,
  RotateCcw,
  Youtube,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { transposeChord, getSemitonesBetween, NOTES, getDistanceToG } from './lib/chordUtils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Player = ReactPlayer as any;

// Safe environment key access
const getApiKey = () => {
  // Check localStorage first for user-provided key
  const savedKey = localStorage.getItem('GEMINI_API_KEY');
  if (savedKey) return savedKey;

  try {
    // Fallback to environment variables
    return (import.meta.env?.VITE_GEMINI_API_KEY) || (process.env.GEMINI_API_KEY) || '';
  } catch (e) {
    return '';
  }
};

const getYoutubeThumbnailUrl = (url: string) => {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  if (match) {
    return `https://img.youtube.com/vi/${match[1]}/default.jpg`;
  }
  return null;
};

interface PlaylistItem {
  id: string;
  title: string;
  url: string;
  originalKey: string;
  chords: string[];
  userTranspose?: number; // Saved transpose offset
  isFavorite?: boolean;   // Favorite status
}

// [성능 최적화] 연주 중 화면 전체 Re-render를 방지하기 위한 별도 메모이제이션 컴포넌트
const ChordDisplay = React.memo(({ chords, currentTime, transposeAmount }: any) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // 현재 시간에 맞는 코드 인덱스 계산 (App에서 분리)
  const activeIndex = useMemo(() => {
    if (!chords || chords.length === 0) return -1;
    const duration = (document.querySelector('video') as any)?.duration || 180;
    const index = Math.floor((currentTime / duration) * chords.length);
    return Math.min(index, chords.length - 1);
  }, [currentTime, chords]);

  // 활성 코드 자동 스크롤
  useEffect(() => {
    if (activeIndex >= 0 && scrollRef.current) {
      const container = scrollRef.current;
      const activeElement = container.children[activeIndex] as HTMLElement;
      if (activeElement) {
        const scrollLeft = activeElement.offsetLeft - container.offsetWidth / 2 + activeElement.offsetWidth / 2;
        container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }
  }, [activeIndex]);

  return (
    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-5 shrink-0 overflow-hidden shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <Music className="w-4 h-4 text-indigo-400" />
        <span className="text-xs font-black uppercase tracking-widest text-white/40">Harmony Guide</span>
      </div>
      <div ref={scrollRef} className="flex items-center gap-4 overflow-x-auto no-scrollbar py-4 px-2 scroll-smooth">
        {chords.map((chord: string, idx: number) => {
          const isActive = idx === activeIndex;
          return (
            <div
              key={idx}
              className={cn(
                "flex-shrink-0 min-w-[64px] px-4 h-14 flex flex-col items-center justify-center rounded-2xl transition-all",
                isActive
                  ? "bg-indigo-500 text-white shadow-xl shadow-indigo-500/40 border border-indigo-400 scale-110 z-10"
                  : "bg-black/40 text-white/70 border border-white/5"
              )}
            >
              <span className="text-xl font-black leading-none">{transposeChord(chord, transposeAmount)}</span>
              {transposeAmount !== 0 && <span className="text-[8px] text-white/30 mt-1 uppercase font-bold">{chord}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default function App() {
  // [배포 환경 대응] 개발 모드에서는 Proxy를 쓰고, 배포 후에는 실제 R2 URL을 직접 사용합니다.
  const r2 = (filename: string) => {
    const isProd = import.meta.env.PROD;
    const baseUrl = isProd 
      ? 'https://pub-cb7f6167a48441ff8887d8509ae0a500.r2.dev/G-Transpose'
      : '/r2-music';
    return `${baseUrl}/${encodeURIComponent(filename)}`;
  };

  const [url, setUrl] = useState(r2('hongsi.mp4'));
  const [originalKey, setOriginalKey] = useState('C');
  const [targetKey, setTargetKey] = useState('G');
  const [chords, setChords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [songTitle, setSongTitle] = useState('01 홍시');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [detectingIds, setDetectingIds] = useState<Set<string>>(new Set());
  const [detectingAll, setDetectingAll] = useState(false);
  const [transposeAmount, setTransposeAmount] = useState(0);
  const [finePitchCents, setFinePitchCents] = useState(0);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || 'AIzaSyDlx4By2XA35ILH08h6Kqo1IhWi3R6jZpo');
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [playlistTab, setPlaylistTab] = useState<'all' | 'fav'>('all');
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Detect mobile landscape for auto-fullscreen
  useEffect(() => {
    const checkOrientation = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobile = window.innerWidth < 1024;
      setIsMobileLandscape(isLandscape && isMobile);
    };

    window.addEventListener('resize', checkOrientation);
    checkOrientation();
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  // Auto-fullscreen when rotating to landscape
  useEffect(() => {
    if (isMobileLandscape && playing && playerContainerRef.current) {
      try {
        if (!document.fullscreenElement) {
          playerContainerRef.current.requestFullscreen().catch(() => {});
        }
      } catch (e) {}
    } else if (!isMobileLandscape && document.fullscreenElement) {
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (e) {}
    }
  }, [isMobileLandscape, playing]);

  const playerRef = useRef<HTMLVideoElement>(null);


  // Web Audio API refs (SoundTouch buffer approach)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const stNodeRef = useRef<ScriptProcessorNode | null>(null);
  const stInstanceRef = useRef<any>(null);   // SoundTouch instance (for real-time pitch)
  const stFilterRef = useRef<any>(null);     // SimpleFilter (for seeking)
  const currentTimeRef = useRef(0);         // [성능] 빈번한 갱신용 Ref
  const setupPendingRef = useRef(false);    // [성능] 중복 초기화 방지
  const audioInitialized = useRef(false);
  const pitchActiveRef = useRef(false);
  const pendingTransposeRef = useRef<number | null>(null);

  const INITIAL_PLAYLIST: PlaylistItem[] = [
    { id: 'p01', title: '01 등대지기 양희은', url: r2('01 등대지기 양희은 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p02', title: '02 첫사랑 장윤정', url: r2('02 첫사랑 장윤정.mp4'), originalKey: 'C', chords: [] },
    { id: 'p03', title: '03 행복한 사람 (Capo 3)', url: r2('03 조동진 - 행복한 사람 (Capo 3) MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p04', title: '04 나 그대에게 모두 드리리', url: r2('04 이장희 - 나 그대에게 모두 드리리 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p05', title: '05 노들강변', url: r2('05 민요 - 노들강변 MR .mp4'), originalKey: 'C', chords: [] },
    { id: 'p06', title: '06 아침이슬 (김민기)', url: r2('06 김민기 - 아침이슬.mp4'), originalKey: 'C', chords: [] },
    { id: 'p07', title: '07 아침이슬 (양희은)', url: r2('07 양희은 - 아침이슬 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p08', title: '08 고장난 벽시계 (나훈아 MR)', url: r2('08 나훈아 - 고장난 벽시계 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p09', title: '09 뜨거운 안녕', url: r2('09 쟈니리 - 뜨거운 안녕.mp4'), originalKey: 'C', chords: [] },
    { id: 'p10', title: '10 내 마음 별과 같이', url: r2('10 현철 - 내 마음 별과 같이.mp4'), originalKey: 'C', chords: [] },
    { id: 'p11', title: '11 남자라는 이유로', url: r2('11 남자라는 이유로 C 조항조.mp4'), originalKey: 'C', chords: [] },
    { id: 'p12', title: '12 동숙의 노래', url: r2('12 동숙의노래 문주란.mp4'), originalKey: 'C', chords: [] },
    { id: 'p13', title: '13 홀로 아리랑', url: r2('13 서유석 - 홀로 아리랑.mp4'), originalKey: 'C', chords: [] },
    { id: 'p14', title: '14 아름다운 것들', url: r2('14 양희은 - 아름다운 것들.mp4'), originalKey: 'C', chords: [] },
    { id: 'p15', title: '15 장녹수', url: r2('15 전미경 - 장녹수.mp4'), originalKey: 'C', chords: [] },
    { id: 'p16', title: '16 내일은 해가 뜬다', url: r2('16 장철웅 - 내일은 해가 뜬다.mp4'), originalKey: 'C', chords: [] },
    { id: 'p17', title: '17 El condor pasa (A키)', url: r2('17 El condor pasa(철새는날아가고) A키(F#m) .mp4'), originalKey: 'A', chords: [] },
    { id: 'p18', title: '18 허공 (C키)', url: r2('18 허공 조용필 C키.mp4'), originalKey: 'C', chords: [] },
    { id: 'p19', title: '19 존재의 이유', url: r2('19 김종환 - 존재의 이유 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p20', title: '20 가는 세월', url: r2('20 서유석 - 가는 세월 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p21', title: '21 홍시 (조항조)', url: r2('21 홍이 조항조 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p22', title: '22 그리운 금강산 (C키)', url: r2('22 그리운금강산 C키 하모니카 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p23', title: '23 남자는 말합니다', url: r2('23 장민호 - 남자는 말합니다.mp4'), originalKey: 'C', chords: [] },
    { id: 'p24', title: '24 가로수 그늘 아래 서면', url: r2('24 이문세 - 가로수 그늘 아래 서면 MR.webm'), originalKey: 'C', chords: [] },
    { id: 'p25', title: '25 홍시 (나훈아)', url: r2('25 홍시-나훈아.mp4'), originalKey: 'C', chords: [] },
    { id: 'p26', title: '26 고맙소', url: r2('26 조항조 - 고맙소 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p27', title: '27 님이여', url: r2('27 조용필 님이여.mp4'), originalKey: 'C', chords: [] },
    { id: 'p28', title: '28 홀로 아리랑 MR', url: r2('28 서유석 - 홀로 아리랑 MR.webm'), originalKey: 'C', chords: [] },
    { id: 'p29', title: '29 백년의 약속', url: r2('29 김용임 - 훨훨훨 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p30', title: '30 10월의 어느 멋진날에', url: r2('30 10월의 어느 멋진날에.mp4'), originalKey: 'C', chords: [] },
    { id: 'p31', title: '31 칠갑산', url: r2('31 주병선 - 칠갑산 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p32', title: '32 내 사랑 내 곁에', url: r2('32 김현식 - 내 사랑 내 곁에 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p33', title: '33 사랑을 위하여', url: r2('33 김종환 - 사랑을 위하여 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p34', title: '34 인연', url: r2('34 이선희 - 인연 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p35', title: '35 시계바늘', url: r2('35 신유 - 시계바늘 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p36', title: '36 별빛같은 나의 사랑아', url: r2('36 임영웅 별빛같은나의사랑아.mp4'), originalKey: 'C', chords: [] },
    { id: 'p37', title: '37 초혼', url: r2('37 장윤정 - 초혼 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p38', title: '38 사랑으로', url: r2('38 해바라기 - 사랑으로.mp4'), originalKey: 'C', chords: [] },
    { id: 'p39', title: '39 삼포로 가는 길', url: r2('39 삼포로 가는길 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p40', title: '40 인생아 고맙다', url: r2('40 인생아고맙다 - 조항조.mp4'), originalKey: 'C', chords: [] },
    { id: 'p41', title: '41 아미새', url: r2('41 현철 - 아미새 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p42', title: '42 고장난 벽시계 (나훈아)', url: r2('42 나훈아 - 고장난 벽시계.mp4'), originalKey: 'C', chords: [] },
    { id: 'p43', title: '43 나는 행복한 사람', url: r2('43 이문세 - 나는 행복한 사람 .mp4'), originalKey: 'C', chords: [] },
    { id: 'p44', title: '44 공 (나훈아)', url: r2('44 나훈아 공.mp4'), originalKey: 'C', chords: [] },
    { id: 'p46', title: '46 앉으나 서나 당신 생각', url: r2('46 현철 - 앉으나 서나 당신 생각.mp4'), originalKey: 'C', chords: [] },
    { id: 'p47', title: '47 한오백년', url: r2('47 조용필 - 한오백년.mp4'), originalKey: 'C', chords: [] }
  ];

  const [playlist, setPlaylist] = useState<PlaylistItem[]>(INITIAL_PLAYLIST);
  const [isLoaded, setIsLoaded] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'player'>('list');

  useEffect(() => {
    const saved = localStorage.getItem('g-transpose-playlist');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPlaylist(prev => {
            const merged = [...prev];

            // 1. Update items that exist in INITIAL_PLAYLIST
            for (let i = 0; i < merged.length; i++) {
              const match = parsed.find((p: any) => p.id === merged[i].id);
              if (match) {
                // [번호 자동 복원] 저장된 제목에 번호가 빠졌다면 원본에서 찾아와 다시 붙여줍니다.
                const initialTitle = merged[i].title;
                const numberMatch = initialTitle.match(/^\d+\s*/);
                const prefix = numberMatch ? numberMatch[0] : "";
                
                let restoredTitle = match.title;
                if (prefix && !match.title.startsWith(prefix.trim())) {
                   // Only prepend if the match title doesn't already have its own numbering
                   if (!match.title.match(/^\d+\s*/)) {
                     restoredTitle = prefix + match.title;
                   }
                }

                const urlToUse = merged[i].url; // Always use the verified URL from INITIAL_PLAYLIST
                merged[i] = { 
                  ...merged[i], 
                  ...match, 
                  title: restoredTitle,
                  url: urlToUse // Prioritize verified URL over saved potentially broken one
                };
              }
            }

            // 2. Add any items from parsed that are NOT in INITIAL_PLAYLIST
            const customItems = parsed.filter((p: any) => !prev.some(item => item.id === p.id));
            if (customItems.length > 0) {
              merged.unshift(...customItems);
            }

            // Auto-load the first item from the saved/merged list
            setTimeout(() => {
              const firstItem = merged[0];
              if (firstItem) {
                loadFromPlaylist(firstItem, false);
              }
            }, 100);

            return merged;
          });
        }
      } catch (e) { console.error('Load failed:', e); }
    }
    setIsLoaded(true);
  }, []);

  // Handle auto-play for new song selection
  useEffect(() => {
    if (pendingPlay && playerRef.current) {
      playerRef.current.play().catch(() => {
        setPlaying(false);
      });
      setPendingPlay(false);
    }
  }, [pendingPlay, url]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('g-transpose-playlist', JSON.stringify(playlist));
    }
  }, [playlist, isLoaded]);

  const resetCurrentSong = () => {
    if (window.confirm('현재 곡의 키 설정을 초기화할까요?')) {
      const newAmount = 0;
      setTransposeAmount(newAmount);
      setFinePitchCents(0);
      setPlaylist(prev => prev.map(item =>
        item.url === url ? { ...item, userTranspose: newAmount } : item
      ));
    }
  };

  const updateTranspose = (amount: number) => {
    setTransposeAmount(amount);

    // [최적화] 실시간 값 변경은 잡음을 유발하므로, 
    // 아주 빠른 재시작(Clean Restart) 방식을 사용합니다.
    if (audioInitialized.current) {
      restartPitchedAtCurrentTime(amount, finePitchCents);
    }

    setPlaylist(prev => prev.map(item =>
      item.url === url ? { ...item, userTranspose: amount } : item
    ));
  };

  const filteredPlaylist = useMemo(() => {
    return playlist.filter(item => {
      const matchesSearch = item.title.toLowerCase().includes(playlistSearch.toLowerCase());
      if (playlistTab === 'fav') {
        return matchesSearch && item.isFavorite;
      }
      return matchesSearch;
    });
  }, [playlist, playlistSearch, playlistTab]);

  const [analysisResult, setAnalysisResult] = useState<{
    detectedKey: string;
    songTitle: string;
    chords: string[];
    url: string;
    summary?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const fetchCacheRef = useRef<Record<string, { detectedKey: string; songTitle: string; chords: string[]; url: string; summary?: string }>>({});
  const retryTimerRef = useRef<number | null>(null);


  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearInterval(retryTimerRef.current);
      }
    };
  }, []);

  // Sync playback rate to video element
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Auto apply analysis result if autoApply is true
  useEffect(() => {
    if (analysisResult) {
      if (autoApply) {
        applyAnalysis(false); // DO NOT play automatically as per user request
      }
      setAutoApply(false);
    }
  }, [analysisResult, autoApply]);

  // Speed steps: 0.8, 0.9, 1.0, 1.1, 1.2
  const SPEED_STEPS = [0.8, 0.9, 1.0, 1.1, 1.2];

  // Pitch shift label
  const PITCH_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const getShiftedKey = (base: string, shift: number) => {
    const idx = PITCH_NOTES.indexOf(base);
    if (idx === -1) return base;
    return PITCH_NOTES[(idx + shift + 12) % 12];
  };
  const currentVideoKey = getShiftedKey(originalKey, transposeAmount);
  const isCurrentGKey = currentVideoKey === 'G';
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  // ── SoundTouch pitch shifting ───────────────────────────────────────────────
  const semitoneToRatio = (n: number) => Math.pow(2, n / 12);

  // SoundTouch needs a source with an 'extract' method
  class AudioBufferSource {
    buffer: AudioBuffer;
    constructor(buffer: AudioBuffer) {
      this.buffer = buffer;
    }
    extract(target: Float32Array, numFrames: number, offset: number) {
      const channels = this.buffer.numberOfChannels;
      const channelDatas = [];
      for (let ch = 0; ch < channels; ch++) {
        channelDatas.push(this.buffer.getChannelData(ch));
      }

      const framesToCopy = Math.max(0, Math.min(numFrames, this.buffer.length - offset));

      for (let i = 0; i < framesToCopy; i++) {
        for (let ch = 0; ch < channels; ch++) {
          target[i * channels + ch] = channelDatas[ch][offset + i];
        }
      }

      // Zero out remaining frames
      if (framesToCopy < numFrames) {
        target.fill(0, framesToCopy * channels);
      }

      return framesToCopy;
    }
  }

  const stopPitched = () => {
    if (stNodeRef.current) {
      // Silence the callback FIRST so no more audio is generated
      try { (stNodeRef.current as any).onaudioprocess = null; } catch { }
      try { stNodeRef.current.disconnect(); } catch { }
      stNodeRef.current = null;
    }
    stFilterRef.current = null;
    stInstanceRef.current = null;
  };

  const ensureBuffer = async (): Promise<boolean> => {
    if (audioBufferRef.current) return true;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch 실패');
      const ab = await res.arrayBuffer();
      audioBufferRef.current = await audioCtxRef.current!.decodeAudioData(ab);
      return true;
    } catch { return false; }
  };

  // Restart the SoundTouch engine cleanly at the given position.
  // IMPORTANT: stopPitched() must be called before this to silence the old node.
  // We wait one audio-render quantum (≈11ms at 44100Hz / 512 frames) before
  // connecting the new node so the browser audio thread can finish flushing
  // any in-flight onaudioprocess callbacks from the old node — preventing overlap.

  // [오디오 튀는 현상 해결] 커스텀 WebAudio Node 생성기 (초고속 성능 튜닝)
  const createCustomSTNode = (context: AudioContext, filter: SimpleFilter) => {
    const BUFFER_SIZE = 8192; 
    const node = context.createScriptProcessor(BUFFER_SIZE, 2, 2);
    const combined = new Float32Array(BUFFER_SIZE * 2);
    
    node.onaudioprocess = (e) => {
      const left = e.outputBuffer.getChannelData(0);
      const right = e.outputBuffer.getChannelData(1);
      
      // 초고속 프레임 추출
      const framesExtracted = filter.extract(combined, BUFFER_SIZE);
      
      // 루프 최적화: TypedArray를 직접 처리하여 CPU 부하 감소
      for (let i = 0; i < framesExtracted; i++) {
        const i2 = i << 1;
        left[i] = combined[i2];
        right[i] = combined[i2 + 1];
      }
      
      if (framesExtracted < BUFFER_SIZE) {
        left.fill(0, framesExtracted);
        right.fill(0, framesExtracted);
      }
    };
    return node;
  };

  const playPitched = (transpose: number, cents: number, startAt: number) => {
    const ctx = audioCtxRef.current;
    const buf = audioBufferRef.current;
    if (!ctx || !buf) return;

    // 엔진 리셋 시 더 철저하게 초기화
    if (stNodeRef.current) {
      try { 
        (stNodeRef.current as any).onaudioprocess = null; 
        stNodeRef.current.disconnect(); 
      } catch (e) { }
      stNodeRef.current = null;
    }
    stFilterRef.current = null;
    stInstanceRef.current = null;

    const st = new SoundTouch(ctx.sampleRate);
    st.pitch = Math.pow(2, (transpose + cents / 100) / 12);
    st.tempo = playbackRate;
    stInstanceRef.current = st;

    const source = new AudioBufferSource(buf);
    const filter = new SimpleFilter(source, st);
    filter.sourcePosition = Math.round(startAt * ctx.sampleRate);
    stFilterRef.current = filter;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.02); // 페이드 살짝 늘림

    const stNode = createCustomSTNode(ctx, filter);
    stNodeRef.current = stNode;
    stNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    console.log(`🚀 [ENGINE] Optimized Playback Started: ${transpose}st with 8192 Buffer`);
  };

  const setupAudioPitch = async () => {
    if (isYoutube) {
      setError("💡 유튜브 영상은 실시간 키 변환을 지원하지 않습니다.");
      return;
    }
    if (audioInitialized.current || setupPendingRef.current) return;
    setupPendingRef.current = true;
    try {
      // [안정성 핵심] latencyHint를 'playback'으로 설정하여 버퍼 밀림 방지
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          latencyHint: 'playback'
        });
      }
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      const ok = await ensureBuffer();
      if (!ok) throw new Error('오디오 파일을 로드할 수 없습니다.');
      if (playerRef.current) playerRef.current.muted = true;
      pitchActiveRef.current = true;
      const startAt = playerRef.current?.currentTime ?? 0;
      if (!playerRef.current?.paused) await playPitched(transposeAmount, finePitchCents, startAt);
      audioInitialized.current = true;
      setError(null);
    } catch (e: any) {
      setError(`키 변환 엔진 연결 실패: ${e.message}`);
    } finally { setupPendingRef.current = false; }
  };

  // Helper: restart pitched playback using the VIDEO element's currentTime as the
  // source of truth for position (more accurate than stFilterRef.sourcePosition).
  const restartPitchedAtCurrentTime = (transpose: number, cents: number) => {
    if (!pitchActiveRef.current || !audioCtxRef.current || !audioBufferRef.current) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    // Use the video element's currentTime — it is always accurate regardless of
    // how many SoundTouch samples have been processed.
    const startAt = playerRef.current?.currentTime ?? 0;
    console.log(`🔄 Restart: ${transpose}st, ${cents}c at video=${startAt.toFixed(2)}s`);
    playPitched(transpose, cents, startAt);
  };

  // [핵심] 키 변환(Transpose)이나 미세 조정(Cents)이 바뀌면 즉시 오디오 엔진을 갱신합니다.
  useEffect(() => {
    if (!pitchActiveRef.current || !audioCtxRef.current || !audioBufferRef.current) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    
    // 연주 중이거나, 연주 대기 중일 때 바뀐 키를 즉시 엔진에 반영
    const startAt = playerRef.current?.currentTime ?? 0;
    console.log(`🎵 Pitch Sync: ${transposeAmount}st, ${finePitchCents}c at ${startAt.toFixed(2)}s`);
    playPitched(transposeAmount, finePitchCents, startAt);
  }, [transposeAmount, finePitchCents]);

  // Sync playbackRate into the active SoundTouch engine (no restart needed for tempo).
  // We DO restart here too because ScriptProcessorNode has no way to change tempo live.
  useEffect(() => {
    if (!pitchActiveRef.current || !audioCtxRef.current || !audioBufferRef.current) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    const startAt = playerRef.current?.currentTime ?? 0;
    playPitched(transposeAmount, finePitchCents, startAt);
  }, [playbackRate]);

  // Reset on song change
  useEffect(() => {
    stopPitched();
    setError(null); // 곡 변경 시 에러 초기화
    audioBufferRef.current = null;
    stInstanceRef.current = null;
    stFilterRef.current = null;
    audioInitialized.current = false;
    pitchActiveRef.current = false;
    if (playerRef.current) playerRef.current.muted = false;
    // Use the pending transpose (set by loadFromPlaylist/applyAnalysis) if available,
    // otherwise reset to 0. This prevents userTranspose from being wiped on song change.
    const savedTranspose = pendingTransposeRef.current;
    pendingTransposeRef.current = null; // consume it
    setTransposeAmount(savedTranspose ?? 0);
    setFinePitchCents(0);
  }, [url]);


  // Transpose semitones (chord display only)
  const semitones = getSemitonesBetween(originalKey, targetKey);

  const isGKey = (key: string) => {
    const normalized = key.replace(/Major|Minor|코드|Key|장조|단조|\s/gi, '').trim().toUpperCase();
    return normalized === 'G';
  };

  const clearRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      window.clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const getYoutubeThumbnailBase64 = async (videoUrl: string): Promise<string | null> => {
    const match = videoUrl.match(/[?&]v=([^&]+)/) || videoUrl.match(/youtu\.be\/([^?]+)/);
    if (!match) return null;
    const videoId = match[1];
    try {
      const response = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Failed to fetch YouTube thumbnail', e);
      return null;
    }
  };

  const startRetryCountdown = (input: string) => {
    clearRetryTimer();
    setRetryCountdown(60);
    setIsRetrying(true);
    setError('⏳ 너무 빨리 요청하였습니다. 자동 재시도 중입니다. 잠시만 기다려주세요.');

    retryTimerRef.current = window.setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          clearRetryTimer();
          setIsRetrying(false);
          setError('🔁 대기 시간이 끝났습니다. 자동으로 다시 시도합니다.');
          fetchChords(input);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const fetchChords = async (input: string) => {
    const normalizedInput = input.trim();
    if (!normalizedInput) return;

    if (retryTimerRef.current !== null) {
      setError(`⏳ 재시도 대기 중입니다. ${retryCountdown}초 후에 다시 시도합니다.`);
      return;
    }

    const cacheKey = normalizedInput.toLowerCase();
    const cached = fetchCacheRef.current[cacheKey];
    if (cached) {
      setAnalysisResult(cached);
      setError(null);
      setLoading(false);
      
      // Fix: Also trigger autoApply on cache hit
      if (autoApply) {
        setAutoApply(false);
        setTimeout(() => applyAnalysis(false), 500);
      }
      return;
    }

    setLoading(true);
    setAnalysisResult(null);
    setError(null);

    try {
      // SANITIZE: Trim the key to avoid hidden spaces
      const apiKey = (userApiKey || import.meta.env.VITE_GEMINI_API_KEY || '').trim();

      if (!apiKey || apiKey.length < 20) {
        setError("💡 AI 분석을 시작하려면 올바른 Gemini API 키가 필요합니다. 하단 설정에서 키를 확인해주세요.");
        setShowApiSettings(true);
        setLoading(false);
        return;
      }

      // Try multiple Gemini models in order from fastest/most stable to premium.
      const attempts = [
        { model: 'gemini-2.0-flash', apiVersion: 'v1beta' },    // Next gen (Fastest)
        { model: 'gemini-flash-latest', apiVersion: 'v1beta' }, // Most stable alias
        { model: 'gemini-pro-latest', apiVersion: 'v1beta' },   // High quality alias
        { model: 'gemini-1.5-flash', apiVersion: 'v1beta' }     // Rock solid stability
      ];

      let lastError = null;

      let base64Image = null;

      // Determine target URL for image capture
      let targetUrl = normalizedInput;
      const playlistMatch = playlist.find(p => p.title === normalizedInput || p.url === normalizedInput);
      if (playlistMatch && playlistMatch.url) {
        targetUrl = playlistMatch.url;
      } else if (url && (normalizedInput === songTitle || normalizedInput === url || normalizedInput.includes(songTitle))) {
        targetUrl = url;
      }

      if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
        base64Image = await getYoutubeThumbnailBase64(targetUrl);
        if (base64Image) console.log('YouTube thumbnail captured for AI analysis');
      } else if (playerRef.current && (targetUrl === url || targetUrl === songTitle)) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = playerRef.current.videoWidth || 640;
          canvas.height = playerRef.current.videoHeight || 360;
          const ctx = canvas.getContext('2d');
          if (ctx && canvas.width > 0) {
            ctx.drawImage(playerRef.current, 0, 0, canvas.width, canvas.height);
            base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            console.log('Video frame captured for AI analysis');
          }
        } catch (e) {
          console.warn('Failed to capture video frame', e);
        }
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const targetTitle = playlistMatch ? playlistMatch.title : (songTitle || normalizedInput);
      const promptText = `분석 대상: ${targetTitle}\n당신은 하모니카 및 색소폰 연주자를 위한 전문 음악 AI 비서입니다.\n\n[분석 지침]\n1. 먼저 전달된 썸네일 또는 캡처된 악보 이미지를 주의 깊게 분석하세요.\n2. 이미지 속 높은음자리표 옆의 조표(#, b)를 먼저 확인하고, 그 결과로 원곡 키(Original Key)를 판정하세요.\n3. 대표적인 코드 진행이 아닌, 곡 전체의 흐름을 알 수 있도록 마디별 또는 구절별 상세 코드 진행(최소 16개 이상)을 작성하세요.\n4. 분석 요약(summary) 작성 방법:\n  - 먼저 이미지 정보를 기준으로 키를 판단했음을 분명히 쓰세요.\n  - ⚠️ 중요: 샵(#)이나 플랫(b)이 하나도 없다면 원곡은 'C키'입니다! (조표가 없다고 해서 악보가 없는 것이 아닙니다.)\n  - 이미지를 보고 판단했다면 그 근거를 자연스럽게 설명하세요. (예: "화면의 악보를 보니 조표에 #이나 b가 없으므로 원곡은 C키 입니다." 또는 "악보에 #이 1개 있어 G키로 판단했습니다.")\n  - 이미지가 보이지 않거나 전혀 읽을 수 없을 때만 제목을 사용해 추정했다고 명시하세요.\n  - 요약의 마지막 줄에는 반드시 다음 문장을 추가하되, '[원곡 키]' 부분을 실제 판정된 키로 바꾸세요: "G키로 변환하여 연주하시려면, 반주기 하단의 키 선택에서 '[실제 원곡 키]'를 누르세요."\n\n반드시 아래 JSON 형식으로만 응답하세요:\n{\n  "songTitle": "곡 제목",\n  "key": "판단된 원곡 키 (예: C, Eb, F# 등)",\n  "chords": ["C", "G", "Am", "Em", "F", "C", "F", "G", ... (최소 16개 이상)],\n  "summary": "1. [키 판단 근거 설명]\\n2. G키로 변환하여 연주하시려면, 반주기 하단의 키 선택에서 '[실제 원곡 키]'를 누르세요."\n}`;

      const contentParts: any[] = [{ text: promptText }];
      if (base64Image) {
        contentParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        });
      } else {
        contentParts[0].text += '\n[시스템 경고: 악보 캡처 이미지가 제공되지 않았습니다. 반드시 제목과 정보를 바탕으로만 분석하세요.]';
      }

      for (const attempt of attempts) {
        try {
          console.log(`🚀 Trying AI Analysis with model: ${attempt.model} (${attempt.apiVersion})...`);
          
          // FIX: Use the model from the current attempt, NOT hardcoded
          const model = genAI.getGenerativeModel({ model: attempt.model });

          const generationConfig: any = {
            temperature: 0.1,
            maxOutputTokens: 2048,
          };
          
          if (attempt.apiVersion === 'v1beta') {
            generationConfig.responseMimeType = "application/json";
          }

          const result = await model.generateContent({
            contents: [{ role: 'user', parts: contentParts }],
            generationConfig
          });

          const response = await result.response;
          let text = response.text().trim();
          
          // Safer JSON extraction for all models
          if (text.includes('```')) {
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          }
          
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) text = jsonMatch[0];
          
          if (!text) {
            throw new Error('AI 응답이 비어있습니다.');
          }

          const parsedData = JSON.parse(text);

          const analysisResult = {
            detectedKey: parsedData.key || 'C',
            songTitle: parsedData.songTitle || normalizedInput,
            chords: parsedData.chords || [],
            url: playlistMatch?.url || (targetUrl.startsWith('http') ? targetUrl : normalizedInput),
            summary: parsedData.summary
          };

          fetchCacheRef.current[cacheKey] = analysisResult;
          setAnalysisResult(analysisResult);
          console.log(`✅ SUCCESS with ${attempt.model} (${attempt.apiVersion})`);
          setLoading(false);

          // Restore autoApply logic: if triggered via magnifying glass, apply automatically
          if (autoApply) {
            setAutoApply(false);
            console.log('⏳ Auto-applying analysis in 3 seconds...');
            // Increase delay so user can actually read the summary
            setTimeout(() => {
              console.log('🚀 Executing auto-apply now (no autoplay)');
              applyAnalysis(false); // Set to false to prevent auto-playing
            }, 3000); 
          }
          return;
        } catch (err: any) {
          console.warn(`Catch error for ${attempt.model} (${attempt.apiVersion}):`, err?.message || err);
          lastError = err;
          // If it's a 429 (Quota), we might want to break early, but let's try other models first
        }
      }
      throw lastError || new Error('모든 분석 시도 실패');
    } catch (err: any) {
      console.error('Failed to analyze:', err);
      let errorMsg = err.message || "분석 중 오류가 발생했습니다.";
      const isQuotaError = errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota exceeded') || errorMsg.toLowerCase().includes('too many requests') || errorMsg.toLowerCase().includes('quota');
      if (isQuotaError) {
        startRetryCountdown(normalizedInput);
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // 1. Search local playlist first (by title)
    const localMatch = playlist.find(item =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );

    if (localMatch) {
      loadFromPlaylist(localMatch);
      setSearchQuery('');
      return;
    }

    // 2. If not found in playlist, try AI analysis (URL or new title)
    fetchChords(query);
  };

  const applyAnalysis = (forcePlay: boolean = false) => {
    if (!analysisResult) return;

    const isSameUrl = url === analysisResult.url;

    // Find if the song is already in the playlist
    const existingMatch = playlist.find(p => p.url === analysisResult.url || p.title === analysisResult.songTitle);

    // [번화 보존 로직] 기존 제목에서 번호(01, 02 등)를 추출하여 보존합니다.
    const originalTitle = existingMatch ? existingMatch.title : analysisResult.songTitle;
    const numberMatch = originalTitle.match(/^\d+\s*/);
    const prefix = numberMatch ? numberMatch[0] : "";
    
    // AI 추천 제목 앞에 기존 번호를 붙입니다.
    const finalTitle = analysisResult.songTitle.startsWith(prefix.trim()) 
      ? analysisResult.songTitle 
      : prefix + analysisResult.songTitle;

    const newItem: PlaylistItem = {
      id: existingMatch ? existingMatch.id : Date.now().toString(),
      title: finalTitle,
      url: analysisResult.url,
      originalKey: analysisResult.detectedKey,
      chords: analysisResult.chords
    };

    console.log('📦 Applying Analysis:', newItem);
    
    // Set active values
    setUrl(newItem.url);
    setOriginalKey(newItem.originalKey);
    setChords(newItem.chords);
    setSongTitle(newItem.title);

    // Auto-calculate transpose to reach G for the user
    const autoTranspose = getDistanceToG(newItem.originalKey);
    console.log(`🎼 Auto-Transpose Calculated: ${autoTranspose} (Original: ${newItem.originalKey})`);
    
    // CRITICAL: Set pendingTransposeRef so the useEffect on [url] change doesn't reset it to 0
    pendingTransposeRef.current = autoTranspose;
    setTransposeAmount(autoTranspose);
    newItem.userTranspose = autoTranspose;

    // Auto-update playlist (add to top if new, update if exists)
    setPlaylist(prev => {
      const exists = prev.find(p => p.id === newItem.id);
      const nextPlaylist = exists 
        ? prev.map(p => p.id === newItem.id ? { ...p, ...newItem } : p)
        : [newItem, ...prev];
      
      // [영구 저장] 분석 즉시 localStorage에 기록합니다.
      localStorage.setItem('g-transpose-playlist', JSON.stringify(nextPlaylist));
      return nextPlaylist;
    });

    // [엔진 즉시 갱신] 곡이 같더라도 키가 바뀌었으므로 오디오 엔진을 새로 준비해야 할 수 있음
    if (isSameUrl && autoTranspose !== 0) {
      console.log('🔄 Same song but key changed, ensuring pitch shift is ready...');
      // force re-init of pitch shifter if needed
      if (playerRef.current) {
        // pause briefly to reset pitch state if needed, or trigger re-init
      }
    }

    setSearchQuery('');
    setMobileView('player');

    if (forcePlay) {
      if (isSameUrl) setPlaying(true);
      else setPendingPlay(true);
    }
  };

  const loadFromPlaylist = (item: PlaylistItem, forcePlay = true) => {
    console.log('🎵 Loading Song:', item.title, 'URL:', item.url);
    const isSameUrl = item.url === url;
    // Store the desired transpose BEFORE setUrl triggers the url-change useEffect
    pendingTransposeRef.current = item.userTranspose ?? 0;
    setUrl(item.url);
    setOriginalKey(item.originalKey);
    setChords(item.chords);
    setSongTitle(item.title);

    // Restore saved transpose for this song
    setTransposeAmount(item.userTranspose ?? 0);
    setFinePitchCents(0); // Reset fine tune on song change

    // Do NOT reorder on load, just set active states

    // setAnalysisResult(null); // REMOVED to prevent flickering
    setSearchQuery('');
    setMobileView('player');

    if (forcePlay) {
      if (isSameUrl) setPlaying(true);
      else setPendingPlay(true);
    } else {
      // 다른 곡으로 바꿀 때는 항상 일시정지 상태로 초기화
      // (이전 곡이 재생 중이었어도 playing=false로 리셋 → 플레이 버튼 항상 표시)
      if (!isSameUrl) setPlaying(false);
    }
  };

  const removeFromPlaylist = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm("정말로 이 곡을 재생 목록에서 삭제할까요?")) {
      setPlaylist(prev => prev.filter(item => item.id !== id));
    }
  };

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPlaylist(prev => prev.map(item =>
      item.id === id ? { ...item, isFavorite: !item.isFavorite } : item
    ));
  };

  // Reset key preference in sidebar
  const resetItemKey = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPlaylist(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, userTranspose: 0 };
      if (url === item.url) {
        setTransposeAmount(0);
        setFinePitchCents(0);
      }
      return updated;
    }));
  };

  // Sync playing state to native video element
  useEffect(() => {
    if (playerRef.current) {
      if (playing && playerRef.current.paused) {
        playerRef.current.play().catch(e => console.warn('Play interrupted:', e));
      } else if (!playing && !playerRef.current.paused) {
        playerRef.current.pause();
      }
    }
  }, [playing]);

  // Auto-clear error message after 8 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const detectKeyForItem = async (e: React.MouseEvent, item: PlaylistItem) => {
    e.stopPropagation();
    const apiKey = getApiKey();
    if (!apiKey) { setError('API 키가 없습니다. .env 파일에 VITE_GEMINI_API_KEY를 설정해주세요.'); return; }
    setDetectingIds(prev => new Set(prev).add(item.id));
    try {
      const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1' });
      const cleanTitle = item.title.replace(/^\d+\s*/, '');
      const attempts = ['gemini-2.5-flash', 'gemini-2.5', 'gemini-2.1', 'gemini-1.5-pro', 'gemini-1.5'];
      let responseText = '';

      for (const modelName of attempts) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: `한국 노래 '${cleanTitle}'의 원래 도 키(Original Key)를 알려주세요. 반드시 다음 JSON 형식으로만 응답하세요: { "key": "C, D, E, F, G, A, B 중 하나" }`,
            config: { temperature: 0.1, maxOutputTokens: 128 }
          });
          responseText = response.text || '';
          if (responseText) break;
        } catch (err) {
          console.warn(`Key detection failed on ${modelName}:`, err);
        }
      }

      if (!responseText) throw new Error('AI key detection에 실패했습니다.');

      const text = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(text);
      if (data.key) {
        const detected = data.key.toUpperCase().trim().replace('MAJOR', '').replace('장조', '').trim();
        const validKeys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const finalKey = validKeys.find(k => k === detected) || 'C';
        setPlaylist(prev => prev.map(p => p.id === item.id ? { ...p, originalKey: finalKey } : p));
      }
    } catch (err) {
      console.error('Key detection failed:', err);
    } finally {
      setDetectingIds(prev => { const next = new Set(prev); next.delete(item.id); return next; });
    }
  };

  const detectAllKeys = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setError('API 키가 없습니다.'); return; }
    setDetectingAll(true);
    const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1' });
    const targets = playlist.filter(item => item.url);
    const attempts = ['gemini-2.5-flash', 'gemini-2.5', 'gemini-2.1', 'gemini-1.5-pro', 'gemini-1.5'];
    for (const item of targets) {
      try {
        const cleanTitle = item.title.replace(/^\d+\s*/, '');
        let responseText = '';

        for (const modelName of attempts) {
          try {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: `한국 노래 '${cleanTitle}'의 원래 도 키(Original Key)를 알려주세요. 반드시 다음 JSON 형식으로만 응답하세요: { "key": "C, D, E, F, G, A, B 중 하나" }`,
              config: { temperature: 0.1, maxOutputTokens: 128 }
            });
            responseText = response.text || '';
            if (responseText) break;
          } catch (err) {
            console.warn(`Key detection failed on ${modelName}:`, err);
          }
        }

        if (!responseText) {
          throw new Error('AI key detection에 실패했습니다.');
        }

        const text = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(text);
        if (data.key) {
          const detected = data.key.toUpperCase().trim().replace('MAJOR', '').replace('장조', '').trim();
          const validKeys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const finalKey = validKeys.find(k => k === detected) || 'C';
          setPlaylist(prev => prev.map(p => p.id === item.id ? { ...p, originalKey: finalKey } : p));
        }
        await new Promise(r => setTimeout(r, 400));
      } catch (err) {
        console.error('Key detection failed for:', item.title, err);
      }
    }
    setDetectingAll(false);
  };

  // [성능 최적화] 화면 갱신 횟수를 줄여 오디오 엔진에 자원을 집중합니다.
  const handleProgress = (progress: any) => {
    if (progress && typeof progress.playedSeconds === 'number') {
      // 0.25초마다 업데이트하되, 정수 초가 바뀌었을 때만 상태를 반영하여 
      // 리액트의 무거운 화면 다시 그리기(Re-render) 횟수를 대폭 줄입니다.
      const newTime = progress.playedSeconds;
      if (Math.floor(newTime) !== Math.floor(currentTimeRef.current)) {
        setCurrentTime(newTime);
      }
      currentTimeRef.current = newTime;
    }
  };

  const handlePlayerReady = () => {
    if (pendingPlay) {
      setPlaying(true);
      setPendingPlay(false);
    }
  };

  // Determine which chord is active based on time (Defined above)


  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (playlistSearch) return; // Disable drag during search
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (playlistSearch || draggedId === id) return;
    setDragOverId(id);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (playlistSearch || !draggedId || draggedId === id) {
      handleDragEnd();
      return;
    }

    setPlaylist(prev => {
      const draggedIndex = prev.findIndex(item => item.id === draggedId);
      const dropIndex = prev.findIndex(item => item.id === id);
      if (draggedIndex === -1 || dropIndex === -1) return prev;

      const newPlaylist = [...prev];
      const [draggedItem] = newPlaylist.splice(draggedIndex, 1);
      newPlaylist.splice(dropIndex, 0, draggedItem);
      return newPlaylist;
    });

    handleDragEnd();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-indigo-500/30 overflow-x-hidden relative">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-900/30 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-900/30 rounded-full blur-[120px]" />
      </div>

      <div className={cn(
        "relative z-10 flex h-screen w-full p-4 md:p-6 gap-4 md:gap-6 overflow-hidden",
        "flex-col md:flex-row"
      )}>
        {/* 곡 목록 사이드바 */}
        <aside className={cn(
          "w-full md:w-80 lg:w-96 flex flex-col bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] overflow-hidden transition-all duration-500 ease-in-out z-20",
          mobileView === 'player' ? "hidden md:flex" : "flex h-full"
        )}>
          {/* Sidebar Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                  <Music className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-lg font-black text-white tracking-tight">G-TRANSPOSE</h1>
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Premium MR Player</p>
                </div>
              </div>
              
              {/* Mobile Shortcut back to player */}
              {url && (
                <button
                  onClick={() => setMobileView('player')}
                  className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 font-black text-[10px] active:scale-95 transition-all"
                >
                  <Tv className="w-3.5 h-3.5" />
                  플레이어
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
              <input
                type="text"
                placeholder="곡 제목 또는 가수 검색..."
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-3 text-xs text-white/70 focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-white/10"
              />
            </div>
          </div>

          {/* Playlist Content */}
          <div className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between px-1 mb-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setPlaylistTab('all')}
                  className={cn(
                    "text-xs font-bold uppercase tracking-widest transition-all",
                    playlistTab === 'all' ? "text-indigo-400" : "text-white/20 hover:text-white/40"
                  )}
                >
                  ALL ({playlist.length})
                </button>
                <button
                  onClick={() => setPlaylistTab('fav')}
                  className={cn(
                    "text-xs font-bold tracking-wide flex items-center gap-1.5 transition-all",
                    playlistTab === 'fav' ? "text-yellow-400" : "text-white/20 hover:text-white/40"
                  )}
                >
                  <Star className={cn("w-3 h-3", playlistTab === 'fav' ? "fill-yellow-400" : "")} />
                  FAVS
                </button>
              </div>
              <button
                onClick={resetCurrentSong}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-white/30 hover:text-red-400 transition-all"
                title="설정 초기화"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 custom-scrollbar flex-1">
              <AnimatePresence initial={false}>
                {filteredPlaylist.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => loadFromPlaylist(item, false)}
                    className={cn(
                      "w-full p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-left flex items-center gap-3 group cursor-pointer relative overflow-hidden",
                      url === item.url && "bg-indigo-500/10 border-indigo-500/30"
                    )}
                  >
                    <div className="w-9 h-9 shrink-0 flex items-center justify-center relative">
                      {getYoutubeThumbnailUrl(item.url || '') ? (
                        <img src={getYoutubeThumbnailUrl(item.url || '')!} className="w-full h-full rounded-lg object-cover opacity-80" alt="" />
                      ) : (
                        <div className="w-full h-full bg-white/5 rounded-lg flex items-center justify-center">
                          <Music className="w-4 h-4 text-white/20" />
                        </div>
                      )}
                      {url === item.url && <div className="absolute -left-2 w-1 h-4 bg-indigo-500 rounded-full" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-bold truncate", url === item.url ? "text-indigo-400" : "text-white/80")}>{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-white/20 uppercase font-bold">{item.originalKey || 'Key ?'}</span>
                        {item.userTranspose !== 0 && item.userTranspose !== undefined && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-md font-black">
                            {item.userTranspose > 0 ? `+${item.userTranspose}` : item.userTranspose}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => toggleFavorite(e, item.id)} className={cn("p-1.5 rounded-lg", item.isFavorite ? "text-yellow-400" : "text-white/20")}><Star className="w-3.5 h-3.5" /></button>
                      <button onClick={(e) => removeFromPlaylist(e, item.id)} className="p-1.5 text-white/20 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Sidebar Footer: Settings */}
          <div className="p-4 mt-auto border-t border-white/10 bg-black/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-bold text-white/40 tracking-wide uppercase">AI Engine Settings</span>
              </div>
              <button
                onClick={() => setShowApiSettings(!showApiSettings)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold px-2 py-1 bg-indigo-400/10 rounded-lg transition-all active:scale-95"
              >
                {showApiSettings ? '닫기' : '설정 열기'}
              </button>
            </div>

            <AnimatePresence>
              {showApiSettings && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-2 pt-2">
                    <input
                      type="password"
                      placeholder="Gemini API 키 입력..."
                      value={userApiKey}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setUserApiKey(val);
                        localStorage.setItem('GEMINI_API_KEY', val);
                      }}
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-white/90 focus:outline-none focus:border-indigo-500/50 transition-all"
                    />
                    
                    <button
                      onClick={() => {
                        if (window.confirm('모든 데이터를 지우고 기본 46곡 목록으로 초기화할까요?')) {
                          localStorage.removeItem('g-transpose-playlist');
                          window.location.reload();
                        }
                      }}
                      className="w-full py-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-[11px] font-black hover:bg-red-500/30 transition-all flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      곡 목록 초기화 (46곡 복구)
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>

        {/* 메인 연주 영역 */}
        <main className={cn(
          "flex-1 flex flex-col gap-4 md:gap-6 h-full overflow-y-auto pr-1 md:pr-0",
          mobileView === 'list' ? "hidden md:flex" : "flex"
        )}>
          {/* Mobile Back Button */}
          <div className="flex md:hidden items-center gap-3 mb-1">
            <button
              onClick={() => setMobileView('list')}
              className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-white/60 active:scale-95 transition-all flex items-center gap-2 text-sm font-bold shadow-lg"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
              곡 목록으로
            </button>
            <div className="flex-1 overflow-hidden">
              <p className="text-[11px] text-white/40 font-bold truncate tracking-tight">{songTitle || '선택된 곡 없음'}</p>
            </div>
          </div>

          {url && songTitle ? (
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl px-5 py-3 flex items-center justify-between shrink-0 shadow-xl">
              <div className="flex items-center gap-4 overflow-hidden">
                <div className="w-11 h-11 bg-indigo-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-indigo-500/30">
                  <Music className="w-6 h-6 text-indigo-400" />
                </div>
                <div className="overflow-hidden">
                  <h2 className="text-xl font-black text-white/90 truncate leading-tight">{songTitle}</h2>
                  <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Now Performing</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setAutoApply(true);
                  fetchChords(url || songTitle);
                }}
                disabled={loading}
                className="p-3 bg-white/5 border border-white/10 rounded-2xl text-indigo-400 hover:text-white hover:bg-indigo-500 transition-all active:scale-95 group disabled:opacity-50"
              >
                {loading ? <Search className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSearch} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-3 flex gap-3 shrink-0 shadow-2xl">
              <div className="relative flex-1 flex items-center">
                <Search className="absolute left-4 w-5 h-5 text-white/20" />
                <input
                  type="text"
                  placeholder="곡 제목이나 유튜브 링크를 입력하세요..."
                  className="w-full bg-transparent border-none focus:ring-0 text-sm pl-12 pr-4 text-white/80 placeholder:text-white/10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-2xl text-sm font-black flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all active:scale-95"
              >
                {loading ? <Search className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                분석 시작
              </button>
            </form>
          )}

          {/* Smart Analysis UI */}
          <AnimatePresence>
            {analysisResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="backdrop-blur-2xl bg-indigo-500/10 border border-indigo-500/30 rounded-[32px] p-6 flex flex-col items-center text-center gap-6 shadow-2xl"
              >
                <div className="flex flex-col items-center w-full max-w-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                      <Music className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-xl font-black">{analysisResult.songTitle}</h3>
                  </div>
                  
                  <div className="bg-white/5 border border-white/10 p-5 rounded-3xl w-full text-left">
                    <p className="text-indigo-100/90 text-sm leading-relaxed whitespace-pre-wrap">
                      💡 {analysisResult.summary
                        .replace(/1\.\s*/, '')      // 1. 제거
                        .split(/2\.\s*/)[0]         // 2. 이후 내용 삭제
                        .trim()}
                    </p>
                    <p className="text-green-400 text-xs font-bold mt-3 pt-3 border-t border-white/5">
                      ✓ 자동 G코드 변환되었습니다.
                    </p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={() => setAnalysisResult(null)}
                    className="w-12 h-12 bg-white/10 border border-white/20 rounded-2xl flex items-center justify-center hover:bg-white/20 transition-all active:scale-95 text-white/60 text-xs font-bold"
                    title="닫기"
                  >
                    닫기
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Video Player */}
          <div 
            ref={playerContainerRef}
            className={cn(
              "relative rounded-none overflow-hidden border border-white/10 bg-black group shrink-0 flex items-center justify-center transition-all shadow-2xl",
              isMobileLandscape && "fixed inset-0 z-[100] rounded-none border-none"
            )}
            style={{ aspectRatio: isMobileLandscape ? 'auto' : '16/9' }}
          >
            {isYoutube ? (
              <Player
                url={url} playing={playing} onProgress={handleProgress}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                onReady={handlePlayerReady} playbackRate={playbackRate}
                width="100%" height="100%" controls={true} className="absolute inset-0"
                onError={(e: any) => {
                  console.error('❌ Video Player Error:', e);
                  // [무한 루프 방지] 딱 한 번만 다른 확장자로 시도합니다.
                  const cacheKey = `fallback_${item.id}`;
                  if (!window._fallbackTried) window._fallbackTried = new Set();
                  
                  if (!window._fallbackTried.has(cacheKey)) {
                    window._fallbackTried.add(cacheKey);
                    if (url.endsWith('.mp4')) {
                      console.log('🔄 Trying .webm fallback...');
                      setUrl(url.replace('.mp4', '.webm'));
                    } else if (url.endsWith('.webm')) {
                      console.log('🔄 Trying .mp4 fallback...');
                      setUrl(url.replace('.webm', '.mp4'));
                    }
                  } else {
                    console.warn('⚠️ All video formats failed for this song.');
                  }
                }}
              />
            ) : (
              <video
                ref={playerRef} className="w-full h-full object-contain"
                src={url.includes('?') ? `${url}&t=0.001` : `${url}#t=0.001`}
                controls preload="auto" crossOrigin="anonymous"
                onTimeUpdate={(e: any) => handleProgress({ playedSeconds: e.target.currentTime })}
                onPlay={() => {
                  setPlaying(true);
                  if (playerRef.current) playerRef.current.playbackRate = playbackRate;
                  
                  // [핵심] 트랜스포즈가 설정되어 있는데 엔진이 꺼져 있다면 자동으로 가동합니다.
                  if (transposeAmount !== 0 || finePitchCents !== 0) {
                    if (!pitchActiveRef.current) {
                      console.log('🚀 Auto-starting pitch engine for saved transpose:', transposeAmount);
                      setupAudioPitch();
                    } else {
                      playPitched(transposeAmount, finePitchCents, playerRef.current?.currentTime ?? 0);
                    }
                  }
                }}
                onPause={() => {
                  setPlaying(false);
                  if (pitchActiveRef.current) stopPitched();
                }}
                onError={(e) => {
                  console.error('❌ Video Error:', e);
                  
                  // [지능형 로딩] 무한 루프 방지를 위해 곡 ID와 시도 단계 관리
                  const currentSong = playlist.find(p => url.includes(p.url.split('/').pop()?.split('.')[0] || '')) || { id: 'unknown', url: '' };
                  const songId = currentSong.id;
                  
                  if (!(window as any)._fallbackStep) (window as any)._fallbackStep = {};
                  const step = (window as any)._fallbackStep[songId] || 0;
                  
                  if (step < 4) { // 최대 4단계까지 시도
                    (window as any)._fallbackStep[songId] = step + 1;
                    
                    let nextUrl = url;
                    const fileName = url.split('/').pop() || '';
                    const baseName = fileName.split('.')[0];
                    const ext = fileName.split('.').pop();
                    
                    console.log(`🔄 Fallback Step ${step + 1} for ${songId}`);
                    
                    if (step === 0) {
                      // 1단계: 하이픈 주변 공백 제거/추가 반전 시도
                      if (baseName.includes(' - ')) nextUrl = url.replace(' - ', '-');
                      else if (baseName.includes('-')) nextUrl = url.replace('-', ' - ');
                    } else if (step === 1) {
                      // 2단계: 확장자 교체 (mp4 <-> webm)
                      nextUrl = url.endsWith('.mp4') ? url.replace('.mp4', '.webm') : url.replace('.webm', '.mp4');
                    } else if (step === 2) {
                      // 3단계: 가수 이름 빼고 제목만 시도 (숫자 유지)
                      const match = baseName.match(/^(\d+\s+)(.*)-(.*)$/);
                      if (match) nextUrl = url.replace(baseName, match[1] + match[3].trim());
                    } else if (step === 3) {
                      // 4단계: 최후의 수단 - 가장 단순한 형태
                      const match = baseName.match(/^(\d+)/);
                      if (match) {
                         // 숫자로 시작하는 파일이 있는지 추측 시도 (서버마다 다를 수 있음)
                         console.warn('Final attempt for song', songId);
                      }
                    }
                    
                    if (nextUrl !== url) {
                      console.log('➡️ Trying Next URL:', nextUrl);
                      setUrl(nextUrl);
                    }
                  } else {
                    console.error('🚫 All fallback attempts failed for:', songId);
                    setError(`'${currentSong.title}' 영상을 찾을 수 없습니다. 파일명이 서버와 일치하지 않을 수 있습니다.`);
                  }
                }}
              />
            )}

            {(!playing || playerRef.current?.paused) && (
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-10 cursor-pointer" onClick={() => playerRef.current?.play()}>
                <div className="w-24 h-24 bg-indigo-500/40 border border-white/30 rounded-full flex items-center justify-center backdrop-blur-xl hover:scale-110 transition-all shadow-2xl shadow-indigo-500/40">
                  <Play className="w-12 h-12 fill-white ml-2 text-white" />
                </div>
              </div>
            )}
          </div>

          {/* Chord Display - [성능 최적화] 별도 컴포넌트로 분리하여 화면 전체 Re-render 방지 */}
          {chords.length > 0 && (
            <ChordDisplay 
              chords={chords} 
              currentTime={currentTime} 
              transposeAmount={transposeAmount} 
            />
          )}
          {/* Transpose & Pitch Control Panel */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-6 shrink-0 shadow-xl mb-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-black uppercase tracking-widest text-white/60">Transpose & Pitch</span>
              </div>
              
              <div className="flex flex-col items-end gap-3 w-full">
                <div className="w-full overflow-x-auto no-scrollbar pb-2 px-1 snap-x">
                  <div className="flex items-center gap-2 min-w-max pr-4">
                    {NOTES.map(k => (
                    <button
                      key={k}
                      onClick={async () => {
                        if (!audioInitialized.current) await setupAudioPitch();
                        setOriginalKey(k);
                        updateTranspose(getDistanceToG(k));
                      }}
                      className={cn(
                        "min-w-[42px] h-11 rounded-xl text-[11px] font-black border transition-all active:scale-90 flex flex-col items-center justify-center snap-center",
                        k === originalKey ? "bg-indigo-600 border-indigo-400 text-white shadow-lg" : 
                        k === 'G' ? "bg-green-600/10 border-green-500/20 text-green-500/60" : 
                        "bg-white/5 border-white/10 text-white/30"
                      )}
                    >
                      <span className={cn(k === originalKey ? "text-sm" : "text-xs")}>{k}</span>
                      {k === originalKey && <span className="text-[6px] opacity-70 uppercase tracking-tighter">ORIG</span>}
                    </button>
                  ))}
                </div>
              </div>
                
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Sound:</span>
                  <span className={cn(
                    "text-xs font-black",
                    currentVideoKey === 'G' ? "text-green-500" : "text-orange-500"
                  )}>
                    {currentVideoKey}
                  </span>
                  {currentVideoKey === 'G' && (
                    <span className="ml-2 text-[9px] font-black text-green-500/80 tracking-widest px-1.5 py-0.5 rounded border border-green-500/30">
                      G-MODE
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white/90">Transpose</span>
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-tight">(조옮김 - 키 변경)</span>
                </div>
                <div className={cn(
                  "text-3xl font-black tabular-nums",
                  transposeAmount > 0 ? "text-indigo-400" : transposeAmount < 0 ? "text-purple-400" : "text-white/20"
                )}>
                  {transposeAmount > 0 ? `+${transposeAmount}` : transposeAmount}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    const next = Math.max(-12, transposeAmount - 1);
                    await setupAudioPitch();
                    updateTranspose(next);
                    restartPitchedAtCurrentTime(next, finePitchCents);
                  }}
                  className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-90 transition-all text-2xl font-bold flex-shrink-0 shadow-lg"
                >−</button>
                <div className="flex-1 relative py-6">
                  <input
                    type="range" min="-12" max="12" step="1"
                    value={transposeAmount}
                    onChange={async (e) => {
                      const next = Number(e.target.value);
                      if (!audioInitialized.current) await setupAudioPitch();
                      updateTranspose(next);
                    }}
                    className="w-full h-3 rounded-full accent-indigo-500 cursor-pointer"
                  />
                  {/* Tick ruler — absolute positioning with exact thumb-center formula:
                      left = calc(pct% + thumbWidth*(0.5 - pct/100))
                      This matches exactly where the browser renders the thumb center. */}
                  <div className="relative mt-1" style={{ height: '26px' }}>
                    {Array.from({ length: 25 }, (_, i) => i - 12).map(n => {
                      const pct = (n + 12) / 24 * 100;
                      const tw = 20; // Chrome accent-color thumb width ~20px
                      const offset = tw * (0.5 - pct / 100);
                      const isActive = n === transposeAmount;
                      return (
                        <div
                          key={n}
                          className="absolute flex flex-col items-center -translate-x-1/2"
                          style={{ left: `calc(${pct}% + ${offset}px)` }}
                        >
                          <div className={cn(
                            'w-px',
                            n === 0
                              ? 'h-3 bg-white/70'
                              : isActive
                                ? 'h-2.5 bg-indigo-400'
                                : 'h-1.5 bg-white/20'
                          )} />
                          <span className={cn(
                            'font-bold leading-none select-none whitespace-nowrap',
                            isActive
                              ? 'text-[9px] text-indigo-300'
                              : n % 6 === 0
                                ? 'text-[8px] text-white/40'
                                : n % 3 === 0
                                  ? 'text-[7px] text-white/20'
                                  : 'text-[6px] text-white/10'
                          )}>
                            {n > 0 ? `+${n}` : n}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>     {/* end flex-1 wrapper */}
                <button
                  onClick={async () => {
                    const next = Math.min(12, transposeAmount + 1);
                    await setupAudioPitch();
                    updateTranspose(next);
                    restartPitchedAtCurrentTime(next, finePitchCents);
                  }}
                  className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-90 transition-all text-2xl font-bold flex-shrink-0 shadow-lg"
                >+</button>
                {/* Large Reset button */}
                <button
                  onClick={() => { updateTranspose(0); restartPitchedAtCurrentTime(0, finePitchCents); }}
                  className="flex-shrink-0 px-6 py-4 rounded-2xl text-sm font-black border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-600 hover:text-white active:scale-95 transition-all shadow-[0_0_15px_rgba(79,70,229,0.1)]"
                >
                  초기화
                </button>
              </div>   {/* end flex items-center gap-3 */}
            </div>       {/* end mb-4 transpose section */}

            {/* ── PITCH (cents, secondary) ── */}
            <div className="opacity-60 hover:opacity-100 transition-opacity">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white/50">Pitch</span>
                  <span className="text-[10px] text-white/30">(미세 튜닝 - cents)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-base font-black w-14 text-center',
                    finePitchCents !== 0 ? 'text-yellow-400' : 'text-white/30'
                  )}>
                    {finePitchCents > 0 ? `+${finePitchCents}` : finePitchCents}c
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    await setupAudioPitch();
                    const next = Math.max(-50, finePitchCents - 1);
                    setFinePitchCents(next);
                    if (stInstanceRef.current) {
                      stInstanceRef.current.pitch = Math.pow(2, (transposeAmount + next / 100) / 12);
                    }
                  }}
                  className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 active:scale-95 transition-all text-xl font-bold flex-shrink-0"
                >−</button>
                <input
                  type="range" min="-50" max="50" step="1"
                  value={finePitchCents}
                  onChange={async (e) => {
                    await setupAudioPitch();
                    const next = Number(e.target.value);
                    setFinePitchCents(next);
                    if (stInstanceRef.current) {
                      stInstanceRef.current.pitch = Math.pow(2, (transposeAmount + next / 100) / 12);
                    }
                  }}
                  className="flex-1 h-1.5 rounded-full accent-yellow-600/50 cursor-pointer"
                />
                <button
                  onClick={async () => {
                    await setupAudioPitch();
                    const next = Math.min(50, finePitchCents + 1);
                    setFinePitchCents(next);
                    if (stInstanceRef.current) {
                      stInstanceRef.current.pitch = Math.pow(2, (transposeAmount + next / 100) / 12);
                    }
                  }}
                  className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 active:scale-95 transition-all text-xl font-bold flex-shrink-0"
                >+</button>
                <button
                  onClick={() => {
                    setFinePitchCents(0);
                    if (stInstanceRef.current) {
                      stInstanceRef.current.pitch = Math.pow(2, (transposeAmount) / 12);
                    }
                  }}
                  disabled={finePitchCents === 0}
                  className="flex-shrink-0 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-[10px] font-bold text-white/30 hover:bg-white/10 hover:text-white disabled:opacity-10 transition-all active:scale-95"
                >초기화</button>
              </div>
            </div>
          </div>

          {/* ──────── Speed Control Panel ──────── */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl px-5 py-4 shrink-0">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">SPEED</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SPEED_STEPS.map(s => (
                  <button
                    key={s}
                    onClick={() => setPlaybackRate(s)}
                    className={cn(
                      'flex-1 min-w-[60px] py-3 rounded-xl text-sm font-black border transition-all active:scale-95',
                      playbackRate === s
                        ? (s > 1 ? 'bg-orange-500 text-white border-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.3)]' : s < 1 ? 'bg-blue-500 text-white border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]')
                        : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                    )}
                  >
                    {s.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>

      </div>
    </div>
  );
}

