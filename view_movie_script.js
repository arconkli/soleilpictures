import { Client } from '@cloudflare/d1';

const client = new Client({
    databaseId: '15e924f4-2e38-453a-ad1d-9569c199e29b',
    accountId: 'fa105d6da4f175ff38e2cb251887827c',
    privateKey: 'FaAWmfPh0J1dXkhiUmcgowOpzT4cNGbYu4pp-oJx'
});

async function fetchAndDisplayMovies() {
    try {
        const movieData = await client.prepare(`
            SELECT * FROM Movies
        `).execute();

        const movieList = document.getElementById('movie-list');
        movieList.innerHTML = ''; // Clear existing movie list

        for (const movie of movieData.rows) {
            const movieElement = createMovieElement(movie);
            movieList.appendChild(movieElement);
        }
    } catch (error) {
        console.error('Error fetching movie data from D1:', error);
    }
}

function createMovieElement(movie) {
    // Create and populate an HTML element to represent the movie
    // ...

    // Fetch and display related people data
    fetchPeopleForMovie(movie.id, movieElement);

    return movieElement;
}

async function fetchPeopleForMovie(movieId, movieElement) {
    try {
        const peopleData = await client.prepare(`
            SELECT p.name, c.department, c.job, c.character
            FROM Credits c
            JOIN People p ON c.person_id = p.id
            WHERE c.movie_id = ?
        `).execute([movieId]);

        // Display people data within the movie element
        // ...
    } catch (error) {
        console.error('Error fetching people data for movie:', error);
    }
}

// Call the function to initially display movies
fetchAndDisplayMovies();