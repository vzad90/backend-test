import axios from 'axios'
import dotenv from 'dotenv'
import { Router } from 'express'
import pLimit from 'p-limit'
import pool from '../db'

dotenv.config()

const router = Router()
const OMDB_API_KEY = process.env.OMDB_API_KEY

const DEFAULT_SEARCHES = ['Avengers', 'Batman']
const ORIGINAL_IMDB_ID = 'tt3896198'

const cache = new Map<string, any>()

const limit = pLimit(5)

// Функція для отримання фільму з БД
async function getMovieFromDB(id: string) {
  try {
    const client = await pool.connect();
    try {
      const query = `SELECT * FROM movies WHERE id = $1`;
      const result = await client.query(query, [id]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('Database not available, skipping DB lookup:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function getMoviesFromDB(ids: string[], username?: string) {
  try {
    const client = await pool.connect();
    try {
      const moviesQuery = `
        SELECT m.*
        FROM movies m
        WHERE m.id = ANY($1)
      `;
      
      const moviesResult = await client.query(moviesQuery, [ids]);
      
      if (!username || moviesResult.rows.length === 0) {
        return moviesResult.rows;
      }
      
      const userQuery = `
        SELECT um.movie_id, um."isFavorite"
        FROM user_movies um
        JOIN users u ON um.user_id = u.id
        WHERE u.username = $1 AND um.movie_id = ANY($2)
      `;
      
      const userResult = await client.query(userQuery, [username, ids]);
      const userMoviesMap = new Map(userResult.rows.map(row => [row.movie_id, row]));
      
      return moviesResult.rows.map(movie => ({
        ...movie,
        isFavorite: userMoviesMap.get(movie.id)?.isFavorite || false,
        hasUserChanges: userMoviesMap.has(movie.id)
      }));
    } finally {
      client.release(); 
    } 
  } catch (err) {
    console.warn('Database not available, skipping DB lookup:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function fetchMovieDetail(id: string) {
	if (cache.has(id)) {
		return cache.get(id)
	}

	const dbMovie = await getMovieFromDB(id)
	if (dbMovie) {
		const formattedMovie = {
			imdbID: dbMovie.id,
			Title: dbMovie.title || '',
			Year: dbMovie.year || '',
			Runtime: dbMovie.runtime || 'N/A',
			Genre: dbMovie.genre || 'N/A',
			Director: dbMovie.director || 'N/A',
			Poster: dbMovie.poster || '',
			Response: 'True'
		}
		cache.set(id, formattedMovie)
		return formattedMovie
	}

	try {
		const res = await axios.get('http://www.omdbapi.com/', {
			params: { i: id, apikey: OMDB_API_KEY, plot: 'short' },
		})

		if (res.data && res.data.imdbID) {
			cache.set(id, res.data)
			return res.data
		}
	} catch (err) {
		console.warn(`Failed to fetch movie ${id}:`, err)
	}

	return null
}

async function fetchMovieDetails(ids: string[]) {
	const tasks = ids.map(id => limit(() => fetchMovieDetail(id)))
	const results = await Promise.all(tasks)
	return results.filter(Boolean)
}

router.get('/search', async (req, res) => {
	const query = (req.query.query as string) || ''
	const username = req.query.username as string

	try {
		let imdbIDs: string[] = []

		if (query.trim()) {
			const response = await axios.get('http://www.omdbapi.com/', {
				params: { s: query.trim(), apikey: OMDB_API_KEY },
			})

			imdbIDs = response.data.Search?.map((m: any) => m.imdbID) || []
		} else {
			for (const q of DEFAULT_SEARCHES) {
				try {
					const response = await axios.get('http://www.omdbapi.com/', {
						params: { s: q, apikey: OMDB_API_KEY },
					})

					if (response.data.Search) {
						imdbIDs.push(...response.data.Search.map((m: any) => m.imdbID))
					}
				} catch (err) {
					console.warn(`Failed to fetch search for "${q}":`, err)
				}
			}

			imdbIDs.push(ORIGINAL_IMDB_ID)
		}

		imdbIDs = Array.from(new Set(imdbIDs))

		const dbMovies = await getMoviesFromDB(imdbIDs, username)
		const dbMovieMap = new Map(dbMovies.map(m => [m.id, m]))

		const missingIds = imdbIDs.filter(id => !dbMovieMap.has(id))
		const apiMoviesData = await fetchMovieDetails(missingIds)
		const apiMovieMap = new Map(apiMoviesData.map(m => [m.imdbID, m]))

		const movies = imdbIDs.map(id => {
			const dbMovie = dbMovieMap.get(id)
			const apiMovie = apiMovieMap.get(id)
			
			if (dbMovie && dbMovie.hasUserChanges) {
				return {
					id: dbMovie.id,
					title: dbMovie.title || '',
					year: dbMovie.year || '',
					runtime: dbMovie.runtime || 'N/A',
					genre: dbMovie.genre || 'N/A',
					director: dbMovie.director || 'N/A',
					isFavorite: dbMovie.isFavorite || false,
					poster: dbMovie.poster || '',
				}
			} else if (apiMovie) {
				return {
					id: apiMovie.imdbID,
					title: apiMovie.Title || '',
					year: apiMovie.Year || '',
					runtime: apiMovie.Runtime || 'N/A',
					genre: apiMovie.Genre || 'N/A',
					director: apiMovie.Director || 'N/A',
					isFavorite: dbMovie?.isFavorite || false,
					poster: apiMovie.Poster && apiMovie.Poster !== 'N/A' ? apiMovie.Poster : '',
				}
			}
			return null
		}).filter(Boolean)

		res.json(movies)
	} catch (error) {
		console.error('Error fetching movies:', error)
		res.status(500).json({ error: 'OMDB request failed' })
	}
})

router.get('/movie/:id', async (req, res) => {
	const { id } = req.params

	if (!id) {
		return res.status(400).json({ error: 'Movie id is required' })
	}

	try {
		const movie = await fetchMovieDetail(id)

		if (!movie) {
			return res.status(404).json({ error: 'Movie not found' })
		}

		res.json(movie)
	} catch (error) {
		console.error('Error fetching movie by id:', error)
		res.status(500).json({ error: 'Failed to fetch movie' })
	}
})

export default router
