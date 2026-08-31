import axios from 'axios';

// Server-side base URL: the FastAPI bridge (core/api), reached directly. Same API_URL env
// var next.config.ts uses for the client-side /api/* rewrite.
const SERVER_BASE_URL = `${process.env.API_URL || 'http://127.0.0.1:8001'}/api/v1`;

// Client-side base URL (proxied through Next.js)
const CLIENT_BASE_URL = '/api/v1';

// Determine if we're on the server or client
const isServer = typeof window === 'undefined';

// Create axios instance with appropriate base URL
const api = axios.create({
  baseURL: isServer ? SERVER_BASE_URL : CLIENT_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export default api;
