const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const jobCategoryFilter = document.getElementById('job-category-filter');
const movieTitleFilter = document.getElementById('movie-title-filter');
const apiUrl = '/api';

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded event triggered');

  function displayPeopleTable(sort = 'person_name', order = 'asc', jobCategory = '', movieTitle = '') {
    console.log('Fetching people data...');
    fetch(`${apiUrl}/people?sort=${sort}&order=${order}&job_category=${jobCategory}&movie_title=${movieTitle}`)
      .then(response => {
        console.log('Response received:', response);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('People data:', data);
        const tableBody = document.querySelector('#people-table tbody');
        if (tableBody) {
          tableBody.innerHTML = '';
          if (data.people && data.people.length > 0) {
            data.people.forEach(person => {
              const row = document.createElement('tr');
              row.innerHTML = `
                <td>${person.name || ''}</td>
                <td>${person.department || ''}</td>
                <td>${person.job || ''}</td>
                <td>${person.character || ''}</td>
                <td>${person.movieTitle || ''}</td>
              `;
              tableBody.appendChild(row);
            });
          } else {
            console.log('No people found.');
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="5">No people found.</td>';
            tableBody.appendChild(row);
          }
        } else {
          console.error('Table body element not found.');
        }
      })
      .catch(error => {
        console.error('Error fetching people data:', error);
      });
  }

  function populateMovieTitleFilter() {
    fetch(`${apiUrl}/movies`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Movie data:', data);
        if (data.movies && data.movies.length > 0) {
          const uniqueTitles = [...new Set(data.movies.map(movie => movie.title))];
          uniqueTitles.forEach(title => {
            const option = document.createElement('option');
            option.value = title;
            option.textContent = title;
            movieTitleFilter.appendChild(option);
          });
        }
      })
      .catch(error => {
        console.error('Error fetching movie data:', error);
      });
  }

  function addMovieInfo(movieId, movieTitle) {
    const jobCategories = ['Acting', 'Directing', 'Production', 'Writing', 'Editing', 'Cinematography', 'Music', 'Design', 'Crew'];
    const selectedCategories = [];

    for (const category of jobCategories) {
      if (confirm(`Is "${category}" a relevant job category for this movie?`)) {
        selectedCategories.push(category);
      }
    }

    fetch(`${apiUrl}/movie/${movieId}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Movie data imported:', data);
        alert('Movie added successfully!');
        displayPeopleTable();
        populateMovieTitleFilter();
      })
      .catch(error => {
        console.error('Error importing movie data:', error);
        alert('Failed to add movie. Please try again.');
      });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const title = searchInput.value;
      console.log('Searching movies...');
      fetch(`${apiUrl}/search/${encodeURIComponent(title)}`)
        .then(response => {
          console.log('Response received:', response);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          console.log('Search results:', data);
          if (data.results.length === 0) {
            console.log('No results found.');
            searchResults.innerHTML = '<p>No results found.</p>';
          } else {
            const html = data.results.map(result => `
              <div class="result-item">
                <h3>${result.title}</h3>
                <p>Media Type: ${result.mediaType}</p>
                <p>Release Year: ${result.releaseYear || 'N/A'}</p>
                <button class="add-info-btn" data-id="${result.id}" data-title="${result.title}">Add Info</button>
              </div>
            `).join('');
            searchResults.innerHTML = html;

            const addInfoBtns = document.querySelectorAll('.add-info-btn');
            addInfoBtns.forEach(btn => {
              btn.addEventListener('click', () => {
                const movieId = btn.dataset.id;
                const movieTitle = btn.dataset.title;
                addMovieInfo(movieId, movieTitle);
              });
            });
          }
        })
        .catch(error => {
          console.error('Error searching movies:', error);
        });
    });
  } else {
    console.error('Search button element not found.');
  }

  displayPeopleTable();
  populateMovieTitleFilter();

  const peopleTableHeaders = document.querySelectorAll('#people-table th');
  peopleTableHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;
      const order = header.dataset.order === 'asc' ? 'desc' : 'asc';
      header.dataset.order = order;
      displayPeopleTable(column, order, jobCategoryFilter.value, movieTitleFilter.value);
    });
  });

  jobCategoryFilter.addEventListener('change', () => {
    const selectedCategory = jobCategoryFilter.value;
    displayPeopleTable('person_name', 'asc', selectedCategory, movieTitleFilter.value);
  });

  movieTitleFilter.addEventListener('change', () => {
    const selectedTitle = movieTitleFilter.value;
    displayPeopleTable('person_name', 'asc', jobCategoryFilter.value, selectedTitle);
  });
});