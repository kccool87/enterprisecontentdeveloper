import { NextRequest, NextResponse } from 'next/server';

interface GeminiPart {
  inlineData?: { mimeType: string; data: string };
  text?: string;
}

interface GeminiCandidate {
  content: { parts: GeminiPart[] };
}

function generateSvgPlaceholder(alt: string): string {
  const label = alt.length > 52 ? alt.slice(0, 49) + '…' : alt;
  const escaped = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#161a2e"/>
  <rect x="4" y="4" width="1192" height="667" fill="none" stroke="#8c49ff" stroke-width="1.5" stroke-dasharray="8 4" rx="10"/>
  <rect x="510" y="255" width="180" height="150" fill="none" stroke="#8c49ff" stroke-width="2" rx="6"/>
  <circle cx="570" cy="305" r="22" fill="none" stroke="#8c49ff" stroke-width="2"/>
  <line x1="555" y1="350" x2="645" y2="350" stroke="#8c49ff" stroke-width="2" stroke-linecap="round"/>
  <line x1="660" y1="265" x2="680" y2="255" stroke="#8c49ff" stroke-width="2" stroke-linecap="round"/>
  <text x="600" y="450" text-anchor="middle" fill="#c0bcd8" font-size="17" font-family="sans-serif">${escaped}</text>
  <text x="600" y="480" text-anchor="middle" fill="#5a5570" font-size="13" font-family="sans-serif">AI 이미지 생성 불가 (유료 플랜 필요)</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const alt = (body.alt as string)?.trim();

    if (!alt) {
      return NextResponse.json({ error: 'alt text is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        imageDataUrl: generateSvgPlaceholder(alt),
        isPlaceholder: true,
      });
    }

    const prompt = `LG U+ Enterprise 기업 블로그용 이미지. 주제: ${alt}. 전문적이고 깔끔한 한국 기업 스타일, 현대적 비즈니스 디자인.`;

    // 이미지 생성 가능한 Gemini 모델 순차 시도
    const models = [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image-preview',
    ];

    for (const modelName of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['image'] },
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = (err as { error?: { message?: string } }).error?.message ?? '';
          console.warn(`[generate-image] ${modelName} failed (${res.status}):`, errMsg.slice(0, 150));
          // 할당량 초과(429)나 유료 필요(400 with paid plan message)이면 더 시도해도 소용없음
          if (res.status === 429 || errMsg.includes('paid')) break;
          continue;
        }

        const data: { candidates?: GeminiCandidate[] } = await res.json();
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find((p) => p.inlineData);

        if (imgPart?.inlineData) {
          return NextResponse.json({
            imageDataUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`,
          });
        }
      } catch (e) {
        console.warn(`[generate-image] ${modelName} exception:`, e);
      }
    }

    // AI 생성 실패 → SVG 플레이스홀더 반환
    return NextResponse.json({
      imageDataUrl: generateSvgPlaceholder(alt),
      isPlaceholder: true,
    });
  } catch (error) {
    console.error('[generate-image] error:', error);
    return NextResponse.json({ error: '이미지 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
