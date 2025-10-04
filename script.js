async function getUsername() {
  const res = await fetch("session_user.php");
  const data = await res.json();
  return data.username;
}

async function loadQueues() {
  const username = await getUsername();
  document.getElementById("username").textContent = username;

  const res = await fetch(`queues.php?action=get&username=${encodeURIComponent(username)}`);
  const queues = await res.json();

  const container = document.getElementById("queues-container");
  container.innerHTML = "";

  queues.forEach(q => {
    const card = document.createElement("div");
    card.className = "queue-card";
    card.innerHTML = `
      <div class="queue-info">
        <strong>${q.name}</strong>
        <span>Очередь: <b class="count">${q.people_count}</b></span>
      </div>
      <div class="queue-action">
        <button class="queue-btn" data-id="${q.id}" style="background:${q.in_queue ? '#FFD600' : '#ccc'}">
          ${q.in_queue ? 'Выйти' : 'Войти'}
        </button>
        <small>≈ ${q.wait_time} мин</small>
      </div>
    `;
    container.appendChild(card);
  });

  addEventListeners(username);
}

function addEventListeners(username) {
  document.querySelectorAll(".queue-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const queueId = btn.dataset.id;
      await fetch(`queues.php?action=toggle&queue_id=${queueId}&username=${encodeURIComponent(username)}`);
      await loadQueues();
    });
  });
}

loadQueues();
setInterval(loadQueues, 5000);
