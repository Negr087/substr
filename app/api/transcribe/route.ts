import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// Función para traducir texto a español
async function translateToSpanish(text: string): Promise<string> {
  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-en-es',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!response.ok) {
      console.error('❌ Error en traducción');
      return text; // Devolver texto original si falla
    }

    const result = await response.json();
    return result[0]?.translation_text || text;
  } catch (error) {
    console.error('❌ Error traduciendo:', error);
    return text; // Devolver texto original si falla
  }
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
    const audioBuffer = await audioFile.arrayBuffer();

    // Paso 1: Transcribir audio con Whisper
    const transcriptionResponse = await fetch(
      'https://api-inference.huggingface.co/models/openai/whisper-large-v3',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBuffer,
      }
    );

    if (!transcriptionResponse.ok) {
      const errorText = await transcriptionResponse.text();
      console.error('❌ Error de Hugging Face:', errorText);
      throw new Error(`API error: ${transcriptionResponse.status} - ${errorText}`);
    }

    const transcriptionResult = await transcriptionResponse.json();
    console.log('✅ Transcripción completada');

    // Paso 2: Traducir cada segmento a español
    const segments = transcriptionResult.chunks || [{ timestamp: [0], text: transcriptionResult.text }];
    
    const translatedSegments = await Promise.all(
      segments.map(async (chunk: any) => {
        const translatedText = await translateToSpanish(chunk.text);
        console.log(`🌐 "${chunk.text}" → "${translatedText}"`);
        return {
          start: chunk.timestamp[0],
          text: translatedText
        };
      })
    );

    const responseData = {
      text: translatedSegments.map(s => s.text).join(' '),
      segments: translatedSegments
    };

    return NextResponse.json(responseData);

  } catch (error: any) {
    console.error('❌ Error completo:', error);
    return NextResponse.json(
      { error: 'Error al procesar el audio', details: error.message },
      { status: 500 }
    );
  }
}