import axios from 'axios';
import { env } from './env';

// Nominatim's usage policy requires a distinctive User-Agent identifying
// the application (not a browser UA) and reasonable request volume.
export const nominatimClient = axios.create({
  baseURL: 'https://nominatim.openstreetmap.org',
  headers: { 'User-Agent': env.NOMINATIM_USER_AGENT },
  timeout: 10000,
});
