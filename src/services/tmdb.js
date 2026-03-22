const API_BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = import.meta.env.VITE_TMDB_API_KEY;

const API_OPTIONS = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    Authorization: `Bearer ${API_KEY}`
  }
};

/**
 * Fetch detailed information for a movie or TV show.
 * @param {string|number} id - TMDB ID
 * @param {string} type - 'movie' or 'tv'
 */
export const fetchMediaDetails = async (id, type = 'movie') => {
  try {
    const endpoint = `${API_BASE_URL}/${type}/${id}?append_to_response=credits,videos,images`;
    const response = await fetch(endpoint, API_OPTIONS);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${type} details`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${type} details:`, error);
    throw error;
  }
};

/**
 * Fetch popular media.
 * @param {string} type - 'movie' or 'tv'
 */
export const fetchPopularMedia = async (type = 'movie') => {
  const endpoint = `${API_BASE_URL}/${type}/popular`;
  const response = await fetch(endpoint, API_OPTIONS);
  const data = await response.json();
  return data.results || [];
};

/**
 * Search for media.
 * @param {string} query
 * @param {string} type - 'movie' or 'tv'
 */
export const searchMedia = async (query, type = 'movie') => {
  const endpoint = `${API_BASE_URL}/search/${type}?query=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, API_OPTIONS);
  const data = await response.json();
  return data.results || [];
};

/**
 * Fetch trending media.
 * @param {string} type - 'movie' or 'tv'
 * @param {string} timeWindow - 'day' or 'week'
 */
export const fetchTrendingMedia = async (type = 'movie', timeWindow = 'day') => {
  const endpoint = `${API_BASE_URL}/trending/${type}/${timeWindow}`;
  const response = await fetch(endpoint, API_OPTIONS);
  const data = await response.json();
  return data.results || [];
};
