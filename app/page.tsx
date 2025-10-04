'use client';

import { nip19 } from 'nostr-tools';
import React, { useState, useRef, useEffect } from 'react';
import { Search, Play, Subtitles, AlertCircle, Loader2 } from 'lucide-react';

interface NostrEvent {
  kind: number;
  content: string;
  tags: string[][];
}

interface Segment {
  start: number;
  text: string;
}

const SubstrClient = () => {
  const [noteId, setNoteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [subtitles, setSubtitles] = useState<{time: number, text: string}[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [transcriptionCache, setTranscriptionCache] = useState<{[key: string]: {time: number, text: string}[]}>({});
  // Agrega este nuevo estado:
const [isTranscribing, setIsTranscribing] = useState(false);
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const audioChunksRef = useRef<Blob[]>([]);
const audioContextRef = useRef<AudioContext | null>(null);
const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
const videoRef = useRef<HTMLVideoElement>(null);

const handleResetApp = () => {
  setNoteId('');
  setVideoUrl('');
  setSubtitles([]);
  setCurrentSubtitle('');
  setError('');
  stopTranscription();
};

// Nueva función para capturar y transcribir audio
const startTranscription = async () => {
  try {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Reutilizar AudioContext si ya existe
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    // Solo crear source si no existe
    if (!sourceNodeRef.current) {
      const source = audioContextRef.current.createMediaElementSource(videoElement);
      const destination = audioContextRef.current.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioContextRef.current.destination);
      sourceNodeRef.current = source;

      // Configurar MediaRecorder
      // Intentar grabar en formato compatible con Hugging Face
const options = { mimeType: 'audio/webm;codecs=opus' };
const mediaRecorder = new MediaRecorder(destination.stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
  const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
  
  // Solo transcribir si el audio es mayor a 50KB
  if (audioBlob.size > 50000) {
    await transcribeAudio(audioBlob);
  } else {
    console.log('⚠️ Audio muy pequeño, omitiendo transcripción');
  }
  
  audioChunksRef.current = [];
};

    }

    // Iniciar grabación
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      mediaRecorderRef.current.start();
      
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          if (videoRef.current && !videoRef.current.paused) {
            startTranscription(); // Continuar grabando
          }
        }
      }, 4000);
    }

    setIsTranscribing(true);
  } catch (error) {
    console.error('Error iniciando transcripción:', error);
    setError('Error al capturar audio del video');
  }
};

const transcribeAudio = async (audioBlob: Blob) => {
  try {
    console.log('📤 Enviando audio a transcribir...', audioBlob.size, 'bytes');
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Error en respuesta:', errorData);
      throw new Error('Error en transcripción');
    }

    const data = await response.json();
    console.log('✅ Transcripción recibida:', data);
    
    // Procesar segmentos con timestamps
    if (data.segments) {
      const currentTime = videoRef.current?.currentTime || 0;
      const newSubtitles = data.segments.map((segment: Segment) => ({
        time: currentTime + segment.start,
        text: segment.text.trim()
      })).filter((sub: {time: number, text: string}) => sub.text);

      setSubtitles(prev => {
        const updated = [...prev, ...newSubtitles];
        // Guardar en cache
        setTranscriptionCache(cache => ({
          ...cache,
          [videoUrl]: updated
        }));
        return updated;
      });
    }
  } catch (error) {
  }
};

const stopTranscription = () => {
  if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
    mediaRecorderRef.current.stop();
  }
  setIsTranscribing(false);
};

// Nuevos handlers para el video
const handleVideoPlay = () => {
  const currentTime = videoRef.current?.currentTime || 0;
  
  // Verificar si ya tenemos transcripción para este rango de tiempo
  const hasTranscriptionForCurrentTime = subtitles.some(
    sub => sub.time >= currentTime - 10 && sub.time <= currentTime + 10
  );

  if (transcriptionCache[videoUrl] && transcriptionCache[videoUrl].length > 0) {
    console.log('✅ Usando transcripción en cache');
    setSubtitles(transcriptionCache[videoUrl]);
    
    // Si retrocedimos a una parte sin transcribir, continuar transcribiendo
    if (!hasTranscriptionForCurrentTime) {
      startTranscription();
    }
    return;
  }
  
  startTranscription();
};

const handleVideoPause = () => {
  stopTranscription();
  // No limpiar subtítulos, solo detener grabación
};

  // Relays de Nostr
  const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social'
  ];

  // Decodificar note ID (NIP-19)
  const decodeNoteId = (id: string) => {
  try {
    if (id.startsWith('note1')) {
      const decoded = nip19.decode(id);
      return { type: 'note', hex: decoded.data as string };
    }
    if (id.startsWith('nevent1')) {
      const decoded = nip19.decode(id);
      return { type: 'nevent', hex: (decoded.data as { id: string }).id };
    }
    if (/^[0-9a-f]{64}$/i.test(id)) {
      return { type: 'hex', hex: id };
    }
    return null;
  } catch (error) {
    console.error('Error decodificando ID:', error);
    return null;
  }
};

  // Conectar a relays y obtener evento
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
        let timeoutId: NodeJS.Timeout;

        ws.onopen = () => {
          const subscription = JSON.stringify([
            'REQ',
            'substr-' + Math.random(),
            { ids: [eventId] }
          ]);
          ws.send(subscription);
          timeoutId = setTimeout(() => {
            if (!eventFound) {
              ws.close();
              relayIndex++;
              tryRelay();
            }
          }, 5000); // 5 seconds per relay
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === 'EVENT') {
              eventFound = true;
              clearTimeout(timeoutId);
              ws.close();
              resolve(data[2] as NostrEvent);
            }
            if (data[0] === 'EOSE' && !eventFound) {
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
          relayIndex++;
          tryRelay();
        };
      };

      tryRelay();
    });
  };

  // Extraer URL de video del evento
  const extractVideoUrl = (event: NostrEvent) => {
    if (event.kind === 1063) {
      const urlTag = event.tags.find((tag: string[]) => tag[0] === 'url');
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

  // Modificar handleSearch para limpiar cache al cambiar video
const handleSearch = async () => {
  if (!noteId.trim()) return;

  setLoading(true);
  setError('');
  setVideoUrl('');
  setSubtitles([]);
  setCurrentSubtitle('');
  setTranscriptionCache({}); // 👈 Limpiar cache

    try {
      const decoded = decodeNoteId(noteId.trim());
      if (!decoded) {
        throw new Error('Formato de note ID inválido');
      }

      const event = await fetchNostrEvent(decoded.hex);
      const url = extractVideoUrl(event);

      if (!url) {
        throw new Error('No se encontró video en esta nota');
      }

      // Usar proxy para evitar problemas de CORS
const proxiedUrl = `/api/proxy-video?url=${encodeURIComponent(url)}`;
setVideoUrl(proxiedUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Modificar el efecto de subtítulos
useEffect(() => {
  if (!videoRef.current) return;

  const video = videoRef.current;
  const updateSubtitle = () => {
    const currentTime = video.currentTime;
    
    // Encontrar subtítulo activo (funciona hacia adelante Y atrás)
    const activeSubtitle = subtitles
      .filter(sub => sub.time <= currentTime && sub.time + 3 > currentTime) // 👈 Ventana de 3 seg
      .sort((a, b) => b.time - a.time)[0];
    
    if (activeSubtitle) {
      setCurrentSubtitle(activeSubtitle.text);
    } else {
      setCurrentSubtitle('');
    }
  };

  video.addEventListener('timeupdate', updateSubtitle);
  video.addEventListener('seeked', updateSubtitle); // 👈 AGREGAR ESTO para cuando retrocedes
  
  return () => {
    video.removeEventListener('timeupdate', updateSubtitle);
    video.removeEventListener('seeked', updateSubtitle); // 👈 AGREGAR ESTO
  };
}, [subtitles, videoUrl]);

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
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
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
              
              {/* Subtitles Overlay */}
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
                <h3 className="text-white font-semibold text-lg">
                  Historial de Subtítulos
                </h3>
                {isTranscribing && (
  <span className="ml-auto flex items-center gap-2 text-green-400 text-sm">
    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
    Transcribiendo...
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

        {/* Info */}
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