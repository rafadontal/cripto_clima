import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createLogger, logApiRequest, logApiResponse } from './utils/logger';
import { handleError } from './utils/errors';

export async function middleware(request: NextRequest) {
  const start = Date.now();
  const logger = createLogger({
    path: request.nextUrl.pathname,
    method: request.method
  });

  // Log the incoming request
  const requestId = logApiRequest(request, {
    path: request.nextUrl.pathname,
    method: request.method
  });

  try {
    const response = await NextResponse.next();
    
    // Log the response with duration
    const duration = Date.now() - start;
    logApiResponse(request, response.status, duration, { 
      requestId,
      path: request.nextUrl.pathname,
      method: request.method
    });
    
    return response;
  } catch (error) {
    // Log the error with full context
    logger.error('Middleware error', error, { 
      requestId,
      path: request.nextUrl.pathname,
      method: request.method,
      duration: Date.now() - start
    });
    
    const { statusCode, body } = handleError(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

// Configure middleware to run on all API routes
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 