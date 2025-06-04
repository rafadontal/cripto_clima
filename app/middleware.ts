import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createLogger, logApiRequest, logApiResponse } from './utils/logger';
import { handleError } from './utils/errors';

export async function middleware(request: NextRequest) {
  const start = Date.now();
  const logger = createLogger();
  const requestId = logApiRequest(request, {
    path: request.nextUrl.pathname,
    method: request.method
  });

  try {
    const response = await NextResponse.next();
    
    const duration = Date.now() - start;
    logApiResponse(request, response.status, duration, { requestId });
    
    return response;
  } catch (error) {
    logger.error('Middleware error', error, { requestId });
    const { statusCode, body } = handleError(error);
    
    return NextResponse.json(body, { status: statusCode });
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 