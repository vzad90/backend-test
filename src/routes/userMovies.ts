import { Router } from 'express'
import pool from '../db'
import { Movie } from '../types'
 
const router = Router();

async function getOrCreateUser(username: string) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE username=$1', [username]);
    if (res.rows.length) return res.rows[0];

		const insertRes = await client.query(
      'INSERT INTO users(username) VALUES($1) ON CONFLICT (username) DO NOTHING RETURNING *',
      [username]
    );

    if (insertRes.rows.length) return insertRes.rows[0];

    const finalRes = await client.query('SELECT * FROM users WHERE username=$1', [username]);
    return finalRes.rows[0];
  } finally {
    client.release();
  }
}

router.post('/', async (req, res) => {
  const { username, movie } = req.body; 
  if (!username || !movie?.id) 
    return res.status(400).json({ error: 'username & movie required' });

  const client = await pool.connect();
  try {
    const user = await getOrCreateUser(username);

    await client.query(
      `INSERT INTO movies(id, title, year, runtime, genre, director, poster)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) 
       DO UPDATE SET 
         title = EXCLUDED.title,
         year = EXCLUDED.year,
         runtime = EXCLUDED.runtime,
         genre = EXCLUDED.genre,
         director = EXCLUDED.director,
         poster = EXCLUDED.poster`,
      [
        movie.id,
        movie.title || '',
        movie.year || '',
        movie.runtime || 'N/A',
        movie.genre || 'N/A',
        movie.director || 'N/A',
        movie.poster || ''
      ]
    );
    
    await client.query(
      `INSERT INTO user_movies(user_id, movie_id, "isFavorite")
       VALUES($1,$2,$3)
       ON CONFLICT (user_id,movie_id)
       DO UPDATE SET "isFavorite" = EXCLUDED."isFavorite"`,
      [user.id, movie.id, movie.isFavorite || false]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  const username = req.query.username as string;
  if (!username) return res.status(400).json({ error: 'username required' });

  const client = await pool.connect();
  try {
    const user = await getOrCreateUser(username);

    const result = await client.query<Movie>(
      `SELECT m.*, um."isFavorite"
       FROM movies m
       JOIN user_movies um ON m.id = um.movie_id
       WHERE um.user_id = $1`,
      [user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

router.put('/', async (req, res) => {
  const { username, movie } = req.body; 
  if (!username || !movie?.id) 
    return res.status(400).json({ error: 'username & movie required' });

  const client = await pool.connect();
  try {
    const user = await getOrCreateUser(username);

    // Оновлюємо дані фільму
    await client.query(
      `UPDATE movies SET 
         title = $2,
         year = $3,
         runtime = $4,
         genre = $5,
         director = $6,
         poster = $7
       WHERE id = $1`,
      [
        movie.id,
        movie.title || '',
        movie.year || '',
        movie.runtime || 'N/A',
        movie.genre || 'N/A',
        movie.director || 'N/A',
        movie.poster || ''
      ]
    );
    
    // Оновлюємо користувацькі налаштування
    await client.query(
      `UPDATE user_movies SET "isFavorite" = $3
       WHERE user_id = $1 AND movie_id = $2`,
      [user.id, movie.id, movie.isFavorite || false]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

router.delete('/', async (req, res) => {
  const { username, movieId } = req.body;
  if (!username || !movieId) return res.status(400).json({ error: 'username & movieId required' });

  const client = await pool.connect();
  try {
    const user = await getOrCreateUser(username);

    await client.query(
      'DELETE FROM user_movies WHERE user_id=$1 AND movie_id=$2',
      [user.id, movieId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

export default router;
