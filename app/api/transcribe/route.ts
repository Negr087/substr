import { NextRequest, NextResponse } from 'next/server';
import { BatchClient } from '@speechmatics/batch-client';

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No se proporcionó archivo de audio' },
        { status: 400 }
      );
    }

    console.log('🎙️ Transcribiendo audio...', audioFile.size, 'bytes');

    // Crear cliente de Speechmatics
    const client = new BatchClient({
      apiKey: process.env.SPEECHMATICS_API_KEY!,
      appId: 'substr-nostr-client',
    });

    console.log('📤 Enviando a Speechmatics...');

    // Transcribir con traducción
    const response = await client.transcribe(
      audioFile,
      {
        transcription_config: {
          language: 'en',
          operating_point: 'enhanced',
        },
        translation_config: {
          target_languages: ['es'],
        },
      },
      'json-v2'
    );

    console.log('✅ Transcripción completada');

    // Extraer traducción al español
    let translatedText = '';
    let segments: any[] = [];

    // Verificar si la respuesta tiene traducciones
    const jsonResponse = response as any;
    
    if (jsonResponse.translations?.es) {
      const esTranslation = jsonResponse.translations.es as any;
      
      // Extraer palabras traducidas
      const words = esTranslation.results?.filter((r: any) => r.type === 'word') || [];
      
      segments = words.map((r: any) => ({
        start: r.start_time,
        text: r.alternatives?.[0]?.content || '',
      }));

      translatedText = words
        .map((w: any) => w.alternatives?.[0]?.content || '')
        .join(' ');
    }

    // Fallback: usar transcripción original en inglés si no hay traducción
    if (!translatedText && jsonResponse.results) {
      const words = jsonResponse.results?.filter((r: any) => r.type === 'word') || [];
      
      segments = words.map((r: any) => ({
        start: r.start_time,
        text: r.alternatives?.[0]?.content || '',
      }));

      translatedText = words
        .map((w: any) => w.alternatives?.[0]?.content || '')
        .join(' ');
    }

    console.log('📝 Texto traducido:', translatedText.substring(0, 80) + '...');

    return NextResponse.json({
      text: translatedText,
      segments: segments,
    });

  } catch (error: any) {
    console.error('❌ Error completo:', error);
    return NextResponse.json(
      { 
        error: 'Error al procesar el audio', 
        details: error.message || String(error) 
      },
      { status: 500 }
    );
  }
}