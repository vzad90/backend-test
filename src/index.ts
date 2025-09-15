import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import moviesRouter from './routes/movies'
import userMoviesRouter from './routes/userMovies'

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', moviesRouter);
app.use('/api/user-movies', userMoviesRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
