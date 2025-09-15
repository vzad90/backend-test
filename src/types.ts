export interface Movie {
  id: string;
  title: string;
  year: string;
  runtime?: string;
  genre?: string;
  director?: string;
  poster?: string;
  isFavorite?: boolean;
}

export interface User {
  id: string;
  username: string;
  created_at?: string;
}
