import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { tokenStorage } from '@/auth/tokenStorage';

const baseURL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://api.aiklaotrip.com';

export const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Inject JWT on each request
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const jwt = await tokenStorage.getJwt();
  if (jwt) {
    config.headers.set('Authorization', `Bearer ${jwt}`);
  }
  return config;
});

// Callback set by AuthProvider to handle 401 globally
let unauthorizedHandler: (() => void) | null = null;

export function registerUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await tokenStorage.clear();
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  },
);
