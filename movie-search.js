const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');

searchBtn.addEventListener('click', () => {
  const title = searchInput.value;

  fetch(`/api/search/${encodeURIComponent(title)}`)
    .then(response => response.json())
    .then(data => {
      if (data.results.length === 0) {
        searchResults.innerHTML = '<p>No results found.</p>';
      } else {
        const html = data.results.map(result => `
          <div class="result-item">
            <h3>${result.title}</h3>
            <p>Media Type: ${result.mediaType}</p>
            <p>Release Year: ${result.releaseYear || 'N/A'}</p>
            <button class="mark-category-btn" data-id="${result.id}" data-title="${result.title}">Mark Category</button>
          </div>
        `).join('');
        searchResults.innerHTML = html;

        // Add event listeners to the "Mark Category" buttons
        const markCategoryBtns = document.querySelectorAll('.mark-category-btn');
        markCategoryBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const title = btn.dataset.title;
            const category = prompt(`Enter category for "${title}":`);
            if (category) {
              fetch(`/api/movie/${id}/mark-category`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category })
              })
                .then(response => response.json())
                .then(data => {
                  alert(data.message);
                  displayMovieTable(); // Refresh the movie table after marking a category
                  displayPeopleTable(); // Refresh the people table after marking a category
                })
                .catch(error => {
                  console.error('Error:', error);
                });
            }
          });
        });
      }
    })
    .catch(error => {
      console.error('Error:', error);
    });
});

// Function to fetch and display the movie table
function displayMovieTable(sort = 'title', order = 'asc') {
  fetch(`/api/movies?sort=${sort}&order=${order}`)
    .then(response => response.json())
    .then(data => {
      const tableBody = document.querySelector('#movie-table tbody');
      tableBody.innerHTML = '';

      data.movies.forEach(movie => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${movie.title}</td>
          <td>${movie.mediaType}</td>
          <td>${movie.releaseYear || 'N/A'}</td>
          <td>${movie.categories.join(', ')}</td>
        `;
        tableBody.appendChild(row);
      });
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

// Call the function to display the movie table on page load
displayMovieTable();

// Add sorting functionality to the movie table headers
const movieTableHeaders = document.querySelectorAll('#movie-table th');
movieTableHeaders.forEach(header => {
  header.addEventListener('click', () => {
    const column = header.dataset.column;
    const order = header.dataset.order === 'asc' ? 'desc' : 'asc';
    header.dataset.order = order;

    displayMovieTable(column, order);
  });
});

// Function to fetch and display the people table
function displayPeopleTable(sort = 'person_name', order = 'asc') {
  fetch(`/api/people?sort=${sort}&order=${order}`)
    .then(response => response.json())
    .then(data => {
      const tableBody = document.querySelector('#people-table tbody');
      tableBody.innerHTML = '';

      data.people.forEach(person => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${person.person_name}</td>
          <td>${person.department}</td>
          <td>${person.job}</td>
          <td>${person.character || ''}</td>
          <td>${person.special_marking ? 'Yes' : 'No'}</td>
        `;
        tableBody.appendChild(row);
      });
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

// Call the function to display the people table on page load
displayPeopleTable();

// Add sorting functionality to the people table headers
const peopleTableHeaders = document.querySelectorAll('#people-table th');
peopleTableHeaders.forEach(header => {
  header.addEventListener('click', () => {
    const column = header.dataset.column;
    const order = header.dataset.order === 'asc' ? 'desc' : 'asc';
    header.dataset.order = order;

    displayPeopleTable(column, order);
  });
});