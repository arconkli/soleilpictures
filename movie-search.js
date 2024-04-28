const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const apiUrl = '/api';

document.addEventListener('DOMContentLoaded', () => {
  function displayPeopleTable(sort = 'person_name', order = 'asc') {
    fetch(`${apiUrl}/people?sort=${sort}&order=${order}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        const tableBody = document.querySelector('#people-table tbody');
        tableBody.innerHTML = '';
        data.people.forEach(person => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>${person.name}</td>
            <td>${person.department}</td>
            <td>${person.job}</td>
            <td>${person.character || ''}</td>
            <td>${person.specialMarking ? 'Yes' : 'No'}</td>
            <td>${person.movie_title}</td>
          `;
          tableBody.appendChild(row);
        });
      })
      .catch(error => {
        console.error('Error fetching people data:', error);
      });
  }

  function addMovieInfo(movieId, movieTitle) {
    const jobCategoryInput = prompt('Enter the job category for special marking:');
    if (jobCategoryInput) {
      fetch(`${apiUrl}/movie/${movieId}/mark-category`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ category: jobCategoryInput })
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          alert(data.message);
          displayPeopleTable();
        })
        .catch(error => {
          console.error('Error marking job category:', error);
        });
    }
  }

  searchBtn.addEventListener('click', () => {
    const title = searchInput.value;
    fetch(`${apiUrl}/search/${encodeURIComponent(title)}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.results.length === 0) {
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

  displayPeopleTable();

  const peopleTableHeaders = document.querySelectorAll('#people-table th');
  peopleTableHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;
      const order = header.dataset.order === 'asc' ? 'desc' : 'asc';
      header.dataset.order = order;
      displayPeopleTable(column, order);
    });
  });
});