'use client';

import { nip19 } from 'nostr-tools';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Play, Subtitles, AlertCircle, Loader2 } from 'lucide-react';

interface NostrEvent {
  kind: number;
  content: string;
  tags: string[][];
}

const SAMPLE_RATE = 16000;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
];

const SubstrClient = () => {
  const [noteId, setNoteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [subtitles, setSubtitles] = useState<{ time: number; text: string }[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const realtimeClientRef = useRef<unknown>(null);
  const workletModuleAddedRef = useRef(false);
  const streamStartVideoTimeRef = useRef(0);

  const stopTranscription = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (realtimeClientRef.current) {
      const client = realtimeClientRef.current as { stopRecognition: (opts?: { noTimeout?: true }) => Promise<void> };
      realtimeClientRef.current = null;
      client.stopRecognition({ noTimeout: true }).catch(() => {});
    }
    setIsTranscribing(false);
  }, []);

  const startTranscription = useCallback(async () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    stopTranscription();

    try {
      // 1. Get temporary JWT from our server
      const jwtRes = await fetch('/api/speechmatics-jwt');
      if (!jwtRes.ok) throw new Error('No se pudo obtener token de Speechmatics');
      const { jwt, error: jwtError } = await jwtRes.json();
      if (jwtError) throw new Error(jwtError);

      // 2. Setup AudioContext (once, reused across videos)
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      }
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      // 3. Load AudioWorklet module (once)
      if (!workletModuleAddedRef.current) {
        await audioCtx.audioWorklet.addModule('/pcm-processor.js');
        workletModuleAddedRef.current = true;
      }

      // 4. Create a new worklet node for this stream
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
      workletNodeRef.current = workletNode;

      // 5. Connect audio graph — source node is tied to the video element, create once
      if (!sourceNodeRef.current) {
        const source = audioCtx.createMediaElementSource(videoElement);
        source.connect(audioCtx.destination); // keep audio playing
        source.connect(workletNode);
        sourceNodeRef.current = source;
      } else {
        sourceNodeRef.current.connect(workletNode);
      }

      // 6. Create Speechmatics real-time client (dynamic import for browser safety)
      const { RealtimeClient } = await import('@speechmatics/real-time-client');
      const client = new RealtimeClient();
      realtimeClientRef.current = client;

      // Record video time at stream start so we can align subtitle timestamps
      streamStartVideoTimeRef.current = videoElement.currentTime;

      // 7. Listen for transcription/translation events
      client.addEventListener('receiveMessage', (evt) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (evt as any).data as { message: string; results?: { content: string; start_time?: number }[]; reason?: string; type?: string };
        const msg = data.message;

        if (msg === 'AddPartialTranslation') {
          // Show partial results immediately for low latency
          const text = (data.results ?? []).map(r => r.content).join(' ').trim();
          if (text) setCurrentSubtitle(text);

        } else if (msg === 'AddTranslation') {
          // Store final results with video timestamps
          const results = data.results ?? [];
          if (results.length > 0) {
            const newSubs = results
              .filter(r => r.content?.trim())
              .map(r => ({
                time: streamStartVideoTimeRef.current + (r.start_time ?? 0),
                text: r.content.trim(),
              }));
            if (newSubs.length > 0) {
              setSubtitles(prev => [...prev, ...newSubs]);
            }
            const text = results.map(r => r.content).join(' ').trim();
            if (text) setCurrentSubtitle(text);
          }

        } else if (msg === 'AddPartialTranscript') {
          // Fallback to English partial if no translation yet
          const hasText = (data.results ?? []).some(r => r.content?.trim());
          if (hasText) {
            // Only show if we haven't received any translation partials
            // (translation partials will override this)
          }

        } else if (msg === 'Error') {
          console.error('Speechmatics error:', data);
          setError('Error de Speechmatics: ' + (data.reason ?? data.type ?? 'desconocido'));
          stopTranscription();
        }
      });

      // 8. Start recognition session
      await client.start(jwt, {
        transcription_config: {
          language: 'en',
          operating_point: 'enhanced',
          enable_partials: true,
        },
        translation_config: {
          target_languages: ['es'],
          enable_partials: true,
        },
        audio_format: {
          type: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: SAMPLE_RATE,
        },
      });

      // 9. Stream PCM audio from worklet to Speechmatics
      workletNode.port.onmessage = (event: MessageEvent) => {
        const currentClient = realtimeClientRef.current as { sendAudio: (data: ArrayBuffer) => void } | null;
        if (currentClient) {
          currentClient.sendAudio(event.data);
        }
      };

      setIsTranscribing(true);
    } catch (err) {
      console.error('Error iniciando transcripción:', err);
      setError('Error al iniciar la transcripción en tiempo real');
    }
  }, [stopTranscription]);

  // When video is seeked while paused, show the stored subtitle for that time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onSeeked = () => {
      if (isTranscribing) return;
      const t = video.currentTime;
      const active = subtitles
        .filter(s => s.time <= t && s.time + 5 > t)
        .sort((a, b) => b.time - a.time)[0];
      setCurrentSubtitle(active?.text ?? '');
    };

    video.addEventListener('seeked', onSeeked);
    return () => video.removeEventListener('seeked', onSeeked);
  }, [subtitles, isTranscribing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTranscription();
      audioContextRef.current?.close();
    };
  }, [stopTranscription]);

  const handleVideoPlay = () => {
    startTranscription();
  };

  const handleVideoPause = () => {
    stopTranscription();
  };

  const handleResetApp = () => {
    stopTranscription();
    audioContextRef.current?.close();
    audioContextRef.current = null;
    sourceNodeRef.current = null;
    workletModuleAddedRef.current = false;
    setNoteId('');
    setVideoUrl('');
    setSubtitles([]);
    setCurrentSubtitle('');
    setError('');
  };

  // Decode Nostr note ID (NIP-19)
  const decodeNoteId = (id: string) => {
    try {
      const cleanId = id.trim().replace(/^nostr:/, '');
      if (cleanId.startsWith('note1')) {
        const decoded = nip19.decode(cleanId);
        return { hex: decoded.data as string };
      }
      if (cleanId.startsWith('nevent1')) {
        const decoded = nip19.decode(cleanId);
        return { hex: (decoded.data as { id: string }).id };
      }
      if (/^[0-9a-f]{64}$/i.test(cleanId)) {
        return { hex: cleanId };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Connect to Nostr relays and fetch event
  const fetchNostrEvent = async (eventId: string): Promise<NostrEvent> => {
    return new Promise((resolve, reject) => {
      let relayIndex = 0;
      let eventFound = false;

      const tryRelay = () => {
        if (relayIndex >= RELAYS.length) {
          reject(new Error('No se pudo conectar a ningún relay'));
          return;
        }

        const ws = new WebSocket(RELAYS[relayIndex]);
        let timeoutId: ReturnType<typeof setTimeout>;

        ws.onopen = () => {
          ws.send(JSON.stringify(['REQ', 'substr-' + Math.random(), { ids: [eventId] }]));
          timeoutId = setTimeout(() => {
            if (!eventFound) {
              ws.close();
              relayIndex++;
              tryRelay();
            }
          }, 5000);
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === 'EVENT') {
              eventFound = true;
              clearTimeout(timeoutId);
              ws.close();
              resolve(data[2] as NostrEvent);
            } else if (data[0] === 'EOSE' && !eventFound) {
              clearTimeout(timeoutId);
              ws.close();
              relayIndex++;
              tryRelay();
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeoutId);
          ws.close();
          relayIndex++;
          tryRelay();
        };
      };

      tryRelay();
    });
  };

  // Extract video URL from Nostr event
  const extractVideoUrl = (event: NostrEvent): string | null => {
    if (event.kind === 1063) {
      const urlTag = event.tags.find(tag => tag[0] === 'url');
      if (urlTag) return urlTag[1];
    }
    if (event.kind === 1) {
      const urlRegex = /(https?:\/\/[^\s]+\.(mp4|webm|ogg|mov))/gi;
      const match = event.content.match(urlRegex);
      if (match) return match[0];
      const videoRegex = /(https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)[^\s]+)/gi;
      const videoMatch = event.content.match(videoRegex);
      if (videoMatch) return videoMatch[0];
    }
    return null;
  };

  const handleSearch = async () => {
    if (!noteId.trim()) return;

    setLoading(true);
    setError('');
    setVideoUrl('');
    setSubtitles([]);
    setCurrentSubtitle('');
    stopTranscription();

    try {
      const decoded = decodeNoteId(noteId.trim());
      if (!decoded) throw new Error('Formato de note ID inválido');

      const event = await fetchNostrEvent(decoded.hex);
      const url = extractVideoUrl(event);
      if (!url) throw new Error('No se encontró video en esta nota');

      const proxiedUrl = `/api/proxy-video?url=${encodeURIComponent(url)}`;
      setVideoUrl(proxiedUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Subtitles className="w-12 h-12 text-purple-300" />
            <h1
              className="text-5xl font-bold text-white cursor-pointer hover:text-purple-200 transition-colors"
              onClick={handleResetApp}
            >
              substr
            </h1>
          </div>
          <p className="text-purple-200 text-lg">
            Cliente Nostr con subtítulos automáticos en español
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-8">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl">
            <label className="block text-purple-200 mb-3 font-medium">
              Pega el Note ID del video:
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={noteId}
                onChange={(e) => setNoteId(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="note1... o nevent1... o ID hexadecimal"
                className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white placeholder-purple-300 border-2 border-purple-400/30 focus:border-purple-400 focus:outline-none"
                disabled={loading}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                Buscar
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/20 border-2 border-red-500 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-300" />
            <p className="text-red-100">{error}</p>
          </div>
        )}

        {/* Video Player */}
        {videoUrl && (
          <div className="bg-black/30 backdrop-blur-lg rounded-2xl overflow-hidden shadow-2xl">
            <div className="relative">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                className="w-full"
              />

              {/* Subtitle Overlay */}
              {currentSubtitle && (
                <div className="absolute bottom-16 left-0 right-0 text-center px-4 pointer-events-none">
                  <div className="inline-block bg-black/80 px-6 py-3 rounded-lg backdrop-blur-sm">
                    <p className="text-white text-xl font-semibold drop-shadow-lg">
                      {currentSubtitle}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Subtitle History */}
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Subtitles className="w-5 h-5 text-purple-300" />
                <h3 className="text-white font-semibold text-lg">Historial de Subtítulos</h3>
                {isTranscribing && (
                  <span className="ml-auto flex items-center gap-2 text-green-400 text-sm">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    En vivo
                  </span>
                )}
              </div>

              <div className="bg-white/5 rounded-xl p-4 max-h-64 overflow-y-auto">
                {subtitles.length === 0 ? (
                  <p className="text-purple-300 text-center py-4">
                    Los subtítulos aparecerán aquí mientras se reproduce el video
                  </p>
                ) : (
                  <div className="space-y-3">
                    {subtitles.map((sub, idx) => (
                      <div key={idx} className="flex gap-3 items-start">
                        <span className="text-purple-400 font-mono text-sm min-w-[60px]">
                          {Math.floor(sub.time / 60)}:{String(Math.floor(sub.time % 60)).padStart(2, '0')}
                        </span>
                        <p className="text-white">{sub.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Placeholder */}
        {!videoUrl && !loading && (
          <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 text-center">
            <Play className="w-16 h-16 text-purple-300 mx-auto mb-4" />
            <h3 className="text-white text-xl font-semibold mb-2">
              Comienza pegando un Note ID
            </h3>
            <p className="text-purple-200 max-w-md mx-auto">
              Copia el ID de cualquier nota de Nostr que contenga un video y pégalo arriba.
              substr generará subtítulos en español automáticamente usando reconocimiento de voz.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubstrClient;
