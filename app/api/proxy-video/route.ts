import { NextRequest, NextResponse } from 'next/server';

// Agregar handler para OPTIONS (preflight CORS)
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url');
    
    if (!url) {
      return NextResponse.json(
        { error: 'URL no proporcionada' },
        { status: 400 }
      );
    }

    console.log('🎥 Obteniendo video desde:', url);

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Error al obtener el video');
    }

    const videoBuffer = await response.arrayBuffer();
    
    console.log('✅ Video obtenido, tamaño:', videoBuffer.byteLength, 'bytes');
    
    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('❌ Error en proxy de video:', error);
    return NextResponse.json(
      { error: 'Error al procesar el video' },
      { status: 500 }
    );
  }
}