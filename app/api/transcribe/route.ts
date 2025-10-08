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
   
    // Log completo de la respuesta
    console.log('📦 Respuesta completa:', JSON.stringify(response, null, 2));

    // Extraer traducción al español
    let translatedText = '';
    let segments: any[] = [];

    // Verificar si la respuesta tiene traducciones
    const jsonResponse = response as any;
   
    console.log('🔍 Verificando traducciones disponibles...');
    console.log('📋 Keys en respuesta:', Object.keys(jsonResponse));
    console.log('🌍 Traducciones disponibles:', jsonResponse.translations ? Object.keys(jsonResponse.translations) : 'ninguna');
   
    if (jsonResponse.translations?.es) {
      console.log('✅ Traducción al español encontrada');
      const esTranslations = jsonResponse.translations.es;
      
      // La traducción viene como un array de objetos con content, start_time, end_time
      segments = esTranslations.map((item: any) => ({
        start: item.start_time,
        text: item.content
      }));
      
      translatedText = esTranslations.map((item: any) => item.content).join(' ');
      
      console.log('📝 Segmentos extraídos:', segments.length);
      console.log('🎯 Primer segmento:', segments[0]);
      console.log('📝 Texto completo:', translatedText);
    } else {
      console.log('⚠️ No se encontró traducción al español, usando transcripción original');
     
      // Usar transcripción original en inglés
      if (jsonResponse.results) {
        const words = jsonResponse.results?.filter((r: any) => r.type === 'word') || [];
       
        segments = words.map((r: any) => ({
          start: r.start_time,
          text: r.alternatives?.[0]?.content || '',
        }));
        
        translatedText = words
          .map((w: any) => w.alternatives?.[0]?.content || '')
          .join(' ');
       
        console.log('📝 Texto en inglés (sin traducción):', translatedText.substring(0, 80));
      }
    }

    console.log('📝 Retornando resultado:', { segments: segments.length, textLength: translatedText.length });

    return NextResponse.json({
      text: translatedText,
      segments: segments,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error completo:', error);
    return NextResponse.json(
      {
        error: 'Error al procesar el audio',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}