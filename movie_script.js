import { Client } from '@cloudflare/d1';

const client = new Client({
    databaseId: '15e924f4-2e38-453a-ad1d-9569c199e29b',
    accountId: 'fa105d6da4f175ff38e2cb251887827c',
    privateKey: 'FaAWmfPh0J1dXkhiUmcgowOpzT4cNGbYu4pp-oJx'
});

const form = document.getElementById('movie-form');
const apiKey = "696e0c182f4e0c9df706d94b7bf50021"; // Your TMDB API key

form.addEventListener('submit', (event) => {
    event.preventDefault();

    const movieTitle = document.getElementById('movie-title').value;

    fetch(`https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${movieTitle}`)
        .then(response => response.json())
        .then(data => {
            if (data.results.length > 0) {
                const movieId = data.results[0].id; // Assuming we take the first result

                // Fetch detailed movie information
                fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${apiKey}&append_to_response=credits`)
                    .then(response => response.json())
                    .then(movieData => {
                        // Process and store movie and people data in D1
                        storeMovieDataInD1(movieData);
                    })
                    .catch(error => console.error('Error fetching detailed movie data:', error));
            } else {
                console.error('No movie found with that title.');
            }
        })
        .catch(error => console.error('Error fetching movie data:', error));
});

async function storeMovieDataInD1(movieData) {
    try {
        // Insert movie data into the "Movies" table
        await client.prepare(`
            INSERT INTO Movies (id, title, release_year)
            VALUES (?, ?, ?)
        `).execute([movieData.id, movieData.title, movieData.release_date.substring(0, 4)]);

        // Process cast and crew data
        for (const person of movieData.credits.cast) {
            await storePersonDataInD1(person, movieData.id, 'Cast', person.character);
        }
        for (const person of movieData.credits.crew) {
            await storePersonDataInD1(person, movieData.id, person.department, person.job);
        }

        // Display a success message or update the movie list after data is stored
        console.log('Movie data stored successfully!');
        fetchAndDisplayMovies(); // Update the movie list
    } catch (error) {
        console.error('Error storing movie data in D1:', error);
    }
}

async function storePersonDataInD1(personData, movieId, department, job) {
    try {
        // Check if the person exists in the "People" table
        const existingPerson = await client.prepare(`
            SELECT id FROM People WHERE id = ?
        `).execute([personData.id]);

        let personId;
        if (existingPerson.rows.length === 0) {
            // Insert the person if they don't exist
            await client.prepare(`
                INSERT INTO People (id, name, known_for_department)
                VALUES (?, ?, ?)
            `).execute([personData.id, personData.name, personData.known_for_department]);
            personId = personData.id;
        } else {
            personId = existingPerson.rows[0].id;
        }

        // Insert a new credit entry
        await client.prepare(`
            INSERT INTO Credits (movie_id, person_id, department, job, character)
            VALUES (?, ?, ?, ?, ?)
        `).execute([movieId, personId, department, job, personData.character || null]);
    } catch (error) {
        console.error('Error storing person data in D1:', error);
    }
}

// Function to fetch and display movies (you'll need to implement this)
async function fetchAndDisplayMovies() {
    // ... (your implementation to fetch movie data from D1 and display it)
}

// Call the function to initially display movies
fetchAndDisplayMovies();