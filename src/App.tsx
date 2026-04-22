/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactPlayer from 'react-player';
import { SoundTouch, SimpleFilter, getWebAudioNode } from 'soundtouchjs';
import { GoogleGenAI } from "@google/genai";
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
  Youtube
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

interface PlaylistItem {
  id: string;
  title: string;
  url: string;
  originalKey: string;
  chords: string[];
  userTranspose?: number; // Saved transpose offset
}

export default function App() {
  const [url, setUrl] = useState('/music/hongsi.mp4');
  const [originalKey, setOriginalKey] = useState('C');
  const [targetKey, setTargetKey] = useState('G');
  const [chords, setChords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [songTitle, setSongTitle] = useState('아침이슬 (Morning Dew)');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [detectingIds, setDetectingIds] = useState<Set<string>>(new Set());
  const [detectingAll, setDetectingAll] = useState(false);
  const [transposeAmount, setTransposeAmount] = useState(0); 
  const [finePitchCents, setFinePitchCents] = useState(0);    
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [showApiSettings, setShowApiSettings] = useState(false);

  // Web Audio API refs (SoundTouch buffer approach)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const stNodeRef = useRef<ScriptProcessorNode | null>(null);
  const stInstanceRef = useRef<any>(null);   // SoundTouch instance (for real-time pitch)
  const stFilterRef = useRef<any>(null);     // SimpleFilter (for seeking)
  const pitchActiveRef = useRef(false);
  const setupPendingRef = useRef(false);
  const audioInitialized = useRef(false);
  // Stores the transpose value that should be applied AFTER a song change.
  // Prevents the url-change useEffect from overwriting userTranspose with 0.
  const pendingTransposeRef = useRef<number | null>(null);
  
  const R2 = 'https://pub-cb7f6167a48441ff8887d8509ae0a500.r2.dev/G-Transpose';
  // 한글·공백 파일명을 URL에서 안전하게 처리
  const r2 = (filename: string) => `${R2}/${encodeURIComponent(filename)}`;

  const INITIAL_PLAYLIST: PlaylistItem[] = [
    { id: 'p01', title: '01 홍시', url: r2('hongsi.mp4'), originalKey: 'C', chords: ['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C'] },
    { id: 'p02', title: '02 남자는 말합니다', url: r2('man.mkv'), originalKey: 'C', chords: [] },
    { id: 'p03', title: '03 가로수 그늘 아래 서면', url: r2('이문세 - 가로수 그늘 아래 서면 MR.webm'), originalKey: 'C', chords: [] },
    { id: 'p04', title: '04 고맙소', url: r2('조항조 - 고맙소 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p05', title: '05 님이여 (조용필)', url: r2('님이여.mp4'), originalKey: 'C', chords: [] },
    { id: 'p06', title: '06 홀로 아리랑', url: r2('서유석 - 홀로 아리랑 MR.webm'), originalKey: 'C', chords: [] },
    { id: 'p07', title: '07 물같이 바람같이', url: '', originalKey: 'C', chords: [] },
    { id: 'p08', title: '08 10월의 어느 멋진 날에', url: r2('10월의어느멋진날에.mp4'), originalKey: 'C', chords: [] },
    { id: 'p09', title: '09 칠갑산', url: r2('주병선 - 칠갑산 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p10', title: '10 내 사랑 내 곁에', url: r2('김현식 - 내 사랑 내 곁에 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p10-1', title: '10-1 내사랑내곁에', url: 'https://www.youtube.com/watch?v=kVLfDxAsLsY', originalKey: 'C', chords: [] },
    { id: 'p11', title: '11 약속', url: r2('백년의약속 김종환 G키 하모니카 악보 영상.mp4'), originalKey: 'C', chords: [] },
    { id: 'p12', title: '12 사랑을 위하여', url: r2('김종환 - 사랑을 위하여 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p13', title: '13 인연', url: r2('이선희 - 인연 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p14', title: '14 기억하나요', url: '', originalKey: 'C', chords: [] },
    { id: 'p15', title: '15 그대를 처음 본 순간', url: '', originalKey: 'C', chords: [] },
    { id: 'p16', title: '16 시계바늘', url: r2('16 신유 - 시계바늘 MR.mp4'), originalKey: 'C', chords: [] },
    { id: 'p17', title: '17 당신이 얼마나 내게', url: '', originalKey: 'C', chords: [] },
    { id: 'p18', title: '18 사랑새', url: '', originalKey: 'C', chords: [] },
    { id: 'p19', title: '19 초혼', url: '', originalKey: 'C', chords: [] },
    { id: 'p20', title: '20 장녹수', url: '', originalKey: 'C', chords: [] },
    { id: 'p21', title: '21 사랑으로', url: '', originalKey: 'C', chords: [] },
    { id: 'p22', title: '22 삼포로 가는 길', url: '', originalKey: 'C', chords: [] },
    { id: 'p23', title: '23 고맙다 인생아', url: '', originalKey: 'C', chords: [] },
    { id: 'p24', title: '24 아미새', url: '', originalKey: 'C', chords: [] },
    { id: 'p25', title: '25 고장난 벽시계', url: '', originalKey: 'C', chords: [] },
    { id: 'p26', title: '26 너를 사랑해', url: '', originalKey: 'C', chords: [] },
    { id: 'p27', title: '27 나는 행복한 사람', url: '', originalKey: 'C', chords: [] },
    { id: 'p28', title: '28 살다 보면 알게 돼', url: '', originalKey: 'C', chords: [] },
    { id: 'p29', title: '29 한오백년', url: '', originalKey: 'C', chords: [] },
    { id: 'p30', title: '30 건널 수 없는 강', url: '', originalKey: 'C', chords: [] },
    { id: 'p31', title: '31 등대지기', url: '', originalKey: 'C', chords: [] },
    { id: 'p32', title: '32 나 그대에게 모두 드리리', url: '', originalKey: 'C', chords: [] },
    { id: 'p33', title: '33 노들강변', url: '', originalKey: 'C', chords: [] },
    { id: 'p34', title: '34 아침이슬', url: 'https://www.youtube.com/watch?v=0_u_mC4u7X4', originalKey: 'C', chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'] },
    { id: 'p35', title: '35 뜨거운 안녕', url: '', originalKey: 'C', chords: [] },
    { id: 'p36', title: '36 내 마음 별과 같이', url: '', originalKey: 'C', chords: [] },
    { id: 'p37', title: '37 남자라는 이유로', url: '', originalKey: 'C', chords: [] },
    { id: 'p38', title: '38 사나이 눈물', url: '', originalKey: 'C', chords: [] },
    { id: 'p39', title: '39 동숙의 노래', url: '', originalKey: 'C', chords: [] },
    { id: 'p40', title: '40 울고 넘는 박달재', url: '', originalKey: 'C', chords: [] },
    { id: 'p41', title: '41 나그네 설움', url: '', originalKey: 'C', chords: [] },
    { id: 'p42', title: '42 푸른 하늘 은하수', url: '', originalKey: 'C', chords: [] },
    { id: 'p43', title: '43 나의 살던 고향은', url: '', originalKey: 'C', chords: [] },
    { id: 'p44', title: '44 애정이 꽃피던 시절', url: '', originalKey: 'C', chords: [] },
    { id: 'p45', title: '45 도라지 타령', url: '', originalKey: 'C', chords: [] },
    { id: 'p46', title: '46 고향무정', url: '', originalKey: 'C', chords: [] },
    { id: 'p47', title: '47 누이', url: '', originalKey: 'C', chords: [] },
    { id: 'p48', title: '48 데니보이', url: '', originalKey: 'C', chords: [] },
    { id: 'p49', title: '49 내 몫까지 살아주오', url: '', originalKey: 'C', chords: [] },
    { id: 'p50', title: '50 아름다운 것들', url: '', originalKey: 'C', chords: [] },
    { id: 'p51', title: '51 사랑 없인 난 못 살아요', url: '', originalKey: 'C', chords: [] },
    { id: 'p52', title: '52 못 잊을 사랑', url: '', originalKey: 'C', chords: [] },
    { id: 'p53', title: '53 가는 세월', url: '', originalKey: 'C', chords: [] },
    { id: 'p54', title: '54 꽃밭에 앉아서', url: '', originalKey: 'C', chords: [] },
    { id: 'p55', title: '55 천년바위', url: '', originalKey: 'C', chords: [] },
    { id: 'p56', title: '56 이 풍진 세상', url: '', originalKey: 'C', chords: [] }
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
            const merged = prev.map(item => {
              const match = parsed.find((p: any) => p.id === item.id);
              if (!match) return item;
              
              // [마이그레이션 로직]
              // 만약 브라우저에 저장된 주소가 로컬 경로(/music/)라면,
              // 이번에 업데이트한 클라우드(R2) 주소를 강제로 사용하게 합니다.
              const isLocalUrl = match.url && match.url.startsWith('/music/');
              const urlToUse = isLocalUrl ? item.url : (match.url || item.url);
              
              return { ...item, ...match, url: urlToUse };
            });
            
            // Auto-load the first item from the saved/merged list
            // We use setTimeout to ensure states are ready
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
    return playlist.filter(item => 
      item.title.toLowerCase().includes(playlistSearch.toLowerCase())
    );
  }, [playlist, playlistSearch]);

  const [analysisResult, setAnalysisResult] = useState<{ 
    detectedKey: string; 
    songTitle: string; 
    chords: string[];
    url: string;
    summary?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  

  const playerRef = useRef<HTMLVideoElement>(null);

  // Sync playback rate to video element
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Speed steps: 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5
  const SPEED_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
  const speedDown = () => {
    const idx = SPEED_STEPS.indexOf(playbackRate);
    if (idx > 0) setPlaybackRate(SPEED_STEPS[idx - 1]);
  };
  const speedUp = () => {
    const idx = SPEED_STEPS.indexOf(playbackRate);
    if (idx < SPEED_STEPS.length - 1) setPlaybackRate(SPEED_STEPS[idx + 1]);
  };

  // Pitch shift label
  const PITCH_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
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
      try { (stNodeRef.current as any).onaudioprocess = null; } catch {}
      try { stNodeRef.current.disconnect(); } catch {}
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
  const playPitched = (transpose: number, cents: number, startAt: number) => {
    const ctx = audioCtxRef.current;
    const buf = audioBufferRef.current;
    if (!ctx || !buf) return;

    // ★ 핵심: 구 노드의 onaudioprocess를 즉시 null로 설정
    // disconnect()만으로는 부족 — 콜백이 계속 실행되며 잡음을 유발함
    if (stNodeRef.current) {
      try { (stNodeRef.current as any).onaudioprocess = null; } catch {}
      try { stNodeRef.current.disconnect(); } catch {}
      stNodeRef.current = null;
    }
    stFilterRef.current = null;
    stInstanceRef.current = null;

    // 새 SoundTouch 엔진 생성
    const st = new SoundTouch(ctx.sampleRate);
    st.pitch = Math.pow(2, (transpose + cents / 100) / 12);
    st.tempo = playbackRate;
    stInstanceRef.current = st;

    const source = new AudioBufferSource(buf);
    const filter = new SimpleFilter(source, st);
    filter.sourcePosition = Math.round(startAt * ctx.sampleRate);
    stFilterRef.current = filter;

    // GainNode로 팝 노이즈 없이 15ms 페이드인 시작
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.015);

    const stNode = getWebAudioNode(ctx, filter);
    stNodeRef.current = stNode;
    stNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    console.log(`▶ playPitched (NoNoise): ${transpose}st at ${startAt.toFixed(2)}s`);
  };

  const setupAudioPitch = async () => {
    if (isYoutube) {
      setError("💡 유튜브 영상은 현재 실시간 키 변환(Transpose) 엔진을 지원하지 않습니다. 일반 재생만 가능합니다.");
      return;
    }
    if (audioInitialized.current || setupPendingRef.current) return;
    setupPendingRef.current = true;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
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

  const fetchChords = async (input: string) => {
    setLoading(true);
    setAnalysisResult(null);
    setError(null);
    try {
      const isUrl = input.startsWith('http');

      // Grab video frame if available to let AI "see" the sheet music
      let base64Image = null;
      if (playerRef.current && playerRef.current.videoWidth > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = playerRef.current.videoWidth;
          canvas.height = playerRef.current.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(playerRef.current, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            base64Image = dataUrl.split(',')[1];
          }
        } catch (e) {
          console.warn("Failed to capture video frame for AI:", e);
        }
      }

      const apiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        setError("💡 AI 분석을 시작하려면 Gemini API 키가 필요합니다. 하단 설정에서 키를 입력해주세요.");
        setShowApiSettings(true);
        setLoading(false);
        return;
      }

      const genAI = new GoogleGenAI({ apiKey });
      
      const parts: any[] = [
        { text: `유튜브 링크 혹은 곡 정보 '${input}'를 분석하여 기본 코드 진행과 원래 키(Key)를 알려주세요.
          
          응답 지침:
          1. 입력이 유튜브 링크라면 해당 영상에 대한 정보를 활용하여 "정확한 곡 제목"을 찾아주세요.
          2. 원래 키(Key)를 파악해주세요 (예: G, C, Eb 등).
          3. 대표적인 코드 진행 배열을 반환해주세요.
          4. G키 하모니카 연주자를 위한 조언을 작성해주세요. 감지된 원래 키에서 G키로 변환하려면 Transpose 수치를 몇으로 조절해야 하는지 계산하여 다음과 같은 형식으로 친절하게 작성해주세요. (예: "이 악보는 현재 F키 소리가 나고 있으니, G키 하모니카에 맞추려면 Transpose를 +2로 조절해 주시면 됩니다!")
          5. 반드시 다음 JSON 형식으로만 응답하세요, 다른 말은 하지 마세요:
          { 
            "songTitle": "실제 노래 제목", 
            "key": "원래키(C, D, E, F, G, A, B 중 하나)", 
            "chords": ["코드1", "코드2", "코드3", "코드4", "코드5", "코드6", "코드7", "코드8"],
            "summary": "작성한 조언 내용"
          }` 
        }
      ];

      if (base64Image) {
        parts.push({
          inlineData: {
            data: base64Image,
            mimeType: "image/jpeg"
          }
        });
        parts[0].text += "\n\n(중요 지침: 함께 첨부된 화면 캡처 이미지(악보 썸네일)를 반드시 확인하세요! 이미지에 적힌 조표와 Capo 설정 등을 종합적으로 분석하여 실제 귀에 들리는 연주 키를 정확히 파악해야 합니다.)";
      }

      const response = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        config: {
          responseMimeType: "application/json",
          temperature: 0.1
        },
        contents: [
          { role: "user", parts }
        ]
      });

      let text = response.text || '{}';
      
      // Sanitization: Remove markdown backticks if present
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const data = JSON.parse(text || '{}');
      if (data.chords && data.chords.length > 0) {
        setAnalysisResult({
          detectedKey: data.key || 'C',
          songTitle: data.songTitle || (isUrl ? "알 수 없는 곡" : input),
          chords: data.chords,
          url: isUrl ? input : url,
          summary: data.summary
        });
      } else {
        throw new Error("분석 결과에서 코드 정보를 찾을 수 없습니다.");
      }
    } catch (err: any) {
      console.error('Failed to analyze:', err);
      let errorMsg = err.message || "분석 중 오류가 발생했습니다.";
      
      // Catch specific 429 Quota Exceeded error
      if (errorMsg.includes('429') || errorMsg.includes('Quota exceeded') || errorMsg.includes('quota') || errorMsg.includes('429 Too Many Requests')) {
        errorMsg = "⏳ 너무 빨리 여러 번 요청하셨습니다! (무료 API는 1분에 15번까지만 허용됩니다.) 약 1분 뒤에 다시 시도해주세요.";
      }

      setError(errorMsg);
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
    const newItem: PlaylistItem = {
      id: Date.now().toString(),
      title: analysisResult.songTitle,
      url: analysisResult.url,
      originalKey: analysisResult.detectedKey,
      chords: analysisResult.chords
    };
    
    // Set active values
    setUrl(newItem.url);
    setOriginalKey(newItem.originalKey);
    setChords(newItem.chords);
    setSongTitle(newItem.title);
    
    // Auto-calculate transpose to reach G for the user
    const autoTranspose = getDistanceToG(newItem.originalKey);
    setTransposeAmount(autoTranspose);
    newItem.userTranspose = autoTranspose;

    // Auto-update playlist (add to top if new)
    setPlaylist(prev => {
      const exists = prev.find(p => p.id === newItem.id);
      if (exists) return prev.map(p => p.id === newItem.id ? newItem : p);
      return [newItem, ...prev];
    });
    
    setAnalysisResult(null);
    setSearchQuery('');
    setMobileView('player');
    
    if (forcePlay) {
      if (isSameUrl) setPlaying(true);
      else setPendingPlay(true);
    }
  };

  const loadFromPlaylist = (item: PlaylistItem, forcePlay = true) => {
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
    
    setAnalysisResult(null);
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
    setPlaylist(prev => prev.filter(item => item.id !== id));
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
      const genAI = new GoogleGenAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } });
      const cleanTitle = item.title.replace(/^\d+\s*/, '');
      const response = await model.generateContent(
        `한국 노래 '${cleanTitle}'의 원래 도 키(Original Key)를 알려주세요. 반드시 다음 JSON 형식으로만 응답하세요: { "key": "C, D, E, F, G, A, B 중 하나" }`
      );
      const text = response.response.text().replace(/```json/g,'').replace(/```/g,'').trim();
      const data = JSON.parse(text);
      if (data.key) {
        const detected = data.key.toUpperCase().trim().replace('MAJOR','').replace('장조','').trim();
        const validKeys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
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
    const targets = playlist.filter(item => item.url);
    for (const item of targets) {
      try {
        const genAI = new GoogleGenAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } });
        const cleanTitle = item.title.replace(/^\d+\s*/, '');
        const response = await model.generateContent(
          `한국 노래 '${cleanTitle}'의 원래 도 키(Original Key)를 알려주세요. 반드시 다음 JSON 형식으로만 응답하세요: { "key": "C, D, E, F, G, A, B 중 하나" }`
        );
        const text = response.response.text().replace(/```json/g,'').replace(/```/g,'').trim();
        const data = JSON.parse(text);
        if (data.key) {
          const detected = data.key.toUpperCase().trim().replace('MAJOR','').replace('장조','').trim();
          const validKeys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
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

  const handleProgress = (progress: any) => {
    if (progress && typeof progress.playedSeconds === 'number') {
      setCurrentTime(progress.playedSeconds);
    }
  };

  const handlePlayerReady = () => {
    if (pendingPlay) {
      setPlaying(true);
      setPendingPlay(false);
    }
  };

  // Determine which chord is active based on time
  const activeChordIndex = chords.length > 0 ? Math.floor(currentTime / 4) % chords.length : -1;

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
        <aside className={cn(
          "flex-col gap-4 h-full overflow-hidden",
          "w-full md:w-80",
          mobileView === 'player' ? "hidden md:flex" : "flex"
        )}>
          <div className="flex items-center justify-between pl-2 pr-1 mb-2 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                <Music className="text-white w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-white/90 leading-tight truncate">G-Transpose</h1>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono truncate">Auto Accompaniment</p>
              </div>
            </div>

            {/* Small Cute Shortcut: Back to Player */}
            {url && (
              <button
                onClick={() => setMobileView('player')}
                className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 font-black text-[10px] active:scale-95 transition-all shadow-sm shadow-indigo-500/10 shrink-0 ml-2"
              >
                <Tv className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">플레이어로</span>
              </button>
            )}
          </div>

          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col gap-4 overflow-hidden flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest">내 플레이리스트</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/20 font-mono">{filteredPlaylist.length} / {playlist.length}</span>
                <button
                  onClick={resetCurrentSong}
                  title="현재 곡의 키 설정을 초기화합니다"
                  className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-white/30 hover:bg-white/10 hover:text-red-400 transition-all"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
              <input 
                type="text"
                placeholder="곡 검색..."
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-[11px] text-white/70 focus:outline-none focus:border-indigo-500/50 transition-all"
              />
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
                      "w-full p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-left flex items-center justify-between group cursor-pointer",
                      url === item.url && "bg-indigo-500/10 border-indigo-500/30"
                    )}
                  >
                    <div className="overflow-hidden flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className={cn(
                          "text-sm font-medium truncate flex-1",
                          url === item.url ? "text-indigo-400" : "text-white/80"
                        )}>{item.title}</p>
                        <button
                          onClick={(e) => resetItemKey(e, item.id)}
                          title="클릭하면 키 설정 초기화"
                          className={cn(
                            "text-[9px] font-bold px-2 py-0.5 rounded-full border transition-all shrink-0",
                            (item.userTranspose !== 0 && item.userTranspose !== undefined)
                              ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30"
                              : "bg-white/10 border-white/20 text-white/30 hover:bg-white/20"
                          )}
                        >
                          {(item.userTranspose !== 0 && item.userTranspose !== undefined) ? (
                            <>
                              키
                              <span className="ml-1 text-white font-black">
                                ({item.userTranspose > 0 ? `+${item.userTranspose}` : item.userTranspose})
                              </span>
                            </>
                          ) : '키변경'}
                        </button>
                      </div>
                      {!item.url && <p className="text-[9px] text-white/20 italic">파일 없음</p>}
                    </div>
                    <button 
                      onClick={(e) => removeFromPlaylist(e, item.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all ml-1 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {playlist.length === 0 && (
                <div className="py-8 text-center border border-dashed border-white/5 rounded-2xl text-[10px] text-white/20 uppercase tracking-widest italic">
                  비어 있음
                </div>
              )}
            </div>
          </div>



          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-4 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Youtube className="w-4 h-4 text-red-500" /> 
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">YouTube</span>
              </div>
            </div>
            <div className="relative">
              <textarea 
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                placeholder="노래제목이나 url을 넣어세요"
                className="w-full h-20 bg-white/5 border border-white/10 rounded-xl p-3 text-[11px] font-mono text-white/70 focus:outline-none resize-none focus:border-indigo-500/30 transition-all"
              />
              <button 
                onClick={() => {
                  const currentSong = playlist.find(p => p.url === url);
                  const query = manualSearch.trim() || (currentSong ? currentSong.title : '');
                  if (query) {
                    fetchChords(query);
                    setManualSearch('');
                  }
                }}
                disabled={loading}
                className="absolute right-2 bottom-2 p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-lg transition-all shadow-lg active:scale-90"
                title="현재 재생 중인 곡 분석 시작"
              >
                {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>

        <main className={cn(
          "flex-1 flex flex-col gap-4 md:gap-6 h-full overflow-y-auto pr-2",
          mobileView === 'list' ? "hidden md:flex" : "flex"
        )}>
          {/* Mobile Back Button */}
          <div className="flex md:hidden items-center gap-3 mb-2">
            <button 
              onClick={() => setMobileView('list')}
              className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white/60 active:scale-95 transition-all flex items-center gap-2 text-sm font-bold"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
              곡 목록으로
            </button>
            <div className="flex-1 overflow-hidden">
              <p className="text-[10px] text-white/40 uppercase tracking-widest truncate">{songTitle || '선택된 곡 없음'}</p>
            </div>
          </div>

          {/* Gemini API Settings & Guide */}
          <div className="mt-auto pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Gemini AI 설정</span>
              </div>
              <button 
                onClick={() => setShowApiSettings(!showApiSettings)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
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
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                        <Info className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div className="text-[11px] leading-relaxed text-white/60">
                        <p className="font-bold text-white/90 mb-1">🤖 직접 API 키를 발급받아 사용하세요!</p>
                        <p>이 기능은 구글 AI를 사용하여 곡을 분석합니다. 지인분께서 직접 키를 발급받으시면 무료(분당 15회)로 무제한 사용이 가능합니다.</p>
                        <a 
                          href="https://aistudio.google.com/app/apikey" 
                          target="_blank" 
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-400 hover:underline mt-2 font-bold"
                        >
                          무료 API 키 발급받기 (Google AI Studio) <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="password" 
                        placeholder="여기에 API 키를 입력하세요..."
                        value={userApiKey}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setUserApiKey(val);
                          localStorage.setItem('GEMINI_API_KEY', val);
                        }}
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs text-white/90 focus:outline-none focus:border-indigo-500/50"
                      />
                      {userApiKey && (
                        <button 
                          onClick={() => {
                            setUserApiKey('');
                            localStorage.removeItem('GEMINI_API_KEY');
                          }}
                          className="px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-xs font-bold"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {url && songTitle ? (
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl px-4 py-2.5 flex items-center justify-between shrink-0 shadow-lg">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 bg-indigo-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-indigo-500/30">
                  <Music className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="overflow-hidden">
                  <h2 className="text-lg font-black text-white/90 truncate">{songTitle}</h2>
                  <p className="text-[9px] text-white/30 uppercase tracking-widest font-bold">현재 재생 중</p>
                </div>
              </div>
              <button 
                onClick={() => { setUrl(''); setSongTitle(''); }} 
                className="p-2.5 bg-white/5 border border-white/10 rounded-2xl text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-95 group"
                title="새로 검색하기"
              >
                <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSearch} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-2 flex gap-2 shrink-0">
              <div className="relative flex-1 flex items-center">
                <Search className="absolute left-4 w-4 h-4 text-white/30" />
                <input 
                  type="text" 
                  placeholder="곡 제목 혹은 유튜브 링크를 입력 및 분석..."
                  className="w-full bg-transparent border-none focus:ring-0 text-sm pl-12 pr-4 text-white/80"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Plus className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {loading ? "분석 중..." : "분석 시작"}
              </button>
            </form>
          )}

          {/* Error Message */}
                            {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-xs flex items-center gap-3"
              >
                <Info className="w-4 h-4 shrink-0" />
                <p>{error}</p>
                <button onClick={() => setError(null)} className="ml-auto text-red-400/50 hover:text-red-400">닫기</button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Smart Analysis Result UI */}
          <AnimatePresence>
            {analysisResult && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="backdrop-blur-2xl bg-indigo-500/10 border border-indigo-500/30 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-6"
              >
                <div className="flex items-center gap-4">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", isGKey(analysisResult.detectedKey) ? "bg-green-500/20" : "bg-orange-500/20")}>
                    <Music className={isGKey(analysisResult.detectedKey) ? "text-green-400" : "text-orange-400"} />
                  </div>
                  <div className="flex-1 max-w-xl">
                    <h3 className="text-lg font-bold">분석 완료: {analysisResult.songTitle}</h3>
                    <p className="text-white/40 text-sm mb-2">감지된 키: <span className="text-indigo-400 font-bold">{analysisResult.detectedKey}</span></p>
                    {analysisResult.summary && (
                      <div className="bg-indigo-500/20 border border-indigo-500/30 p-3 rounded-xl">
                        <p className="text-indigo-200 text-sm leading-relaxed whitespace-pre-wrap">
                          💡 {analysisResult.summary}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => applyAnalysis(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
                    {isGKey(analysisResult.detectedKey) ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRightLeft className="w-4 h-4" />}
                    {isGKey(analysisResult.detectedKey) ? "바로 재생하기" : "G코드로 변환해서 재생하기"}
                  </button>
                  <button onClick={() => setAnalysisResult(null)} className="p-3 bg-white/5 border border-white/10 rounded-2xl"><Trash2 className="w-4 h-4 text-white/30" /></button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 메인 플레이어 영역 */}
          <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-black group shrink-0 flex items-center justify-center">
            {isYoutube ? (
              <Player
                url={url}
                playing={playing}
                onProgress={handleProgress}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onReady={handlePlayerReady}
                playbackRate={playbackRate}
                width="100%"
                height="100%"
                controls={true}
                className="absolute inset-0"
              />
            ) : (
              <video 
                ref={playerRef}
                className="w-full h-full outline-none object-contain"
                src={url.includes('?') ? `${url}&t=0.001` : `${url}#t=0.001`}
                controls
                preload="auto"
                onTimeUpdate={(e: any) => handleProgress({ playedSeconds: e.target.currentTime })}
                onPlay={() => { 
                  setPlaying(true);
                  if (playerRef.current) playerRef.current.playbackRate = playbackRate;
                  // Resume pitch-shifted buffer if active
                  if (pitchActiveRef.current) {
                    const startAt = playerRef.current?.currentTime ?? 0;
                    playPitched(transposeAmount, finePitchCents, startAt);
                  }
                }}
                onPause={() => {
                  setPlaying(false);
                  if (pitchActiveRef.current) stopPitched();
                }}
                onSeeked={(e: any) => {
                  // Restart buffer from new position
                  if (pitchActiveRef.current && !playerRef.current?.paused) {
                    playPitched(transposeAmount, finePitchCents, e.target.currentTime);
                  }
                }}
                onError={(e: any) => {
                  console.error('Video error:', e);
                  setError('영상을 재생할 수 없습니다. 코덱 미지원(H.265 등) 혹은 파일 오류일 수 있습니다.');
                  setPlaying(false);
                }}
              />
            )}
            
            {/* 플레이 버튼: playing 상태가 false이거나 실제 비디오가 멈춰 있으면 항상 표시 */}
            {(!playing || playerRef.current?.paused) && (
              <div 
                className="absolute inset-0 bg-black/5 flex items-center justify-center cursor-pointer z-10"
                onClick={() => playerRef.current?.play()}
              >
                <div className="w-20 h-20 bg-indigo-500/40 border border-white/40 rounded-full flex items-center justify-center backdrop-blur-md hover:scale-110 transition-all shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                  <Play className="w-10 h-10 fill-white ml-1 text-white" />
                </div>
              </div>
            )}

            {/* Video Controls Bar */}
            <div className={cn(
              "absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-8 flex items-center justify-between gap-4 transition-opacity pointer-events-none",
              (!playing || loading) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}>
              {/* Speed Control */}
              <div className="flex items-center gap-2 pointer-events-auto">
                <span className="text-[10px] text-white/50 uppercase tracking-widest">속도</span>
                <button onClick={speedDown} disabled={playbackRate <= 0.5} className="w-7 h-7 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 transition-all text-sm font-bold">−</button>
                <span className={cn('text-sm font-bold w-10 text-center', playbackRate === 1.0 ? 'text-white/60' : playbackRate > 1.0 ? 'text-orange-400' : 'text-blue-400')}>{playbackRate.toFixed(1)}x</span>
                <button onClick={speedUp} disabled={playbackRate >= 1.5} className="w-7 h-7 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 transition-all text-sm font-bold">+</button>
                {playbackRate !== 1.0 && (
                  <button onClick={() => setPlaybackRate(1.0)} className="text-[10px] text-white/40 hover:text-white/80 ml-1 transition-colors">리셋</button>
                )}
              </div>

              {/* Key/Pitch Info */}
              <div className="flex items-center gap-3 pointer-events-auto">
                <span className="text-[10px] text-white/50 uppercase tracking-widest">원본 키</span>
                <div className={cn('px-3 py-1 rounded-lg text-xs font-bold border', currentVideoKey === 'G' ? 'bg-green-500/20 border-green-500/40 text-green-400' : 'bg-orange-500/20 border-orange-500/40 text-orange-400')}>
                  {originalKey}
                </div>
                {currentVideoKey !== 'G' && (
                  <>
                    <ArrowRightLeft className="w-3 h-3 text-white/30" />
                    <div className="px-3 py-1 rounded-lg text-xs font-bold border bg-indigo-500/20 border-indigo-500/40 text-indigo-400">
                      G (목표)
                    </div>
                  </>
                )}
                {currentVideoKey === 'G' && (
                  <span className="text-[10px] text-green-400">✓ G키</span>
                )}
              </div>
            </div>
          </div>

          {/* ──────── Transpose & Pitch Control Panel ──────── */}
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl px-5 py-4 shrink-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-white/70">Transpose / Pitch</span>
              </div>
              
              {/* G-Key Target Ruler (Always Visible & Mobile Scrollable) */}
              <div className="flex flex-col items-start md:items-end gap-3 w-full md:w-auto">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full md:w-auto pb-1 px-1 -mx-1">
                  {NOTES.map(k => {
                    const isActive = k === originalKey;
                    const isGoal = k === 'G';
                    return (
                      <button
                        key={k}
                        onClick={async () => {
                          if (!audioInitialized.current) await setupAudioPitch();
                          const dist = getDistanceToG(k);
                          setOriginalKey(k);
                          updateTranspose(dist); 
                        }}
                        className={cn(
                          "min-w-[40px] md:min-w-[36px] h-10 md:h-9 rounded-xl text-[11px] font-black border transition-all active:scale-90 flex items-center justify-center shadow-sm shrink-0",
                          isActive 
                            ? "bg-indigo-500 border-indigo-400 text-white shadow-indigo-500/40" 
                            : isGoal
                              ? "bg-green-500/20 border-green-500/40 text-green-400"
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                        )}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 self-end">
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest">현재 소리:</span>
                  <div className={cn(
                    'px-3 py-1 rounded-lg text-sm font-black border flex items-center gap-2',
                    currentVideoKey === 'G'
                      ? 'bg-green-500/30 border-green-400/50 text-green-300'
                      : 'bg-orange-500/20 border-orange-400/40 text-orange-300'
                  )}>
                    {currentVideoKey}
                    {currentVideoKey === 'G' && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                </div>
              </div>
            </div>

            {/* ── TRANSPOSE (primary) ── */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-white/90">Transpose</span>
                  <span className="text-[10px] text-white/40">(조옮김 - 키 변경)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-lg font-black w-12 text-center',
                    transposeAmount > 0 ? 'text-indigo-400' : transposeAmount < 0 ? 'text-purple-400' : 'text-white/40'
                  )}>
                    {transposeAmount > 0 ? `+${transposeAmount}` : transposeAmount}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => { 
                    const next = Math.max(-12, transposeAmount - 1);
                    if (!audioInitialized.current) await setupAudioPitch();
                    updateTranspose(next);
                  }}
                  className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-90 transition-all text-2xl font-bold flex-shrink-0 shadow-lg"
                >−</button>
                <div className="flex-1 flex flex-col">
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
